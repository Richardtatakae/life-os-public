'use client'

/**
 * pursuitsShared — the lookup index + drag-and-drop logic shared by the two
 * Pursuits surfaces: the full <TaskTree> (Pursuits tab) and the filtered
 * <TodaySchedule> (Schedule tab, "push to today" list).
 *
 * Extracted verbatim from TaskTree so both surfaces reorder tasks identically
 * (same sibling-group rule, same dependency guard) with no duplicated logic.
 */

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import type { GoalNode } from '@/stores/goalStore'
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { groupKeyFor, type TaskNode, type FlatTask } from '@/components/tasks/TaskTreeNode'

export type Area = { id: string; name: string; color: string | null }
export type Project = { id: string; name: string; areaId: string; color: string | null }

// Walk a forest collecting every task node into a flat id→node map.
export function indexNodes(roots: TaskNode[], into: Map<string, TaskNode>) {
  for (const n of roots) {
    into.set(n.id, n)
    indexNodes(n.children, into)
  }
}

// Flatten tasks to {id,title} for the dependency picker.
export function flatten(roots: TaskNode[], acc: FlatTask[]) {
  for (const n of roots) {
    acc.push({ id: n.id, title: n.title })
    flatten(n.children, acc)
  }
}

// Walk a goal forest (goals + their nested children) into a flat id→goal map.
function indexGoals(goals: GoalNode[], into: Map<string, GoalNode>) {
  for (const g of goals) {
    into.set(g.id, g)
    indexGoals(g.children, into)
  }
}

export interface PursuitsIndex {
  /** Every task node by id (roots + nested subtasks). */
  idToNode: Map<string, TaskNode>
  /** Top-level tasks grouped by owner key: goalId, else areaId, else 'none'. */
  rootsByOwner: Map<string, TaskNode[]>
  /** All tasks flattened to {id,title} for dependency pickers. */
  allTasks: FlatTask[]
  /** Area-level goals (no project) grouped by areaId ('none' = no area). */
  goalsByArea: Map<string, GoalNode[]>
  /** Goals grouped by their projectId. */
  goalsByProject: Map<string, GoalNode[]>
  /** Projects grouped by their areaId. */
  projectsByArea: Map<string, Project[]>
  /** Every goal by id (top-level + nested sub-goals) — for resolving refs. */
  goalById: Map<string, GoalNode>
}

/** Build all Pursuits lookups from the loaded task/goal/project trees. */
export function buildPursuitsIndex(
  roots: TaskNode[],
  goals: GoalNode[],
  projects: Project[],
): PursuitsIndex {
  const idToNode = new Map<string, TaskNode>()
  indexNodes(roots, idToNode)

  // Group top-level tasks by their owner: a goal (goalId), else an area
  // (areaId, for loose area tasks), else 'none' (true orphans).
  const rootsByOwner = new Map<string, TaskNode[]>()
  for (const r of roots) {
    const key = r.goalId ?? r.areaId ?? 'none'
    if (!rootsByOwner.has(key)) rootsByOwner.set(key, [])
    rootsByOwner.get(key)!.push(r)
  }

  const allTasks: FlatTask[] = []
  flatten(roots, allTasks)

  // Group top-level goals. A goal with a projectId belongs to that project;
  // otherwise it's an area-level goal grouped by area ('none' = no area).
  const goalsByArea = new Map<string, GoalNode[]>()
  const goalsByProject = new Map<string, GoalNode[]>()
  for (const g of goals) {
    if (g.projectId) {
      if (!goalsByProject.has(g.projectId)) goalsByProject.set(g.projectId, [])
      goalsByProject.get(g.projectId)!.push(g)
    } else {
      const key = g.areaId ?? 'none'
      if (!goalsByArea.has(key)) goalsByArea.set(key, [])
      goalsByArea.get(key)!.push(g)
    }
  }

  const projectsByArea = new Map<string, Project[]>()
  for (const p of projects) {
    if (!projectsByArea.has(p.areaId)) projectsByArea.set(p.areaId, [])
    projectsByArea.get(p.areaId)!.push(p)
  }

  const goalById = new Map<string, GoalNode>()
  indexGoals(goals, goalById)

  return { idToNode, rootsByOwner, allTasks, goalsByArea, goalsByProject, projectsByArea, goalById }
}

/**
 * usePursuitsDnd — the shared dnd-kit handler + sensors + shake state.
 *
 * Reorders within a sibling group (same owner + same parent), reorders areas
 * among themselves, and blocks any drop that would put a dependent task above
 * one of its prerequisites (the row shakes; nothing is saved).
 */
export function usePursuitsDnd(index: PursuitsIndex, areas: Area[]) {
  const utils = trpc.useUtils()
  const [shakeId, setShakeId] = useState<string | null>(null)
  const [shakeMsg, setShakeMsg] = useState<string | null>(null)

  const sensors = useSensors(
    // Small distance so a click (expand/checkbox) doesn't start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const reorderMutation = trpc.task.reorder.useMutation({
    onSettled: () => { void utils.task.tree.invalidate() },
  })
  const areaReorderMutation = trpc.area.reorder.useMutation({
    onSettled: () => { void utils.area.list.invalidate() },
  })
  const goalReorderMutation = trpc.goal.reorder.useMutation({
    onSettled: () => { void utils.goal.tree.invalidate() },
  })

  const areaIds = new Set(areas.map((a) => a.id))
  const { idToNode, rootsByOwner, goalById, goalsByArea, goalsByProject } = index

  // The visible sibling group a goal belongs to (used for drag-reorder).
  // Sub-goals sit among their parent's children; top-level goals sit among the
  // goals sharing the same project, else the same area. Area-level goals are
  // split in the UI into "Future goals" (planning) vs "Goals", so we keep a
  // drag within whichever of those two buckets the dragged goal is in.
  function goalGroup(active: GoalNode): GoalNode[] {
    if (active.parentId) return goalById.get(active.parentId)?.children ?? []
    if (active.projectId) return goalsByProject.get(active.projectId) ?? []
    const areaGroup = goalsByArea.get(active.areaId ?? 'none') ?? []
    const planning = active.status === 'planning'
    return areaGroup.filter((g) => (g.status === 'planning') === planning)
  }

  function triggerShake(id: string, msg: string) {
    setShakeId(id)
    setShakeMsg(msg)
    setTimeout(() => { setShakeId(null); setShakeMsg(null) }, 700)
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return

    // Area reorder — areas are their own sortable group (drag the header).
    if (areaIds.has(String(active.id))) {
      if (!areaIds.has(String(over.id))) return // only reorder among areas
      const ids = areas.map((a) => a.id)
      const oldIndex = ids.indexOf(String(active.id))
      const newIndex = ids.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return
      areaReorderMutation.mutate({ orderedIds: arrayMove(ids, oldIndex, newIndex) })
      return
    }

    // Goal reorder — goals drag within their visible sibling group (same
    // parent / project / area + future-vs-current bucket).
    const activeGoal = goalById.get(String(active.id))
    if (activeGoal) {
      if (!goalById.has(String(over.id))) return // only reorder among goals
      const ids = goalGroup(activeGoal).map((g) => g.id)
      const oldIndex = ids.indexOf(String(active.id))
      const newIndex = ids.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return // dropped onto another group
      goalReorderMutation.mutate({ orderedIds: arrayMove(ids, oldIndex, newIndex) })
      return
    }

    const activeNode = idToNode.get(String(active.id))
    const overNode = idToNode.get(String(over.id))
    if (!activeNode || !overNode) return

    // Must be in the same sibling group (same owner + same parent task).
    if (
      groupKeyFor(activeNode.goalId, activeNode.areaId, activeNode.parentTaskId) !==
      groupKeyFor(overNode.goalId, overNode.areaId, overNode.parentTaskId)
    ) return

    // The sibling list, in current display order.
    const siblings =
      activeNode.parentTaskId != null
        ? idToNode.get(activeNode.parentTaskId)!.children
        : rootsByOwner.get(activeNode.goalId ?? activeNode.areaId ?? 'none') ?? []
    const ids = siblings.map((s) => s.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(ids, oldIndex, newIndex)
    const rank = new Map(newOrder.map((id, i) => [id, i]))

    // Dependency check: no task may sit above one of its prerequisites.
    for (const id of newOrder) {
      const node = idToNode.get(id)!
      for (const pid of node.dependsOn) {
        if (rank.has(pid) && rank.get(id)! < rank.get(pid)!) {
          const prereq = idToNode.get(pid)
          triggerShake(String(active.id), `Can't move above "${prereq?.title ?? 'prerequisite'}" — it depends on it.`)
          return
        }
      }
    }

    reorderMutation.mutate({ parentTaskId: activeNode.parentTaskId, orderedIds: newOrder })
  }

  return { sensors, handleDragEnd, shakeId, shakeMsg }
}

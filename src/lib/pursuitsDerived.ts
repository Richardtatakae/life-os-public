/**
 * pursuitsDerived — pure derivation helpers for the Pursuits panels.
 * No React, no DB, no side effects. All functions take plain data and return
 * derived values — safe to call anywhere (tests, server, client).
 */

import type { TaskNode } from '@/components/tasks/TaskTreeNode'
import type { GoalNode } from '@/stores/goalStore'
import type { Area, PursuitsIndex } from '@/components/tasks/pursuitsShared'

// ── countTasks ────────────────────────────────────────────────────────────

/** Recursively count all tasks in the tree. done = status === 'done'. */
export function countTasks(nodes: TaskNode[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const n of nodes) {
    total++
    if (n.status === 'done') done++
    const child = countTasks(n.children)
    done += child.done
    total += child.total
  }
  return { done, total }
}

// ── goalProgress ──────────────────────────────────────────────────────────

/** 0–100 integer: percentage of tasks in the tree that are done. */
export function goalProgress(tasks: TaskNode[]): number {
  const { done, total } = countTasks(tasks)
  if (total === 0) return 0
  return Math.round((done / total) * 100)
}

// ── nextActionOf ──────────────────────────────────────────────────────────

/**
 * First not-done task found by DFS (depth-first, pre-order).
 * Descends into open subtasks — a subtask of a done parent is skipped.
 */
export function nextActionOf(tasks: TaskNode[]): TaskNode | null {
  for (const n of tasks) {
    if (n.status !== 'done') return n
    // If node is done, check its children anyway (partial completion)
    const found = nextActionOf(n.children)
    if (found) return found
  }
  return null
}

// ── deadlineLabel ─────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Human-readable deadline label relative to today.
 * Returns null when d is null.
 * Returned txt: "today" | "tomorrow" | "in Nd" | "Nd overdue"
 */
export function deadlineLabel(
  d: Date | string | null,
): { txt: string; overdue: boolean } | null {
  if (d === null || d === undefined) return null
  const deadline = startOfDay(d instanceof Date ? d : new Date(d))
  const today = startOfDay(new Date())
  const diffDays = Math.round((deadline.getTime() - today.getTime()) / MS_PER_DAY)

  if (diffDays === 0) return { txt: 'today', overdue: false }
  if (diffDays === 1) return { txt: 'tomorrow', overdue: false }
  if (diffDays > 1) return { txt: `in ${diffDays}d`, overdue: false }
  // negative: overdue
  return { txt: `${Math.abs(diffDays)}d overdue`, overdue: true }
}

// ── DeadlineItem ──────────────────────────────────────────────────────────

export interface DeadlineItem {
  kind: 'task' | 'goal'
  id: string
  title: string
  deadline: Date
  crumb: string   // e.g. "Area › Goal"
  overdue: boolean
}

/**
 * Collect all open tasks (any depth) and non-completed goals that have
 * deadlines, sorted ascending by deadline.
 * crumb format: "Area" for tasks without a goal; "Area › Goal" for tasks
 * within a goal; "Area" for goals.
 */
export function deadlineItems(args: {
  areas: Area[]
  index: PursuitsIndex
}): DeadlineItem[] {
  const { areas, index } = args
  const today = startOfDay(new Date())
  const items: DeadlineItem[] = []

  // Build area name lookup
  const areaName = new Map(areas.map((a) => [a.id, a.name]))

  // Collect tasks recursively
  function collectTasks(nodes: TaskNode[], crumb: string) {
    for (const n of nodes) {
      if (n.status === 'done') continue
      if (n.deadline) {
        const dl = startOfDay(n.deadline instanceof Date ? n.deadline : new Date(n.deadline))
        items.push({
          kind: 'task',
          id: n.id,
          title: n.title,
          deadline: dl,
          crumb,
          overdue: dl < today,
        })
      }
      collectTasks(n.children, crumb)
    }
  }

  // Walk areas → goals → tasks
  for (const area of areas) {
    const aName = area.name
    const areaGoals = index.goalsByArea.get(area.id) ?? []

    // Goals with deadlines (non-completed)
    for (const g of areaGoals) {
      if (g.status === 'completed') continue
      if (g.deadline) {
        const dl = startOfDay(g.deadline instanceof Date ? g.deadline : new Date(g.deadline))
        items.push({
          kind: 'goal',
          id: g.id,
          title: g.title,
          deadline: dl,
          crumb: aName,
          overdue: dl < today,
        })
      }
      // Tasks under this goal
      const goalTasks = index.rootsByOwner.get(g.id) ?? []
      collectTasks(goalTasks, `${aName} › ${g.title}`)
    }

    // Loose area tasks (no goal)
    const looseTasks = index.rootsByOwner.get(area.id) ?? []
    collectTasks(looseTasks, aName)
  }

  // Also check 'none' bucket
  const noneTasks = index.rootsByOwner.get('none') ?? []
  collectTasks(noneTasks, '')

  items.sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
  return items
}

// ── SuggestionEntry ───────────────────────────────────────────────────────

export interface SuggestionEntry {
  task: TaskNode
  goal: GoalNode
  areaName: string
}

const MAX_DATE = new Date(8640000000000000)

/**
 * One next-action per active goal, sorted by effective deadline then priority,
 * excluding pinned tasks/goals, capped at 3.
 */
export function suggestions(args: {
  areas: Area[]
  index: PursuitsIndex
  pinnedTaskIds: Set<string>
  pinnedGoalIds: Set<string>
}): SuggestionEntry[] {
  const { areas, index, pinnedTaskIds, pinnedGoalIds } = args
  const areaName = new Map(areas.map((a) => [a.id, a.name]))

  const entries: Array<SuggestionEntry & { _sortDate: Date; _priority: number }> = []

  for (const area of areas) {
    const aName = areaName.get(area.id) ?? area.name
    const areaGoals = index.goalsByArea.get(area.id) ?? []

    for (const goal of areaGoals) {
      // Skip inactive or completed goals
      if (goal.status === 'completed' || goal.status === 'planning') continue
      // Skip pinned goals
      if (pinnedGoalIds.has(goal.id)) continue

      const goalTasks = index.rootsByOwner.get(goal.id) ?? []
      const nextTask = nextActionOf(goalTasks)
      if (!nextTask) continue
      // Skip if the next task is already pinned
      if (pinnedTaskIds.has(nextTask.id)) continue

      const taskDeadline = nextTask.deadline
        ? (nextTask.deadline instanceof Date ? nextTask.deadline : new Date(nextTask.deadline))
        : null
      const goalDeadline = goal.deadline
        ? (goal.deadline instanceof Date ? goal.deadline : new Date(goal.deadline))
        : null
      const effectiveDate = taskDeadline ?? goalDeadline ?? MAX_DATE
      const priority = nextTask.priority ?? 999

      entries.push({
        task: nextTask,
        goal,
        areaName: aName,
        _sortDate: effectiveDate,
        _priority: priority,
      })
    }
  }

  // Sort: ascending by effective deadline, then ascending by priority (lower = higher)
  entries.sort((a, b) => {
    const dt = a._sortDate.getTime() - b._sortDate.getTime()
    if (dt !== 0) return dt
    return a._priority - b._priority
  })

  return entries.slice(0, 3).map(({ _sortDate: _d, _priority: _p, ...entry }) => entry)
}

// ── visibleTasks ──────────────────────────────────────────────────────────

/**
 * Filter a task tree for display. When showArchive is false, removes nodes
 * with status === 'done' at every depth. When showArchive is true, returns
 * the full tree unchanged.
 */
export function visibleTasks(nodes: TaskNode[], showArchive: boolean): TaskNode[] {
  if (showArchive) return nodes
  const result: TaskNode[] = []
  for (const n of nodes) {
    if (n.status === 'done') continue
    result.push({
      ...n,
      children: visibleTasks(n.children, showArchive),
    })
  }
  return result
}

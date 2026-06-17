'use client'

/**
 * PursuitsColumns — Mission Control core.
 *
 * The three linked columns that replace the single-tree TaskTree:
 *   Areas (+Overview) › Goals › Tasks
 * Selection flows left→right via pursuitsStore (selAreaId → selGoalId). Every
 * behaviour of the legacy TaskTree is preserved (rename/archive/add forms,
 * goal complete + details + dependencies, focus/plan buttons, drag-reorder of
 * areas/goals/tasks with the dependency-guard shake) — ported into the three
 * column components. A single DndContext (usePursuitsDnd) wraps all three so
 * cross-nothing reorders still work exactly as before.
 *
 * Loads the same queries TaskTree uses (task.tree, goal.tree, area.list,
 * project.list) and builds the lookup index with buildPursuitsIndex.
 *
 * Orphan data (goals/tasks with no area — bucket key 'none') stays reachable:
 * a synthetic "No area" row appears in the Areas column when any exists.
 *
 * Colour rule (red-green safe): emerald renders blue (primary/progress),
 * amber = attention/overdue. Never raw red/green for state.
 */

import { useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { DndContext, closestCenter } from '@dnd-kit/core'
import type { GoalNode } from '@/stores/goalStore'
import { usePursuitsStore } from '@/stores/pursuitsStore'
import {
  buildPursuitsIndex,
  usePursuitsDnd,
  type Area,
  type Project,
} from '@/components/tasks/pursuitsShared'
import type { TaskNode } from '@/components/tasks/TaskTreeNode'
import { AreasColumn } from '@/components/pursuits/AreasColumn'
import { GoalsColumn } from '@/components/pursuits/GoalsColumn'
import { TasksColumn } from '@/components/pursuits/TasksColumn'
import './pursuits-mockup.css'

/** Synthetic area id for the "No area" orphan bucket. */
const ORPHAN_AREA: Area = { id: 'none', name: 'No area', color: null }

export function PursuitsColumns() {
  const areasQuery = trpc.area.list.useQuery()
  const projectsQuery = trpc.project.list.useQuery()
  const treeQuery = trpc.task.tree.useQuery()
  const goalsQuery = trpc.goal.tree.useQuery()

  const roots = (treeQuery.data ?? []) as TaskNode[]
  const goals = (goalsQuery.data ?? []) as GoalNode[]
  const realAreas = (areasQuery.data ?? []) as Area[]
  const projects = (projectsQuery.data ?? []) as Project[]

  const index = useMemo(
    () => buildPursuitsIndex(roots, goals, projects),
    [roots, goals, projects],
  )

  const showArchive = usePursuitsStore((s) => s.showArchive)
  const toggleArchive = usePursuitsStore((s) => s.toggleArchive)
  const selAreaId = usePursuitsStore((s) => s.selAreaId)

  // The drag handler reorders REAL areas only — pass realAreas to it (the
  // synthetic orphan row is not draggable and never reordered).
  const { sensors, handleDragEnd, shakeId, shakeMsg } = usePursuitsDnd(index, realAreas)

  if (areasQuery.isPending || projectsQuery.isPending || treeQuery.isPending || goalsQuery.isPending) {
    return <div className="p-4 text-muted text-sm">Loading pursuits…</div>
  }

  const hasOrphans =
    (index.goalsByArea.get('none')?.length ?? 0) > 0 ||
    (index.rootsByOwner.get('none')?.length ?? 0) > 0
  const areas = hasOrphans ? [...realAreas, ORPHAN_AREA] : realAreas

  // Resolve the selected area object (real or the synthetic orphan bucket).
  const selectedArea: Area | null =
    selAreaId == null ? null : areas.find((a) => a.id === selAreaId) ?? null

  return (
    <>
      {/* Shake animation — scoped here (kept off globals.css), reused by rows. */}
      <style>{`
        @keyframes task-shake-kf {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-4px); }
          40%, 80% { transform: translateX(4px); }
        }
        .task-shake { animation: task-shake-kf 0.4s ease-in-out; }
      `}</style>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="v2-grid">
          <AreasColumn areas={areas} index={index} showArchive={showArchive} toggleArchive={toggleArchive} />
          <GoalsColumn
            area={selectedArea}
            index={index}
            projects={projects}
            allTasks={index.allTasks}
            shakeId={shakeId}
            shakeMsg={shakeMsg}
          />
          <TasksColumn
            area={selectedArea}
            index={index}
            allTasks={index.allTasks}
            shakeId={shakeId}
            shakeMsg={shakeMsg}
          />
        </div>
      </DndContext>
    </>
  )
}

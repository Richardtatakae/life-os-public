'use client'

/**
 * GoalsColumn — middle column of Mission Control.
 *
 * For the selected area it shows:
 *   • project groups (📁 name, rename ✎, archive 🗑, "+ goal")
 *   • goal cards — title, future/archived chips, deadline chip, progress bar,
 *     ★ pin (toggles the goal in the Up-next queue), complete/uncomplete
 *     checkbox, ⚙ details modal. Clicking a card selects it (setSelGoal).
 *   • a GoalForm for adding an area-level goal
 *   • a "loose tasks" section (SortableTaskGroup) for area-level tasks
 *
 * Goals are split into Active / Future (planning) / Archived (only when
 * showArchive), each its own SortableContext so drag-reorder stays within a
 * bucket. The wrapping DndContext lives in PursuitsColumns.
 *
 * Colour rule (red-green safe): emerald renders blue (progress / primary),
 * amber = attention / overdue. Never raw red/green for state.
 */

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GoalForm } from '@/components/goals/GoalForm'
import { ItemDetailModal } from '@/components/shared/ItemDetailModal'
import { SortableTaskGroup, type TaskNode, type FlatTask } from '@/components/tasks/TaskTreeNode'
import { usePursuitsStore } from '@/stores/pursuitsStore'
import { goalProgress, deadlineLabel } from '@/lib/pursuitsDerived'
import type { GoalNode } from '@/stores/goalStore'
import type { Area, Project, PursuitsIndex } from '@/components/tasks/pursuitsShared'

interface GoalsColumnProps {
  area: Area | null
  index: PursuitsIndex
  projects: Project[]
  allTasks: FlatTask[]
  shakeId: string | null
  shakeMsg: string | null
}

export function GoalsColumn({ area, index, projects, allTasks, shakeId, shakeMsg }: GoalsColumnProps) {
  const showArchive = usePursuitsStore((s) => s.showArchive)
  const { rootsByOwner, goalsByArea, goalsByProject, projectsByArea } = index
  const [addingGoal, setAddingGoal] = useState(false)

  if (!area) {
    return (
      <div className="panel v2-col">
        <div className="v2-colhead">Goals</div>
        <p className="v2-empty">Select an area on the left to see its goals.</p>
      </div>
    )
  }

  const areaProjects = projectsByArea.get(area.id) ?? projects.filter((p) => p.areaId === area.id)
  const areaGoals = goalsByArea.get(area.id) ?? []
  const activeGoals = areaGoals.filter((g) => g.status !== 'planning' && g.status !== 'completed')
  const futureGoals = areaGoals.filter((g) => g.status === 'planning')
  const doneGoals = areaGoals.filter((g) => g.status === 'completed')
  const looseTasks = rootsByOwner.get(area.id) ?? []

  return (
    <div className="panel v2-col">
      <div className="v2-colhead">
        <span
          className="dot"
          style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, backgroundColor: area.color ?? 'var(--line-strong)' }}
        />
        {area.name} — goals
        <button
          type="button"
          onClick={() => setAddingGoal(true)}
          className="ghostbtn"
          style={{ marginLeft: 'auto' }}
        >
          + goal
        </button>
      </div>

      {addingGoal && (
        <div style={{ padding: '0 4px 8px' }}>
          <GoalForm
            defaultAreaId={area.id}
            onSuccess={() => setAddingGoal(false)}
            onCancel={() => setAddingGoal(false)}
          />
        </div>
      )}

      {/* Project groups. */}
      {areaProjects.map((project) => (
        <ProjectGroup
          key={project.id}
          project={project}
          goals={goalsByProject.get(project.id) ?? []}
          rootsByOwner={rootsByOwner}
        />
      ))}

      {/* Active goals. */}
      {activeGoals.length > 0 && (
        <>
          <div className="v2-seclabel">Goals</div>
          <SortableContext items={activeGoals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            {activeGoals.map((g) => (
              <GoalCard key={g.id} goal={g} rootsByOwner={rootsByOwner} />
            ))}
          </SortableContext>
        </>
      )}

      {/* Future goals (planning). */}
      {futureGoals.length > 0 && (
        <>
          <div className="v2-seclabel">Future goals</div>
          <SortableContext items={futureGoals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            {futureGoals.map((g) => (
              <GoalCard key={g.id} goal={g} rootsByOwner={rootsByOwner} />
            ))}
          </SortableContext>
        </>
      )}

      {/* Archived goals — only when the archive toggle is on. */}
      {showArchive && doneGoals.length > 0 && (
        <>
          <div className="v2-seclabel">Archived goals</div>
          <SortableContext items={doneGoals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            {doneGoals.map((g) => (
              <GoalCard key={g.id} goal={g} rootsByOwner={rootsByOwner} />
            ))}
          </SortableContext>
        </>
      )}

      {/* Loose tasks — area-level tasks with no goal. */}
      {looseTasks.length > 0 && (
        <>
          <div className="v2-seclabel">Loose tasks</div>
          <SortableTaskGroup
            nodes={looseTasks}
            goalId={null}
            parentTaskId={null}
            depth={0}
            allTasks={allTasks}
            shakeId={shakeId}
            shakeMsg={shakeMsg}
            upNextPin
          />
        </>
      )}

      {areaProjects.length === 0 && areaGoals.length === 0 && looseTasks.length === 0 && !addingGoal && (
        <p className="v2-empty">Empty — add a goal above.</p>
      )}
    </div>
  )
}

// ─────────────────── Project group (📁) ───────────────────

function ProjectGroup({
  project, goals, rootsByOwner,
}: {
  project: Project
  goals: GoalNode[]
  rootsByOwner: Map<string, TaskNode[]>
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  const [adding, setAdding] = useState(false)

  const utils = trpc.useUtils()
  const renameMutation = trpc.project.update.useMutation({
    onSuccess: () => { setRenaming(false); void utils.project.list.invalidate() },
  })
  const archiveMutation = trpc.project.archive.useMutation({
    onSettled: () => { void utils.project.list.invalidate(); void utils.goal.tree.invalidate() },
  })

  return (
    <div>
      <div className="v2-projlabel group">
        📁&nbsp;
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) renameMutation.mutate({ id: project.id, name: name.trim() })
              if (e.key === 'Escape') { setRenaming(false); setName(project.name) }
            }}
            onBlur={() => { setRenaming(false); setName(project.name) }}
            style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '2px 8px', fontSize: 12, color: 'var(--ink)' }}
          />
        ) : (
          <span>{project.name}</span>
        )}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="opacity-0 group-hover:opacity-100 ghostbtn"
        >
          + goal
        </button>
        <button
          type="button"
          onClick={() => setRenaming(true)}
          className="opacity-0 group-hover:opacity-100 ghostbtn"
          aria-label="Rename project"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Archive project "${project.name}"? Its goals stay, but lose their project.`)) {
              archiveMutation.mutate({ id: project.id })
            }
          }}
          className="opacity-0 group-hover:opacity-100 ghostbtn"
          aria-label="Archive project"
        >
          🗑
        </button>
      </div>

      {adding && (
        <div style={{ padding: '0 4px 4px' }}>
          <GoalForm
            defaultAreaId={project.areaId}
            defaultProjectId={project.id}
            onSuccess={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <SortableContext items={goals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} rootsByOwner={rootsByOwner} />
        ))}
      </SortableContext>

      {goals.length === 0 && !adding && (
        <p className="v2-empty" style={{ paddingTop: 8, paddingBottom: 8 }}>Empty — add a goal.</p>
      )}
    </div>
  )
}

// ─────────────────── A single goal card ───────────────────

function GoalCard({
  goal, rootsByOwner,
}: {
  goal: GoalNode
  rootsByOwner: Map<string, TaskNode[]>
}) {
  const selGoalId = usePursuitsStore((s) => s.selGoalId)
  const setSelGoal = usePursuitsStore((s) => s.setSelGoal)
  const selected = selGoalId === goal.id
  const [detailOpen, setDetailOpen] = useState(false)

  const tasks = rootsByOwner.get(goal.id) ?? []
  const pct = goalProgress(tasks)
  const dl = deadlineLabel(goal.deadline)
  const isDone = goal.status === 'completed'
  const isFuture = goal.status === 'planning'

  const utils = trpc.useUtils()
  const completeMutation = trpc.goal.complete.useMutation({ onSettled: () => void utils.goal.tree.invalidate() })
  const uncompleteMutation = trpc.goal.uncomplete.useMutation({ onSettled: () => void utils.goal.tree.invalidate() })

  // ★ pin — toggles this goal in the Up-next queue.
  const upNextQuery = trpc.upNext.list.useQuery()
  const isPinned = (upNextQuery.data ?? []).some((u) => u.goalId === goal.id)
  const upNextAdd = trpc.upNext.add.useMutation({ onSettled: () => void utils.upNext.list.invalidate() })
  const upNextRemove = trpc.upNext.remove.useMutation({ onSettled: () => void utils.upNext.list.invalidate() })

  // Drag-to-reorder among sibling goals.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: goal.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  const cardClass = [
    'v2-goalcard',
    selected ? 'sel' : '',
    isFuture ? 'future' : '',
    isDone ? 'done-goal' : '',
  ].filter(Boolean).join(' ')

  return (
    <div ref={setNodeRef} style={style}>
      <div
        {...attributes}
        {...listeners}
        onClick={() => setSelGoal(goal.id)}
        className={cardClass}
      >
        <div className="t">
          <input
            type="checkbox"
            checked={isDone}
            onClick={(e) => e.stopPropagation()}
            onChange={() =>
              isDone ? uncompleteMutation.mutate({ id: goal.id }) : completeMutation.mutate({ id: goal.id })
            }
            aria-label={isDone ? `Mark goal not done: ${goal.title}` : `Complete goal: ${goal.title}`}
            className="ck goal-ck"
          />
          <span style={{ textDecoration: isDone ? 'line-through' : undefined, flex: 1 }}>
            {goal.title}
          </span>
          {isFuture && <span className="chip future">future</span>}
          {isDone && <span className="chip archived">archived</span>}
          {goal.isBlocked && (
            <span className="chip p2" title="Waiting on a prerequisite goal">blocked</span>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {dl && (
              <span className={'meta' + (dl.overdue ? ' overdue' : '')}>
                ⏱ {dl.txt}
              </span>
            )}
            {!isDone && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (isPinned) upNextRemove.mutate({ kind: 'goal', id: goal.id })
                  else upNextAdd.mutate({ kind: 'goal', id: goal.id })
                }}
                className={'pin' + (isPinned ? ' on' : '')}
                aria-label={isPinned ? 'Remove from Up next' : 'Add to Up next'}
                title={isPinned ? 'Remove from Up next' : 'Add to Up next'}
              >
                ★
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setDetailOpen((v) => !v) }}
              className="opacity-0 group-hover:opacity-100 ghostbtn"
              aria-label="Edit all details"
              title="Edit all details"
            >
              ⚙
            </button>
          </span>
        </div>

        {/* Progress bar + count. */}
        <div className="m">
          <span className="pbar"><span style={{ width: `${pct}%` }} /></span>
          <span className="meta">{pct}%</span>
        </div>
      </div>

      {detailOpen && (
        <ItemDetailModal kind="goal" id={goal.id} onClose={() => setDetailOpen(false)} />
      )}
    </div>
  )
}

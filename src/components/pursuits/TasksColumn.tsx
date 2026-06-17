'use client'

/**
 * TasksColumn — right column of Mission Control.
 *
 * Shows the tasks of the selected goal (or the area's loose tasks when no goal
 * is selected). Top: a breadcrumb (Area › Goal) + the selected goal header,
 * which preserves the legacy GoalHeader details panel — why / finish-criteria
 * editors (saved on blur), the future-goal toggle (planning↔active) and the
 * dependency picker (goal.addDependency / removeDependency). An archive toggle
 * (pursuitsStore.showArchive) sits in the header.
 *
 * Tasks render through SortableTaskGroup filtered by visibleTasks, with the
 * ★ pin enabled (upNextPin). An inline "+ add task" and empty states are
 * included; when hidden done tasks exist a "N finished tasks in the archive"
 * hint is shown.
 *
 * Colour rule (red-green safe): emerald renders blue (primary), amber =
 * overdue / attention.
 */

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { ItemDetailModal } from '@/components/shared/ItemDetailModal'
import { SortableTaskGroup, type FlatTask } from '@/components/tasks/TaskTreeNode'
import { usePursuitsStore } from '@/stores/pursuitsStore'
import { visibleTasks, countTasks, deadlineLabel } from '@/lib/pursuitsDerived'
import type { GoalNode } from '@/stores/goalStore'
import type { Area, PursuitsIndex } from '@/components/tasks/pursuitsShared'

interface TasksColumnProps {
  area: Area | null
  index: PursuitsIndex
  allTasks: FlatTask[]
  shakeId: string | null
  shakeMsg: string | null
}

export function TasksColumn({ area, index, allTasks, shakeId, shakeMsg }: TasksColumnProps) {
  const selGoalId = usePursuitsStore((s) => s.selGoalId)
  const showArchive = usePursuitsStore((s) => s.showArchive)
  const toggleArchive = usePursuitsStore((s) => s.toggleArchive)
  const { rootsByOwner, goalById } = index

  // Resolve the selected goal (only if it lives in the current area or has no
  // area constraint — selecting an area clears selGoalId, so a stale id can't
  // survive an area switch).
  const goal: GoalNode | null = selGoalId ? goalById.get(selGoalId) ?? null : null

  const tasks = goal ? rootsByOwner.get(goal.id) ?? [] : area ? rootsByOwner.get(area.id) ?? [] : []
  const shown = useMemo(() => visibleTasks(tasks, showArchive), [tasks, showArchive])
  const { done: doneCount } = useMemo(() => countTasks(tasks), [tasks])

  const crumb = area
    ? goal
      ? `${area.name} › ${goal.title}`
      : `${area.name} › loose tasks`
    : 'No area'

  return (
    <div className="panel v2-col">
      <div className="v2-crumb">{crumb}</div>

      {goal ? (
        <GoalDetailHeader goal={goal} showArchive={showArchive} toggleArchive={toggleArchive} />
      ) : (
        <div className="v2-goalhead">
          <h3>{area ? 'Loose tasks' : 'No goal'}</h3>
          <label className={'arch-toggle' + (showArchive ? ' on' : '')} onClick={toggleArchive} style={{ marginLeft: 'auto' }}>
            <span className="track" />
            Archive ({doneCount})
          </label>
        </div>
      )}

      {/* Tasks. */}
      {shown.length > 0 ? (
        <SortableTaskGroup
          nodes={shown}
          goalId={goal?.id ?? null}
          parentTaskId={null}
          depth={0}
          allTasks={allTasks}
          shakeId={shakeId}
          shakeMsg={shakeMsg}
          upNextPin
          pmcStyle
        />
      ) : (
        <p className="v2-empty">
          {showArchive
            ? 'No tasks here.'
            : 'Nothing open here — toggle the archive to see finished tasks.'}
        </p>
      )}

      {/* Inline add-task (only when there is an owner to attach to). */}
      {(goal || area) && <AddTaskRow goalId={goal?.id ?? null} areaId={goal ? null : area?.id ?? null} />}

      {/* Archive hint when done tasks are hidden. */}
      {!showArchive && doneCount > 0 && (
        <div className="v2-archsec">
          <div className="lbl">{doneCount} finished task{doneCount > 1 ? 's' : ''} in the archive</div>
        </div>
      )}
    </div>
  )
}

// ─────────────────── Goal header + details panel ───────────────────
// Ported from TaskTree's GoalHeader details panel: why / finish-criteria
// editors (save on blur), future-goal toggle, dependency picker, ⚙ modal.

function GoalDetailHeader({ goal, showArchive, toggleArchive }: { goal: GoalNode; showArchive: boolean; toggleArchive: () => void }) {
  const [showDetails, setShowDetails] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [why, setWhy] = useState(goal.description ?? '')
  const [criteria, setCriteria] = useState(goal.finishCriteria ?? '')
  const [depError, setDepError] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const updateMutation = trpc.goal.update.useMutation({ onSettled: () => void utils.goal.tree.invalidate() })
  const addDepMutation = trpc.goal.addDependency.useMutation({
    onSuccess: () => { setDepError(null); void utils.goal.tree.invalidate() },
    onError: (err) => setDepError(err.message),
  })
  const removeDepMutation = trpc.goal.removeDependency.useMutation({
    onSettled: () => void utils.goal.tree.invalidate(),
  })

  const goalListQuery = trpc.goal.list.useQuery(undefined, { enabled: showDetails })
  const allGoals = goalListQuery.data ?? []
  const depCandidates = allGoals.filter((g) => g.id !== goal.id && !(goal.dependsOn ?? []).includes(g.id))
  const titleOfGoal = (id: string) => allGoals.find((g) => g.id === id)?.title ?? id

  const dl = deadlineLabel(goal.deadline)
  const isFuture = goal.status === 'planning'

  function saveWhy() {
    const trimmed = why.trim()
    if ((trimmed || null) !== (goal.description ?? null)) {
      updateMutation.mutate({ id: goal.id, description: trimmed || null })
    }
  }
  function saveCriteria() {
    const trimmed = criteria.trim()
    if ((trimmed || null) !== (goal.finishCriteria ?? null)) {
      updateMutation.mutate({ id: goal.id, finishCriteria: trimmed || null })
    }
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div className="v2-goalhead">
        <h3>{goal.title}</h3>
        {isFuture && <span className="chip future">future</span>}
        {dl && (
          <span className={'meta' + (dl.overdue ? ' overdue' : '')}>
            ⏱ {dl.txt}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="ghostbtn"
        >
          details
        </button>
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="ghostbtn"
          aria-label="Edit all details"
          title="Edit all details"
        >
          ⚙
        </button>
        <label className={'arch-toggle' + (showArchive ? ' on' : '')} onClick={toggleArchive} style={{ marginLeft: 'auto' }}>
          <span className="track" />
          Archive
        </label>
      </div>

      {detailOpen && (
        <ItemDetailModal kind="goal" id={goal.id} onClose={() => setDetailOpen(false)} />
      )}

      {showDetails && (
        <div className="flex flex-col gap-2 mt-2">
          {/* Why / motivation (saves on blur). */}
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onBlur={saveWhy}
            placeholder="Why this matters…"
            rows={2}
            className="bg-base border border-ink/10 rounded-lg px-2 py-1 text-xs text-ink placeholder:text-muted focus:outline-none focus:border-emerald resize-none"
          />

          {/* Finish criteria (saves on blur). */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Finish criteria</span>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              onBlur={saveCriteria}
              placeholder="Done when…"
              rows={2}
              className="bg-base border border-ink/10 rounded-lg px-2 py-1 text-xs text-ink placeholder:text-muted focus:outline-none focus:border-emerald resize-none"
            />
          </div>

          {/* Metric / deadline read-only context. */}
          {(goal.targetMetric || goal.targetValue != null || goal.deadline) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {(goal.targetMetric || goal.targetValue != null) && (
                <span>
                  Metric: {goal.targetMetric ?? '—'}
                  {goal.targetValue != null ? ` (target ${goal.targetValue})` : ''}
                </span>
              )}
              {goal.deadline && <span>Deadline: {new Date(goal.deadline).toLocaleDateString()}</span>}
            </div>
          )}

          {/* Future-goal toggle. */}
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={isFuture}
              onChange={(e) => updateMutation.mutate({ id: goal.id, status: e.target.checked ? 'planning' : 'active' })}
              className="w-3.5 h-3.5 cursor-pointer accent-emerald"
            />
            Future goal (not started yet)
          </label>

          {/* Dependencies. */}
          <div className="flex flex-col gap-1">
            {(goal.dependsOn ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(goal.dependsOn ?? []).map((pid) => (
                  <span key={pid} className="text-xs px-1.5 py-0.5 rounded bg-ink/10 text-muted flex items-center gap-1">
                    blocked by: {titleOfGoal(pid)}
                    <button
                      type="button"
                      onClick={() => removeDepMutation.mutate({ dependentId: goal.id, prerequisiteId: pid })}
                      className="hover:text-red"
                      aria-label="Remove dependency"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            {depCandidates.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addDepMutation.mutate({ dependentId: goal.id, prerequisiteId: e.target.value })
                }}
                className="bg-base border border-ink/10 rounded-lg px-2 py-1 text-xs text-muted focus:outline-none focus:border-emerald w-fit"
              >
                <option value="">+ blocked by another goal…</option>
                {depCandidates.map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            )}
            {depError && <p className="text-xs text-red">{depError}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────── Inline "+ add task" ───────────────────

function AddTaskRow({ goalId, areaId }: { goalId: string | null; areaId: string | null }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const utils = trpc.useUtils()
  const createMutation = trpc.task.create.useMutation({
    onSuccess: () => { setTitle(''); setAdding(false); void utils.task.tree.invalidate() },
  })

  function add() {
    const t = title.trim()
    if (!t) return
    createMutation.mutate({ title: t, goalId: goalId ?? undefined, areaId: goalId ? undefined : areaId ?? undefined })
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="ghostbtn"
        style={{ marginTop: 8 }}
      >
        + add task
      </button>
    )
  }

  return (
    <div
      className="add-row"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setAdding(false); setTitle('')
        }
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
          if (e.key === 'Escape') { setAdding(false); setTitle('') }
        }}
        placeholder="New task…"
      />
      <button type="button" onClick={add} className="bluebtn">
        Add
      </button>
    </div>
  )
}

'use client'

/**
 * TaskTreeNode + SortableTaskGroup — the recursive renderer for the v2 Tasks
 * revamp (redesign-v2 §2.4).
 *
 * A "sibling group" = tasks that share the same parent (same parentTaskId AND
 * goalId). Each group is its own dnd-kit <SortableContext> so drags only
 * reorder within a group. The two components are mutually recursive:
 *   SortableTaskGroup → TaskTreeNode → (its children) SortableTaskGroup → …
 *
 * Display rule: undone children on top (oldest→newest by position), done
 * children below and grayed. The server already sorts this way; we render in
 * the order received.
 */

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useTaskStore } from '@/stores/taskStore'
import { useUiStore } from '@/stores/uiStore'
import { beginWarmup } from '@/stores/warmupStore'
import { ItemDetailModal } from '@/components/shared/ItemDetailModal'
import { PlanButton } from '@/components/tasks/PlanButton'
import { TimeTally } from '@/components/focus/PursuitFocus'
import { useDailyPlanMode } from '@/components/tasks/dailyPlanContext'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers/_app'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type TaskNode = inferRouterOutputs<AppRouter>['task']['tree'][number]

export interface FlatTask {
  id: string
  title: string
}

// ── group key: identifies a sibling group ────────────────────────────────
// Top-level tasks are owned by a goal (goalId) or, failing that, an area
// (areaId); the owner separates their sibling groups so a drag only reorders
// within one goal's / one area's loose tasks.
export function groupKeyFor(
  goalId: string | null,
  areaId: string | null,
  parentTaskId: string | null,
): string {
  return `${goalId ?? areaId ?? 'none'}::${parentTaskId ?? 'root'}`
}

// ─────────────────── A sortable sibling group ───────────────────

interface SortableTaskGroupProps {
  nodes: TaskNode[]
  goalId: string | null
  parentTaskId: string | null
  depth: number
  allTasks: FlatTask[]
  shakeId: string | null
  shakeMsg: string | null
  /** In a Today card the pushed task IS the card: the node whose id matches
   *  this turns its own drag off so the press reorders the day, while its
   *  subtasks still reorder inside the card. */
  cardRootId?: string
  /** When true, each row shows a hover ★ that toggles the task in the Up-next
   *  queue. Default false → rows render exactly as before (Today surface). */
  upNextPin?: boolean
  /** When true, render task rows with the pursuits-mockup contract classes
   *  (v2-task, ck, t-title, pin, v2-sub). Default false = Today surface,
   *  byte-identical to before. */
  pmcStyle?: boolean
}

export function SortableTaskGroup({
  nodes,
  depth,
  allTasks,
  shakeId,
  shakeMsg,
  cardRootId,
  upNextPin,
  pmcStyle,
}: SortableTaskGroupProps) {
  const ids = nodes.map((n) => n.id)
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {nodes.map((node) => (
        <TaskTreeNode
          key={node.id}
          node={node}
          depth={depth}
          allTasks={allTasks}
          shakeId={shakeId}
          shakeMsg={shakeMsg}
          isCardRoot={cardRootId === node.id}
          upNextPin={upNextPin}
          pmcStyle={pmcStyle}
        />
      ))}
    </SortableContext>
  )
}

// ─────────────────── A single task row (sortable) ───────────────────

interface TaskTreeNodeProps {
  node: TaskNode
  depth: number
  allTasks: FlatTask[]
  shakeId: string | null
  shakeMsg: string | null
  /** True when this row is the root of a Today card (drag off → card reorder). */
  isCardRoot?: boolean
  /** When true, render a hover ★ that toggles this task in the Up-next queue. */
  upNextPin?: boolean
  /** When true, render using pursuits-mockup contract classes (v2-task, ck,
   *  t-title, pin, v2-sub). Default false = Today/standard surface,
   *  byte-identical to the original. */
  pmcStyle?: boolean
}

export function TaskTreeNode({ node, depth, allTasks, shakeId, shakeMsg, isCardRoot, upNextPin, pmcStyle }: TaskTreeNodeProps) {
  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)
  const toggleTaskExpanded = useTaskStore((s) => s.toggleTaskExpanded)
  const openFocusMode = useUiStore((s) => s.openFocusMode)
  const isExpanded = expandedTaskIds.has(node.id)
  const isDone = node.status === 'done'
  const hasChildren = node.children.length > 0

  // Up-next pin state — only queried/rendered when this row opts in (upNextPin).
  const upNextQuery = trpc.upNext.list.useQuery(undefined, { enabled: upNextPin === true })
  const isPinned = upNextPin === true && (upNextQuery.data ?? []).some((u) => u.taskId === node.id)
  const upNextAdd = trpc.upNext.add.useMutation({ onSettled: () => void utils.upNext.list.invalidate() })
  const upNextRemove = trpc.upNext.remove.useMutation({ onSettled: () => void utils.upNext.list.invalidate() })

  const [adding, setAdding] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [notes, setNotes] = useState(node.notes ?? '')
  const [criteria, setCriteria] = useState(node.finishCriteria ?? '')
  const [depError, setDepError] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const invalidate = () => {
    void utils.task.tree.invalidate()
    void utils.task.todayList.invalidate()
  }

  const completeMutation = trpc.task.complete.useMutation({ onSettled: invalidate })
  const uncompleteMutation = trpc.task.uncomplete.useMutation({ onSettled: invalidate })
  const createMutation = trpc.task.create.useMutation({
    onSuccess: () => { setSubtaskTitle(''); setAdding(false); invalidate() },
  })
  const updateMutation = trpc.task.update.useMutation({ onSettled: invalidate })
  const addDepMutation = trpc.task.addDependency.useMutation({
    onSuccess: () => { setDepError(null); invalidate() },
    onError: (err) => setDepError(err.message),
  })
  const removeDepMutation = trpc.task.removeDependency.useMutation({ onSettled: invalidate })

  // Drag model:
  //  • Pursuits ('pursuits')           → every row drags to reorder siblings.
  //  • Today card ROOT (isCardRoot)    → drag OFF; the press bubbles to the
  //    enclosing card so it reorders the day.
  //  • Today card SUBTASK (descendant) → drags to reorder within the card, but
  //    stops its press from bubbling so it doesn't also drag the whole card.
  const mode = useDailyPlanMode()
  const dragDisabled = isCardRoot === true

  // dnd-kit sortable wiring — the whole row is the drag handle (no grip icon).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id, disabled: dragDisabled })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }
  const base = dragDisabled ? {} : { ...attributes, ...listeners }
  const dragProps =
    mode === 'today' && !dragDisabled
      ? {
          ...base,
          onPointerDown: (e: React.PointerEvent) => {
            e.stopPropagation()
            ;(listeners as Record<string, ((e: React.PointerEvent) => void) | undefined>)?.onPointerDown?.(e)
          },
        }
      : base

  const isShaking = shakeId === node.id

  function saveNotes() {
    const trimmed = notes.trim()
    if ((trimmed || null) !== (node.notes ?? null)) {
      updateMutation.mutate({ id: node.id, notes: trimmed || null })
    }
  }

  function saveCriteria() {
    const trimmed = criteria.trim()
    if ((trimmed || null) !== (node.finishCriteria ?? null)) {
      updateMutation.mutate({ id: node.id, finishCriteria: trimmed || null })
    }
  }

  function addSubtask() {
    const t = subtaskTitle.trim()
    if (!t) return
    createMutation.mutate({ title: t, parentTaskId: node.id, goalId: node.goalId })
  }

  // Candidate prerequisites: any task except self and ones already added.
  const candidates = allTasks.filter(
    (t) => t.id !== node.id && !node.dependsOn.includes(t.id),
  )
  const titleOf = (id: string) => allTasks.find((t) => t.id === id)?.title ?? id

  // ─── Shared detail panels (notes, criteria, deps, add-subtask) ────────────
  // Used by both the standard and pmc rendering paths below.
  const detailPanels = (indentPx: number) => (
    <>
      {detailOpen && (
        <div className="mr-2" style={{ marginLeft: indentPx }}>
          <ItemDetailModal kind="task" id={node.id} onClose={() => setDetailOpen(false)} />
        </div>
      )}
      {isShaking && shakeMsg && (
        <div className="text-xs text-red px-2" style={{ marginLeft: indentPx }}>
          {shakeMsg}
        </div>
      )}
      {showDetails && (
        <div className="flex flex-col gap-2 mb-1" style={{ marginLeft: indentPx }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Context notes…"
            rows={2}
            className="bg-base border border-ink/10 rounded-lg px-2 py-1
              text-xs text-ink placeholder:text-muted
              focus:outline-none focus:border-emerald resize-none"
          />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Finish criteria
            </span>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              onBlur={saveCriteria}
              placeholder="Done when…"
              rows={2}
              className="bg-base border border-ink/10 rounded-lg px-2 py-1
                text-xs text-ink placeholder:text-muted
                focus:outline-none focus:border-emerald resize-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            {node.dependsOn.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {node.dependsOn.map((pid) => (
                  <span
                    key={pid}
                    className="text-xs px-1.5 py-0.5 rounded bg-ink/10 text-muted flex items-center gap-1"
                  >
                    depends on: {titleOf(pid)}
                    <button
                      type="button"
                      onClick={() => removeDepMutation.mutate({ dependentId: node.id, prerequisiteId: pid })}
                      className="hover:text-red"
                      aria-label="Remove dependency"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            {candidates.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    addDepMutation.mutate({ dependentId: node.id, prerequisiteId: e.target.value })
                  }
                }}
                className="bg-base border border-ink/10 rounded-lg px-2 py-1
                  text-xs text-muted focus:outline-none focus:border-emerald w-fit"
              >
                <option value="">+ add dependency…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            )}
            {depError && <p className="text-xs text-red">{depError}</p>}
          </div>
        </div>
      )}
      {adding && (
        <div className="flex gap-1 mb-1" style={{ marginLeft: indentPx }}>
          <input
            autoFocus
            value={subtaskTitle}
            onChange={(e) => setSubtaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSubtask()
              if (e.key === 'Escape') { setAdding(false); setSubtaskTitle('') }
            }}
            placeholder="New subtask…"
            className="flex-1 bg-base border border-ink/10 rounded-lg px-2 py-1
              text-xs text-ink placeholder:text-muted
              focus:outline-none focus:border-emerald"
          />
          <button
            type="button"
            onClick={addSubtask}
            className="text-xs px-2 py-1 rounded bg-emerald text-white font-semibold"
          >
            Add
          </button>
        </div>
      )}
    </>
  )

  // ─── PMC (pursuits-mockup) rendering path ──────────────────────────────────
  if (pmcStyle) {
    const rowClass = ['v2-task', isDone ? 'row-done' : '', isPinned ? 'is-next' : ''].filter(Boolean).join(' ')
    const children = isExpanded && hasChildren && (
      <div className="v2-sub">
        <SortableTaskGroup
          nodes={node.children}
          goalId={node.goalId}
          parentTaskId={node.id}
          depth={depth + 1}
          allTasks={allTasks}
          shakeId={shakeId}
          shakeMsg={shakeMsg}
          upNextPin={upNextPin}
          pmcStyle
        />
      </div>
    )
    return (
      <div ref={setNodeRef} style={style} className={isShaking ? 'task-shake' : undefined}>
        <div {...dragProps} className={rowClass} title={dragDisabled ? undefined : 'Drag to reorder'}>
          {/* Expand / collapse */}
          <button
            type="button"
            onClick={() => toggleTaskExpanded(node.id)}
            style={{ width: 16, flexShrink: 0, background: 'none', border: 'none', color: 'var(--faint)', padding: 0 }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
          </button>

          {/* Complete checkbox */}
          <input
            type="checkbox"
            checked={isDone}
            onChange={() =>
              isDone
                ? uncompleteMutation.mutate({ id: node.id })
                : completeMutation.mutate({ id: node.id })
            }
            aria-label={isDone ? `Mark not done: ${node.title}` : `Complete task: ${node.title}`}
            className="ck"
          />

          {/* Title */}
          <span
            onClick={() => toggleTaskExpanded(node.id)}
            className="t-title"
            style={{ cursor: 'pointer' }}
          >
            {node.title}
          </span>

          {/* "Next" chip when pinned */}
          {isPinned && <span className="chip next">▶ next</span>}

          {/* "Archived" chip when done and archive is visible */}
          {isDone && <span className="chip archived">archived</span>}

          {/* Blocked badge */}
          {node.isBlocked && !isDone && (
            <span className="chip p2" title="Waiting on a prerequisite">blocked</span>
          )}

          {/* Rolled-up focus time */}
          <TimeTally kind="task" id={node.id} />

          {/* Hover action buttons */}
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="opacity-0 group-hover:opacity-100 ghostbtn"
            style={{ fontSize: 11 }}
          >
            details
          </button>
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            className="opacity-0 group-hover:opacity-100 ghostbtn"
            aria-label="Edit all details"
            title="Edit all details"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={() => { setAdding(true); if (!isExpanded) toggleTaskExpanded(node.id) }}
            className="opacity-0 group-hover:opacity-100 ghostbtn"
            style={{ fontSize: 11 }}
          >
            + subtask
          </button>
          <button
            type="button"
            onClick={() => openFocusMode(node.id)}
            className="opacity-0 group-hover:opacity-100 ghostbtn"
            style={{ fontSize: 11 }}
            title="Focus mode"
          >
            ▶
          </button>
          <PlanButton kind="task" id={node.id} />

          {/* ★ pin */}
          {!isDone && upNextPin && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (isPinned) upNextRemove.mutate({ kind: 'task', id: node.id })
                else upNextAdd.mutate({ kind: 'task', id: node.id })
              }}
              className={'pin' + (isPinned ? ' on' : '')}
              aria-label={isPinned ? 'Remove from Up next' : 'Add to Up next'}
              title={isPinned ? 'Remove from Up next' : 'Add to Up next'}
            >
              ★
            </button>
          )}
        </div>

        {detailPanels(26)}
        {children}
      </div>
    )
  }

  // ─── Standard (Today / tree) rendering path — byte-identical to before ──────
  return (
    <div ref={setNodeRef} style={style} className={isShaking ? 'task-shake' : undefined}>
      {/* The whole row is the drag handle — press-and-hold then move to
          reorder. A plain click still works (4px activation distance), so the
          checkbox / expand / title clicks are unaffected. No separate icon.
          In 'today' mode dragProps is empty so the whole card drags instead. */}
      <div
        {...dragProps}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg group transition-opacity ${dragDisabled ? '' : 'cursor-grab active:cursor-grabbing'}
          ${isDone ? 'opacity-40' : 'opacity-100'} hover:bg-surface`}
        style={{ marginLeft: `${depth * 18}px` }}
        title={dragDisabled ? undefined : 'Drag to reorder'}
      >
        {/* Expand / collapse */}
        <button
          type="button"
          onClick={() => toggleTaskExpanded(node.id)}
          className="w-4 text-muted shrink-0 hover:text-ink"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
        </button>

        {/* Complete checkbox — click to complete, click again to undo. */}
        <input
          type="checkbox"
          checked={isDone}
          onChange={() =>
            isDone
              ? uncompleteMutation.mutate({ id: node.id })
              : completeMutation.mutate({ id: node.id })
          }
          aria-label={isDone ? `Mark not done: ${node.title}` : `Complete task: ${node.title}`}
          className="w-4 h-4 cursor-pointer accent-emerald shrink-0"
        />

        {/* Title — no flex-1, so the hover actions sit right next to it (like
            goal rows) instead of being pushed to the far right. */}
        <span
          onClick={() => toggleTaskExpanded(node.id)}
          className={`text-sm cursor-pointer
            ${isDone ? 'line-through text-muted' : 'text-ink'}`}
        >
          {node.title}
        </span>

        {/* Subtask count (counts at every level, like goals/areas) */}
        {hasChildren && (
          <span className="text-xs text-muted shrink-0">{node.children.length}</span>
        )}

        {/* Rolled-up focus time on this task (includes every subtask under it). */}
        <TimeTally kind="task" id={node.id} />

        {/* Blocked badge */}
        {node.isBlocked && !isDone && (
          <span
            className="text-xs px-1.5 py-0.5 rounded bg-amber/20 text-amber shrink-0"
            title="Waiting on a prerequisite"
          >
            blocked
          </span>
        )}

        {/* Toggle context notes + dependencies into / out of view */}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className={
            'text-xs transition-all shrink-0 ' +
            (showDetails
              ? 'opacity-100 text-emerald'
              : 'opacity-0 group-hover:opacity-100 text-muted hover:text-emerald')
          }
        >
          details
        </button>

        {/* Edit-everything popup (deadline, dependencies, area, parent, …) */}
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="opacity-0 group-hover:opacity-100 text-base text-muted hover:text-emerald transition-all shrink-0"
          aria-label="Edit all details"
          title="Edit all details"
        >
          ⚙
        </button>

        {/* Add subtask */}
        <button
          type="button"
          onClick={() => { setAdding(true); if (!isExpanded) toggleTaskExpanded(node.id) }}
          className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-emerald transition-all shrink-0"
        >
          + subtask
        </button>

        {/* Enter Focus mode for this task (full-screen single-task environment). */}
        <button
          type="button"
          onClick={() => openFocusMode(node.id)}
          className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-emerald transition-all shrink-0"
          title="Focus mode — work on just this task"
        >
          ▶ Focus
        </button>

        {/* "Just 2 minutes" — a no-pressure warm-up that starts focus immediately. */}
        <button
          type="button"
          onClick={() => beginWarmup(node.id)}
          className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-emerald transition-all shrink-0"
          title="Just 2 minutes — a no-pressure warm-up"
        >
          2 min
        </button>

        {/* Push this task (and all its subtasks) to today's plan. */}
        <PlanButton kind="task" id={node.id} />

        {/* ★ pin to the Up-next queue — only on opt-in surfaces (Mission
            Control). Filled amber when pinned; click toggles. */}
        {upNextPin && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (isPinned) upNextRemove.mutate({ kind: 'task', id: node.id })
              else upNextAdd.mutate({ kind: 'task', id: node.id })
            }}
            className={
              'text-sm shrink-0 transition-all ' +
              (isPinned
                ? 'opacity-100 text-amber'
                : 'opacity-0 group-hover:opacity-100 text-muted hover:text-amber')
            }
            aria-label={isPinned ? 'Remove from Up next' : 'Add to Up next'}
            title={isPinned ? 'Remove from Up next' : 'Add to Up next'}
          >
            ★
          </button>
        )}
      </div>

      {detailPanels(depth * 18 + 28)}

      {/* Children (own sortable group) */}
      {isExpanded && hasChildren && (
        <SortableTaskGroup
          nodes={node.children}
          goalId={node.goalId}
          parentTaskId={node.id}
          depth={depth + 1}
          allTasks={allTasks}
          shakeId={shakeId}
          shakeMsg={shakeMsg}
          upNextPin={upNextPin}
        />
      )}
    </div>
  )
}

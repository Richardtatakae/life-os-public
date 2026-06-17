'use client'

/**
 * SubtaskList.tsx — break the focused task into smaller steps, inside Focus mode.
 *
 * Lists a task's direct children (the real task tree — these also show up in the
 * Pursuits tab) and lets you add a step, check it off, or reopen it. Each step
 * can itself be broken into sub-steps: the ▸ caret expands a nested SubtaskList
 * (recursion, capped at MAX_DEPTH so the UI can't run away). The 📝 button opens
 * a note popup for that step, saved to its own `Task.notes`.
 *
 * Adding / checking / note-saving go through the task router's `create` /
 * `complete` / `update`, which already write Events. Reads via `task.subtasks`
 * (the list) and `task.get` (a step's notes, loaded only when its popup opens).
 */

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'

interface SubtaskListProps {
  parentId: string
  /** When true (arrange mode) the controls are inert so the panel can be dragged. */
  inert?: boolean
  /** Nesting depth — guards the recursion so steps can't nest forever. */
  depth?: number
}

const MAX_DEPTH = 4

export function SubtaskList({ parentId, inert = false, depth = 0 }: SubtaskListProps) {
  const utils = trpc.useUtils()
  const invalidate = () => utils.task.subtasks.invalidate({ parentId })

  const { data: subtasks } = trpc.task.subtasks.useQuery({ parentId })
  const createTask = trpc.task.create.useMutation({ onSuccess: invalidate })
  const completeTask = trpc.task.complete.useMutation({ onSuccess: invalidate })
  const updateTask = trpc.task.update.useMutation({ onSuccess: invalidate })

  const [draft, setDraft] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [noteFor, setNoteFor] = useState<string | null>(null)
  // Inline rename: which step is being edited + its working title.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  function add() {
    const title = draft.trim()
    if (!title) return
    createTask.mutate({ title, parentTaskId: parentId })
    setDraft('')
  }

  function startRename(id: string, current: string) {
    setEditingId(id)
    setEditDraft(current)
  }

  function commitRename() {
    if (!editingId) return
    const title = editDraft.trim()
    const orig = (subtasks ?? []).find((s) => s.id === editingId)?.title
    if (title && title !== orig) updateTask.mutate({ id: editingId, title })
    setEditingId(null)
    setEditDraft('')
  }

  function cancelRename() {
    setEditingId(null)
    setEditDraft('')
  }

  function toggle(id: string, done: boolean) {
    if (done) updateTask.mutate({ id, status: 'todo' })
    else completeTask.mutate({ id })
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const list = subtasks ?? []
  const canNest = depth < MAX_DEPTH

  return (
    <div className="flex flex-col gap-2">
      {list.length > 0 && (
        <ul className="flex flex-col gap-1">
          {list.map((s) => {
            const done = s.status === 'done'
            const isOpen = expanded.has(s.id)
            return (
              <li key={s.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  {canNest ? (
                    <button
                      onClick={() => toggleExpand(s.id)}
                      onPointerDown={(e) => e.stopPropagation()}
                      disabled={inert}
                      className="w-4 shrink-0 text-faint hover:text-ink transition-colors disabled:opacity-40"
                      title={isOpen ? 'Hide sub-steps' : 'Break into sub-steps'}
                      aria-label={isOpen ? 'Hide sub-steps' : 'Break into sub-steps'}
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={inert}
                    onChange={() => toggle(s.id, done)}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-emerald"
                    aria-label={done ? `Reopen step: ${s.title}` : `Complete step: ${s.title}`}
                  />
                  {editingId === s.id ? (
                    <input
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        // Keep these keys inside the input — don't let Enter add a
                        // step or Escape close the whole Focus overlay.
                        if (e.key === 'Enter') {
                          e.stopPropagation()
                          commitRename()
                        } else if (e.key === 'Escape') {
                          e.stopPropagation()
                          cancelRename()
                        }
                      }}
                      disabled={inert}
                      className="flex-1 rounded border border-emerald bg-base px-1.5 py-0.5 text-sm text-ink focus:outline-none"
                    />
                  ) : (
                    <span
                      onDoubleClick={() => !inert && startRename(s.id, s.title)}
                      title="Double-click to rename"
                      className={`flex-1 cursor-text ${done ? 'text-faint line-through' : 'text-ink'}`}
                    >
                      {s.title}
                    </span>
                  )}
                  <button
                    onClick={() => setNoteFor(s.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    disabled={inert}
                    className="shrink-0 rounded px-1 text-xs text-faint hover:text-emerald transition-colors disabled:opacity-40"
                    title="Open a note for this step"
                    aria-label={`Open a note for step: ${s.title}`}
                  >
                    📝
                  </button>
                </div>
                {canNest && isOpen && (
                  <div className="ml-2 border-l border-line pl-3">
                    <SubtaskList parentId={s.id} inert={inert} depth={depth + 1} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={inert}
        placeholder="Add a step…  (Enter)"
        className="w-full rounded-lg border border-line bg-base px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-emerald focus:outline-none disabled:opacity-60"
      />
      {noteFor && (
        <SubtaskNoteModal
          taskId={noteFor}
          title={list.find((s) => s.id === noteFor)?.title ?? 'Step'}
          onClose={() => setNoteFor(null)}
        />
      )}
    </div>
  )
}

// ── Note popup ─────────────────────────────────────────────────────────────────

/**
 * A focused notepad for a single step. Loads that step's `Task.notes` lazily and
 * saves on close (or Escape). Escape is caught in the capture phase and stopped
 * so it closes only this popup, not the whole Focus overlay.
 */
function SubtaskNoteModal({
  taskId,
  title,
  onClose,
}: {
  taskId: string
  title: string
  onClose: () => void
}) {
  const { data: task } = trpc.task.get.useQuery({ id: taskId })
  const updateTask = trpc.task.update.useMutation()

  // null = not seeded yet (still loading the step's notes).
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    if (task && draft === null) setDraft(task.notes ?? '')
  }, [task, draft])

  function close() {
    if (draft !== null && task && draft !== (task.notes ?? '')) {
      updateTask.mutate({ id: taskId, notes: draft })
    }
    onClose()
  }

  // Esc closes just this popup (capture + stop so the overlay's Esc doesn't fire).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  })

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-base/80 p-6"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-faint">Step note</p>
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
          </div>
          <button
            onClick={close}
            className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-ink/10 hover:text-ink transition-colors"
            title="Close (saves)"
          >
            ✕
          </button>
        </div>
        <textarea
          autoFocus
          value={draft ?? ''}
          disabled={draft === null}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write things down for this step…"
          rows={7}
          className="w-full resize-none rounded-xl border border-line bg-base p-3 text-sm text-ink placeholder:text-faint focus:border-emerald focus:outline-none"
        />
        <div className="mt-3 flex justify-end">
          <button
            onClick={close}
            className="rounded-xl bg-emerald px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition-colors"
          >
            Save &amp; close
          </button>
        </div>
      </div>
    </div>
  )
}

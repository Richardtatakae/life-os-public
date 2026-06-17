'use client'

/**
 * FocusTimerBar.tsx — the editable "upper bar" of Pomodoro timers in Focus mode.
 *
 * Renders the user's DB-backed FocusTimers as selectable chips. You can:
 *  • click a chip to select it (drives the next Focus interval),
 *  • ＋ add a new timer (name + work/break minutes),
 *  • ✎ edit an existing one,
 *  • ✕ delete one (the last remaining timer is protected),
 *  • drag a chip to reorder (whole-body handle, 4px activation — see SortableList).
 *
 * Selection lives in FocusOverlay (it needs the chosen timer's minutes); this
 * component owns the list + CRUD. While `disabled` (mid-interval) the chips are
 * read-only — you can't retime a running session.
 */

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { SortableList, SortableItem } from '@/components/shared/SortableList'

export interface FocusTimerLite {
  id: string
  name: string
  workMin: number
  breakMin: number
}

interface FocusTimerBarProps {
  timers: FocusTimerLite[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Mid-interval: show chips read-only (no select / add / edit / reorder). */
  disabled?: boolean
}

type EditorState =
  | null
  | { mode: 'create' }
  | { mode: 'edit'; id: string }

export function FocusTimerBar({ timers, selectedId, onSelect, disabled = false }: FocusTimerBarProps) {
  const utils = trpc.useUtils()
  const invalidate = () => utils.focusTimer.list.invalidate()

  const createTimer = trpc.focusTimer.create.useMutation({ onSuccess: invalidate })
  const updateTimer = trpc.focusTimer.update.useMutation({ onSuccess: invalidate })
  const removeTimer = trpc.focusTimer.remove.useMutation({ onSuccess: invalidate })
  const reorderTimer = trpc.focusTimer.reorder.useMutation({ onSettled: invalidate })

  const [editor, setEditor] = useState<EditorState>(null)
  const [name, setName] = useState('')
  const [work, setWork] = useState(25)
  const [brk, setBrk] = useState(5)

  function openCreate() {
    setName('')
    setWork(25)
    setBrk(5)
    setEditor({ mode: 'create' })
  }

  function openEdit(t: FocusTimerLite) {
    setName(t.name)
    setWork(t.workMin)
    setBrk(t.breakMin)
    setEditor({ mode: 'edit', id: t.id })
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    const w = Math.max(1, Math.min(180, Math.round(work)))
    const b = Math.max(1, Math.min(60, Math.round(brk)))
    if (editor?.mode === 'create') {
      const created = await createTimer.mutateAsync({ name: trimmed, workMin: w, breakMin: b })
      onSelect(created.id)
    } else if (editor?.mode === 'edit') {
      await updateTimer.mutateAsync({ id: editor.id, name: trimmed, workMin: w, breakMin: b })
    }
    setEditor(null)
  }

  function remove(id: string) {
    if (timers.length <= 1) return
    removeTimer.mutate({ id })
    if (selectedId === id) {
      const next = timers.find((t) => t.id !== id)
      if (next) onSelect(next.id)
    }
  }

  // Read-only chip row while a session is running.
  if (disabled) {
    return (
      <div className="flex flex-wrap justify-center gap-2">
        {timers.map((t) => (
          <span
            key={t.id}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              selectedId === t.id ? 'bg-emerald text-white' : 'bg-surface text-faint'
            }`}
          >
            {t.name} · {t.workMin}/{t.breakMin}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <SortableList
        ids={timers.map((t) => t.id)}
        onReorder={(orderedIds) => reorderTimer.mutate({ orderedIds })}
        className="flex flex-wrap items-center justify-center gap-2"
      >
        {timers.map((t) => {
          const isSel = selectedId === t.id
          return (
            <SortableItem key={t.id} id={t.id}>
              <div
                className={`group flex items-center gap-1 rounded-full pl-3 pr-1.5 py-1 text-xs font-medium transition-colors ${
                  isSel ? 'bg-emerald text-white' : 'bg-surface text-muted hover:bg-ink/10'
                }`}
              >
                <button onClick={() => onSelect(t.id)} className="select-none" title={`${t.workMin} min work / ${t.breakMin} min break`}>
                  {t.name} · {t.workMin}/{t.breakMin}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(t)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`ml-0.5 rounded-full px-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                    isSel ? 'hover:bg-white/20' : 'hover:bg-ink/20'
                  }`}
                  title="Edit timer"
                >
                  ✎
                </button>
                {timers.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(t.id)
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`rounded-full px-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                      isSel ? 'hover:bg-white/20' : 'hover:bg-ink/20'
                    }`}
                    title="Delete timer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </SortableItem>
          )
        })}
      </SortableList>

      <button
        onClick={openCreate}
        className="rounded-full border border-dashed border-line px-3 py-1 text-xs text-muted hover:border-emerald hover:text-emerald transition-colors"
      >
        ＋ New timer
      </button>

      {editor && (
        <div className="mt-1 flex flex-wrap items-end justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
          <label className="flex flex-col text-[10px] uppercase tracking-wide text-faint">
            name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') setEditor(null)
              }}
              placeholder="e.g. Sprint"
              className="mt-0.5 w-28 rounded border border-line bg-base px-2 py-1 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wide text-faint">
            work
            <input
              type="number"
              min={1}
              max={180}
              value={work}
              onChange={(e) => setWork(Number(e.target.value) || 1)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') setEditor(null)
              }}
              className="mt-0.5 w-16 rounded border border-line bg-base px-2 py-1 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wide text-faint">
            break
            <input
              type="number"
              min={1}
              max={60}
              value={brk}
              onChange={(e) => setBrk(Number(e.target.value) || 1)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') setEditor(null)
              }}
              className="mt-0.5 w-16 rounded border border-line bg-base px-2 py-1 text-sm text-ink"
            />
          </label>
          <button
            onClick={submit}
            disabled={!name.trim() || createTimer.isPending || updateTimer.isPending}
            className="rounded-lg bg-emerald px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {editor.mode === 'create' ? 'Add' : 'Save'}
          </button>
          <button
            onClick={() => setEditor(null)}
            className="px-2 py-1.5 text-xs text-faint hover:text-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

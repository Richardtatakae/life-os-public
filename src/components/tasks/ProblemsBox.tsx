'use client'

/**
 * ProblemsBox — the Pursuits capture box (stacked below the areas).
 *
 * A lightweight scratchpad for jotting single-line "problems" you want to turn
 * into goals/tasks later. Collapsible header (with a count) like an Area;
 * expand to see the list, add a new item, rename inline, or remove one.
 *
 * All data goes through the `problem` tRPC router (Prisma + Event log).
 */

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'

export function ProblemsBox() {
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')

  const utils = trpc.useUtils()
  const problemsQuery = trpc.problem.list.useQuery()
  const problems = problemsQuery.data ?? []

  const createMutation = trpc.problem.create.useMutation({
    onSuccess: () => { setText(''); void utils.problem.list.invalidate() },
  })
  const removeMutation = trpc.problem.remove.useMutation({
    onSettled: () => { void utils.problem.list.invalidate() },
  })

  function openAdd() {
    setAdding(true)
    setExpanded(true)
  }

  function add() {
    const t = text.trim()
    if (!t) return
    createMutation.mutate({ text: t })
  }

  return (
    // No border (set apart from the bordered areas by a divider above it in
    // TaskTree). Uses the theme's default body font like the rest.
    <div className="rounded-lg bg-surface w-full font-bold">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 group">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-4 text-muted shrink-0 hover:text-ink transition-colors"
          aria-label={expanded ? 'Collapse problems' : 'Expand problems'}
        >
          {problems.length > 0 ? (expanded ? '▾' : '▸') : '·'}
        </button>

        <span
          onClick={() => setExpanded((v) => !v)}
          className="text-sm font-semibold text-ink uppercase tracking-wide cursor-pointer"
        >
          Problems
        </span>

        <span className="text-xs text-muted shrink-0">{problems.length}</span>

        <button
          type="button"
          onClick={openAdd}
          className="opacity-0 group-hover:opacity-100 text-xs px-2 py-0.5 rounded border border-ink/30 text-muted hover:text-ink hover:border-ink/50 transition-all shrink-0"
        >
          + New problem
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-3 pb-2">
          {problems.length === 0 && !adding && (
            <p className="text-muted text-xs py-2">
              Empty — jot down a problem to turn into a goal or task later.
            </p>
          )}

          {problems.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg group/row hover:bg-base transition-colors"
            >
              <span className="flex-1 text-sm text-ink">{p.text}</span>
              <button
                type="button"
                onClick={() => removeMutation.mutate({ id: p.id })}
                className="opacity-0 group-hover/row:opacity-100 text-xs text-muted hover:text-red transition-all shrink-0"
                aria-label="Remove problem"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}

          {adding && (
            <div
              className="flex gap-1 mt-1"
              // Click/tab away (not onto Add) → discard and close.
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setAdding(false)
                  setText('')
                }
              }}
            >
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add()
                  if (e.key === 'Escape') { setAdding(false); setText('') }
                }}
                placeholder="New problem…"
                className="flex-1 bg-base border border-ink/10 rounded-lg px-2 py-1
                  text-xs text-ink placeholder:text-muted
                  focus:outline-none focus:border-emerald"
              />
              <button
                type="button"
                onClick={add}
                className="text-xs px-2 py-1 rounded bg-emerald text-white font-semibold"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

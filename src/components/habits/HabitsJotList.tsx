'use client'

/**
 * HabitsJotList — temporary contents of the Habits tab.
 *
 * A simple freeform scratchpad: type a line and hit Enter (or "Add") to jot it
 * down; hover an item to remove it. This is a placeholder until the proper
 * habit-tracking tool is built later. All data goes through the `habitNote`
 * tRPC router (Prisma + Event log). Mirrors the Ideas list.
 */

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { SortableList, SortableItem } from '@/components/shared/SortableList'

export function HabitsJotList() {
  const [text, setText] = useState('')

  const utils = trpc.useUtils()
  const notesQuery = trpc.habitNote.list.useQuery()
  const notes = notesQuery.data ?? []

  const createMutation = trpc.habitNote.create.useMutation({
    onSuccess: () => { setText(''); void utils.habitNote.list.invalidate() },
  })
  const removeMutation = trpc.habitNote.remove.useMutation({
    onSettled: () => { void utils.habitNote.list.invalidate() },
  })
  const reorderMutation = trpc.habitNote.reorder.useMutation({
    onSettled: () => { void utils.habitNote.list.invalidate() },
  })

  function add() {
    const t = text.trim()
    if (!t) return
    createMutation.mutate({ text: t })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1
        className="box-drag-handle cursor-grab active:cursor-grabbing select-none inline-block text-lg font-semibold text-ink uppercase tracking-wide mb-1"
        title="Drag to move · drag any edge to resize"
      >
        Habits
      </h1>
      <p className="text-muted text-xs mb-3">
        A quick jot list for now — a proper habit tracker is coming later.
      </p>

      {/* Add box — always visible at the top. */}
      <div className="flex gap-2 mb-4">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Write down a habit…"
          className="flex-1 bg-base border border-ink/10 rounded-lg px-3 py-2
            text-sm text-ink placeholder:text-muted
            focus:outline-none focus:border-emerald"
        />
        <button
          type="button"
          onClick={add}
          disabled={createMutation.isPending || !text.trim()}
          className="text-sm px-4 py-2 rounded-lg bg-emerald text-white font-semibold
            hover:opacity-90 transition disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* List */}
      {notes.length === 0 ? (
        <p className="text-muted text-sm py-6 text-center">
          Nothing yet — write down your first habit above.
        </p>
      ) : (
        <SortableList
          ids={notes.map((n) => n.id)}
          onReorder={(orderedIds) => reorderMutation.mutate({ orderedIds })}
          className="flex flex-col gap-1"
        >
          {notes.map((note) => (
            <SortableItem
              key={note.id}
              id={note.id}
              className="flex items-start gap-2 px-3 py-2 rounded-lg group hover:bg-surface transition-colors"
            >
              <span className="text-muted shrink-0 select-none">•</span>
              <span className="flex-1 text-sm text-ink whitespace-pre-wrap break-words">{note.text}</span>
              <button
                type="button"
                onClick={() => removeMutation.mutate({ id: note.id })}
                onPointerDown={(e) => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-red transition-all shrink-0"
                aria-label="Remove"
                title="Remove"
              >
                ✕
              </button>
            </SortableItem>
          ))}
        </SortableList>
      )}
    </div>
  )
}

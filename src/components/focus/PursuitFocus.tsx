'use client'

/**
 * PursuitFocus — the Focus affordance + rolled-up time tally for a Pursuit row
 * (area / project / goal / task) in the Pursuits tree.
 *
 *  • <FocusRowButton> — a hover-revealed "▶ Focus" button that opens Focus mode
 *    against this entity directly (no fake auto-created task). Time recorded in
 *    that session rolls up the hierarchy (see the `time` router).
 *  • <TimeTally> — a small always-visible "Σ 1h 20m" chip showing the total
 *    focus time on this entity, INCLUDING everything nested under it (a goal's
 *    number includes all its tasks/subtasks). Renders nothing when the total
 *    is zero, so untouched rows stay clean.
 *
 * Both read the shared `time.totals` query (React Query dedupes the call across
 * every row, so the whole tree costs one request).
 */

import { trpc } from '@/lib/trpc/client'
import { useUiStore, type FocusKind } from '@/stores/uiStore'
import { formatWorked } from '@/lib/formatTime'

function useRolledUpMs(kind: FocusKind, id: string): number {
  const { data } = trpc.time.totals.useQuery()
  if (!data) return 0
  const bucket =
    kind === 'task' ? data.tasks
    : kind === 'goal' ? data.goals
    : kind === 'project' ? data.projects
    : data.areas
  return bucket[id] ?? 0
}

export function FocusRowButton({ kind, id }: { kind: FocusKind; id: string }) {
  const openFocusMode = useUiStore((s) => s.openFocusMode)
  return (
    <button
      type="button"
      onClick={() => openFocusMode({ kind, id })}
      className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-emerald transition-all shrink-0"
      title={`Focus mode — work on this ${kind} (time rolls up the hierarchy)`}
    >
      ▶ Focus
    </button>
  )
}

export function TimeTally({ kind, id }: { kind: FocusKind; id: string }) {
  const ms = useRolledUpMs(kind, id)
  if (ms <= 0) return null
  return (
    <span
      className="text-[10px] text-muted/80 shrink-0 tabular-nums"
      title="Total focus time, including everything nested under this"
    >
      Σ {formatWorked(ms)}
    </span>
  )
}

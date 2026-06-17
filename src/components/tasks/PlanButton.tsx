'use client'

/**
 * PlanButton — the "push to today's planner" control on Pursuits rows. One
 * component, two looks based on the surface (see dailyPlanContext):
 *
 *   • Pursuits surface:
 *       – not on today's planner → "☆ Today"  (click to push)
 *       – already on the planner → "★ Today"  (click to remove)
 *   • Today surface:
 *       – only pushed items show a "✕ remove" button.
 *
 * It pushes the real entity (kind, id) onto the day planner's box via the
 * `dayPlanner` router. The planner only holds tasks and goals, so project/area
 * rows render no control (you push their individual tasks/goals instead).
 * The pushed item stays visible in Pursuits — only a block is added to the box.
 */

import { trpc } from '@/lib/trpc/client'
import { useDailyPlanMode, usePlannerDate, type DailyPlanMode } from './dailyPlanContext'

export type PlanKind = 'task' | 'goal' | 'project' | 'area'

interface PlanButtonProps {
  kind: PlanKind
  id: string
}

export function PlanButton({ kind, id }: PlanButtonProps) {
  const mode: DailyPlanMode = useDailyPlanMode()
  const date = usePlannerDate()
  const utils = trpc.useUtils()

  const { data: today = [] } = trpc.dayPlanner.today.useQuery({ date })

  const invalidate = () => void utils.dayPlanner.today.invalidate()
  const addMutation = trpc.dayPlanner.addFromPursuits.useMutation({ onSettled: invalidate })
  const removeMutation = trpc.dayPlanner.removeByRef.useMutation({ onSettled: invalidate })

  // The planner only schedules tasks and goals — containers show no control.
  if (kind !== 'task' && kind !== 'goal') return null
  const ref = { kind, id, date }

  const isPlanned = today.some((b) => (kind === 'task' ? b.taskId === id : b.goalId === id))

  // On the Today surface, only pushed items offer a remove control.
  if (mode === 'today') {
    if (!isPlanned) return null
    return (
      <button
        type="button"
        onClick={() => removeMutation.mutate(ref)}
        className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-red transition-all shrink-0"
        aria-label="Remove from today"
        title="Remove from today's planner"
      >
        ✕
      </button>
    )
  }

  // Pursuits surface — a star toggle. Filled + always visible when planned;
  // hollow + reveal-on-hover when not (so it doesn't clutter the row).
  return (
    <button
      type="button"
      onClick={() => (isPlanned ? removeMutation.mutate(ref) : addMutation.mutate(ref))}
      className={
        'text-xs transition-all shrink-0 ' +
        (isPlanned
          ? 'opacity-100 text-amber'
          : 'opacity-0 group-hover:opacity-100 text-muted hover:text-amber')
      }
      aria-label={isPlanned ? 'Remove from today' : 'Add to today'}
      title={isPlanned ? "On today's planner — click to remove" : "Add to today's planner"}
    >
      {isPlanned ? '★ Today' : '☆ Today'}
    </button>
  )
}

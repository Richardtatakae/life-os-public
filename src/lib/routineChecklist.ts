/**
 * routineChecklist — the pure rule deciding when an attached routine's checklist
 * counts as "complete" for a given habit-day.
 *
 * When a Routine is attached to a LifeHabit, every step (RoutineItem) and every
 * condition (RoutineCondition) becomes a checkbox in the habit's per-day
 * checklist. The habit's day is auto-ticked only when ALL of those boxes are
 * done — and un-ticked the moment any one is cleared (two-way sync). This file
 * holds just that decision so it can be unit-tested without a database; the
 * server (lifeHabit.setChecklistItem) calls it and then writes the LifeHabitDay.
 */

/**
 * True when every source (step + condition) id has a matching `done: true` entry
 * in `checks`. A missing id reads as not-done. An empty routine (no steps and no
 * conditions) returns false — there is nothing to complete, so it never
 * auto-ticks a habit.
 *
 * @param sourceIds every RoutineItem.id + RoutineCondition.id in the routine
 * @param checks    sourceId -> done for this (habit, date); missing = false
 */
export function checklistComplete(
  sourceIds: string[],
  checks: Map<string, boolean>,
): boolean {
  if (sourceIds.length === 0) return false
  return sourceIds.every((id) => checks.get(id) === true)
}

/**
 * True when AT LEAST ONE of the attached routines is fully complete (OR logic).
 * A habit can attach several routines — e.g. "Evening Flow" attaches both a
 * "Sleep Routine Solo" and a "Sleep Routine Social". Completing the boxes of
 * *either* one auto-ticks the habit's day; the others don't all have to be done.
 *
 * Returns false when there are no routines, or when every routine is empty or
 * has an unchecked box. `checks` is shared across all routines (keyed by source
 * id), so a box ticked in one routine only counts toward that routine's ids.
 *
 * @param routines each attached routine's full set of step + condition ids
 * @param checks   sourceId -> done for this (habit, date); missing = false
 */
export function anyRoutineComplete(
  routines: { sourceIds: string[] }[],
  checks: Map<string, boolean>,
): boolean {
  return routines.some((r) => checklistComplete(r.sourceIds, checks))
}

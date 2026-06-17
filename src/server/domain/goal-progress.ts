/**
 * goal-progress.ts — Pure domain logic for computing goal progress.
 *
 * Rule (v1):
 *  - Each habit contributes `min(currentStreak / targetStreak, 1)` weighted.
 *  - Each task contributes 1 if status='done' else 0, weighted.
 *  - Each child contributes its computed `progress` (0..1), weighted.
 *  - Final = sum(weighted contributions) / sum(weights). Empty inputs → 0.
 *
 * Default targetStreak when none provided: 30 (mastered threshold).
 * Decision (2026-05-15): GoalHabit has no targetStreak field in v1 schema.
 * We hardcode 30 as the mastery threshold. This aligns with the streak stage
 * thresholds in streaks.ts (mastered = currentStreak >= 30).
 *
 * NO database imports. Pure functions only.
 */

export const DEFAULT_TARGET_STREAK = 30

export interface HabitContribution {
  currentStreak: number
  /** When this habit is linked to a goal, what streak counts as "done". Default: 30. */
  targetStreak: number
  /** GoalHabit.weight (default 1) */
  weight: number
}

export interface TaskContribution {
  status: string  // TaskStatus value
  weight?: number // default 1
}

export interface ChildContribution {
  progress: number // 0..1, already-computed child progress
  weight?: number  // default 1
}

export interface GoalProgressInput {
  habits: HabitContribution[]
  tasks: TaskContribution[]
  children: ChildContribution[]
}

/**
 * Computes the 0..1 progress for a goal node.
 *
 * Each input can be empty — empty inputs return 0.
 * If all inputs have weight = 0, returns 0.
 */
export function computeGoalProgress(input: GoalProgressInput): number {
  const { habits, tasks, children } = input

  let weightedSum = 0
  let totalWeight = 0

  // Habit contributions: min(currentStreak / targetStreak, 1) * weight
  for (const h of habits) {
    const target = h.targetStreak > 0 ? h.targetStreak : DEFAULT_TARGET_STREAK
    const w = h.weight > 0 ? h.weight : 1
    const contribution = Math.min(h.currentStreak / target, 1)
    weightedSum += contribution * w
    totalWeight += w
  }

  // Task contributions: 1 if done, 0 otherwise
  for (const t of tasks) {
    const w = (t.weight != null && t.weight > 0) ? t.weight : 1
    const contribution = t.status === 'done' ? 1 : 0
    weightedSum += contribution * w
    totalWeight += w
  }

  // Child contributions: child's computed progress * weight
  for (const c of children) {
    const w = (c.weight != null && c.weight > 0) ? c.weight : 1
    const contribution = Math.min(Math.max(c.progress, 0), 1)
    weightedSum += contribution * w
    totalWeight += w
  }

  if (totalWeight === 0) return 0
  return weightedSum / totalWeight
}

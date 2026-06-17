import { describe, it, expect } from 'vitest'
import {
  computeGoalProgress,
  DEFAULT_TARGET_STREAK,
  type GoalProgressInput,
} from '@/server/domain/goal-progress'

// ─────────────────── Empty input tests ───────────────────

describe('computeGoalProgress — empty inputs', () => {
  it('all empty arrays → 0', () => {
    const input: GoalProgressInput = { habits: [], tasks: [], children: [] }
    expect(computeGoalProgress(input)).toBe(0)
  })

  it('single habit with currentStreak=0 → 0', () => {
    const input: GoalProgressInput = {
      habits: [{ currentStreak: 0, targetStreak: DEFAULT_TARGET_STREAK, weight: 1 }],
      tasks: [],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(0)
  })
})

// ─────────────────── Habit contribution tests ───────────────────

describe('computeGoalProgress — habit contributions', () => {
  it('single habit at full streak → 1.0', () => {
    const input: GoalProgressInput = {
      habits: [{ currentStreak: 30, targetStreak: 30, weight: 1 }],
      tasks: [],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(1)
  })

  it('single habit at half streak → 0.5', () => {
    const input: GoalProgressInput = {
      habits: [{ currentStreak: 15, targetStreak: 30, weight: 1 }],
      tasks: [],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(0.5)
  })

  it('habit streak beyond target is clamped to 1.0', () => {
    const input: GoalProgressInput = {
      habits: [{ currentStreak: 60, targetStreak: 30, weight: 1 }],
      tasks: [],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(1)
  })

  it('two equal-weight habits: one full, one empty → 0.5', () => {
    const input: GoalProgressInput = {
      habits: [
        { currentStreak: 30, targetStreak: 30, weight: 1 },
        { currentStreak: 0, targetStreak: 30, weight: 1 },
      ],
      tasks: [],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(0.5)
  })

  it('weighted habits: weight=2 full + weight=1 empty → 2/3', () => {
    const input: GoalProgressInput = {
      habits: [
        { currentStreak: 30, targetStreak: 30, weight: 2 },
        { currentStreak: 0, targetStreak: 30, weight: 1 },
      ],
      tasks: [],
      children: [],
    }
    expect(computeGoalProgress(input)).toBeCloseTo(2 / 3)
  })
})

// ─────────────────── Task contribution tests ───────────────────

describe('computeGoalProgress — task contributions', () => {
  it('single done task → 1.0', () => {
    const input: GoalProgressInput = {
      habits: [],
      tasks: [{ status: 'done' }],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(1)
  })

  it('single todo task → 0', () => {
    const input: GoalProgressInput = {
      habits: [],
      tasks: [{ status: 'todo' }],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(0)
  })

  it('one done + one todo → 0.5', () => {
    const input: GoalProgressInput = {
      habits: [],
      tasks: [{ status: 'done' }, { status: 'todo' }],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(0.5)
  })

  it('various non-done statuses all contribute 0', () => {
    const statuses = ['inbox', 'todo', 'scheduled', 'in_progress', 'blocked', 'deferred']
    for (const status of statuses) {
      const input: GoalProgressInput = { habits: [], tasks: [{ status }], children: [] }
      expect(computeGoalProgress(input)).toBe(0)
    }
  })
})

// ─────────────────── Child contribution tests ───────────────────

describe('computeGoalProgress — child contributions', () => {
  it('single child at 1.0 → 1.0', () => {
    const input: GoalProgressInput = {
      habits: [],
      tasks: [],
      children: [{ progress: 1.0 }],
    }
    expect(computeGoalProgress(input)).toBe(1)
  })

  it('single child at 0.6 → 0.6', () => {
    const input: GoalProgressInput = {
      habits: [],
      tasks: [],
      children: [{ progress: 0.6 }],
    }
    expect(computeGoalProgress(input)).toBeCloseTo(0.6)
  })

  it('two children at 0.5 and 1.0 equal weight → 0.75', () => {
    const input: GoalProgressInput = {
      habits: [],
      tasks: [],
      children: [{ progress: 0.5 }, { progress: 1.0 }],
    }
    expect(computeGoalProgress(input)).toBeCloseTo(0.75)
  })

  it('child progress is clamped: value > 1 treated as 1', () => {
    const input: GoalProgressInput = {
      habits: [],
      tasks: [],
      children: [{ progress: 2.5 }],
    }
    expect(computeGoalProgress(input)).toBe(1)
  })
})

// ─────────────────── Mixed input tests ───────────────────

describe('computeGoalProgress — mixed inputs', () => {
  it('one done task + one mastered habit → 1.0', () => {
    const input: GoalProgressInput = {
      habits: [{ currentStreak: 30, targetStreak: 30, weight: 1 }],
      tasks: [{ status: 'done' }],
      children: [],
    }
    expect(computeGoalProgress(input)).toBe(1)
  })

  it('habit at 0.5 + done task + child at 1.0 equal weights → (0.5 + 1 + 1) / 3', () => {
    const input: GoalProgressInput = {
      habits: [{ currentStreak: 15, targetStreak: 30, weight: 1 }],
      tasks: [{ status: 'done', weight: 1 }],
      children: [{ progress: 1.0, weight: 1 }],
    }
    expect(computeGoalProgress(input)).toBeCloseTo(2.5 / 3)
  })
})

/**
 * prompts.test.ts — unit tests for the pure prompt builder functions.
 *
 * Blueprint §10.13 / Plan 13.
 * Tests all four builders across template variants and edge cases.
 * No DB access — these are pure functions.
 */

import { describe, it, expect } from 'vitest'
import { buildTaskPrompt } from '@/server/domain/prompts/task-prompt'
import { buildHabitPrompt } from '@/server/domain/prompts/habit-prompt'
import { buildCustomPrompt } from '@/server/domain/prompts/custom-prompt'

// ── Shared helpers ─────────────────────────────────────────────────────────

function makeEvent(action: string, daysAgo = 0) {
  const ts = new Date()
  ts.setDate(ts.getDate() - daysAgo)
  return { timestamp: ts, action, payload: { some: 'data' } }
}

// ── buildTaskPrompt ────────────────────────────────────────────────────────

describe('buildTaskPrompt', () => {
  it('includes the task title in the header line', () => {
    const result = buildTaskPrompt({ title: 'Write the report' })
    expect(result).toContain('You are helping me work on: Write the report')
  })

  it('includes Status line', () => {
    const result = buildTaskPrompt({ title: 'T', status: 'in_progress' })
    expect(result).toContain('- Status: in_progress')
  })

  it('defaults Status to "unknown" when not provided', () => {
    const result = buildTaskPrompt({ title: 'T' })
    expect(result).toContain('- Status: unknown')
  })

  it('includes linked goal title when provided', () => {
    const result = buildTaskPrompt({ title: 'T', linkedGoalTitle: 'Launch MVP' })
    expect(result).toContain('- Linked goal: Launch MVP')
  })

  it('renders "none" when no linked goal', () => {
    const result = buildTaskPrompt({ title: 'T', linkedGoalTitle: null })
    expect(result).toContain('- Linked goal: none')
  })

  it('includes recent event lines', () => {
    const events = [makeEvent('create'), makeEvent('update', 1)]
    const result = buildTaskPrompt({ title: 'T', recentEvents: events })
    expect(result).toContain('create')
    expect(result).toContain('update')
  })

  it('renders placeholder when no recent events', () => {
    const result = buildTaskPrompt({ title: 'T', recentEvents: [] })
    expect(result).toContain('(no recent activity)')
  })

  it('includes notes when provided', () => {
    const result = buildTaskPrompt({ title: 'T', notes: 'Check with team first' })
    expect(result).toContain('Check with team first')
  })

  it('renders "(none)" when no notes', () => {
    const result = buildTaskPrompt({ title: 'T', notes: null })
    expect(result).toContain('Notes: (none)')
  })

  it('includes priority when provided', () => {
    const result = buildTaskPrompt({ title: 'T', priority: 1 })
    expect(result).toContain('- Priority: 1')
  })

  it('includes energy when provided', () => {
    const result = buildTaskPrompt({ title: 'T', energy: 'high' })
    expect(result).toContain('- Energy: high')
  })

  it('includes deadline when provided', () => {
    const deadline = new Date('2026-07-01')
    const result = buildTaskPrompt({ title: 'T', deadline })
    expect(result).toContain('2026-07-01')
  })

  it('includes CLAUDE.md constraints section', () => {
    const result = buildTaskPrompt({ title: 'T' })
    expect(result).toContain('Constraints from CLAUDE.md')
    expect(result).toContain('Literal mode')
    expect(result).toContain('Research escalation')
  })

  it('includes Suggested approach section', () => {
    const result = buildTaskPrompt({ title: 'T' })
    expect(result).toContain('Suggested approach:')
  })

  it('includes vault references when provided', () => {
    const result = buildTaskPrompt({
      title: 'T',
      vaultReferences: ['knowledge/foo.md', 'projects/bar/README.md'],
    })
    expect(result).toContain('knowledge/foo.md')
    expect(result).toContain('projects/bar/README.md')
  })
})

// ── buildHabitPrompt ───────────────────────────────────────────────────────

describe('buildHabitPrompt', () => {
  const base = { habitType: 'checkbox', currentStreak: 7, stage: 'in_training' }

  it('includes the habit name in the header', () => {
    const result = buildHabitPrompt({ title: 'Morning run', ...base })
    expect(result).toContain('You are helping me work on: Morning run')
  })

  it('includes habit type', () => {
    const result = buildHabitPrompt({ title: 'H', ...base, habitType: 'count' })
    expect(result).toContain('Habit type: count')
  })

  it('includes current streak count', () => {
    const result = buildHabitPrompt({ title: 'H', ...base, currentStreak: 42 })
    expect(result).toContain('42 days')
  })

  it('renders stage label for in_training', () => {
    const result = buildHabitPrompt({ title: 'H', ...base, stage: 'in_training' })
    expect(result).toContain('In Training')
  })

  it('renders stage label for mastered', () => {
    const result = buildHabitPrompt({ title: 'H', ...base, stage: 'mastered' })
    expect(result).toContain('Mastered')
  })

  it('renders stage label for legendary', () => {
    const result = buildHabitPrompt({ title: 'H', ...base, stage: 'legendary' })
    expect(result).toContain('Legendary')
  })

  it('renders placeholder when no events', () => {
    const result = buildHabitPrompt({ title: 'H', ...base, recentEvents: [] })
    expect(result).toContain('(no recent activity)')
  })

  it('includes recent events when provided', () => {
    const events = [makeEvent('check'), makeEvent('free_day_used', 2)]
    const result = buildHabitPrompt({ title: 'H', ...base, recentEvents: events })
    expect(result).toContain('check')
    expect(result).toContain('free_day_used')
  })

  it('includes CLAUDE.md constraints', () => {
    const result = buildHabitPrompt({ title: 'H', ...base })
    expect(result).toContain('Constraints from CLAUDE.md')
  })

  it('includes Suggested approach section', () => {
    const result = buildHabitPrompt({ title: 'H', ...base })
    expect(result).toContain('Suggested approach:')
  })
})

// ── buildCustomPrompt ──────────────────────────────────────────────────────

describe('buildCustomPrompt', () => {
  it('includes the custom title', () => {
    const result = buildCustomPrompt({ title: 'Plan the sprint' })
    expect(result).toContain('You are helping me work on: Plan the sprint')
  })

  it('includes context in notes when provided', () => {
    const result = buildCustomPrompt({ title: 'T', notes: 'Context here' })
    expect(result).toContain('Context here')
  })

  it('renders "(none)" when no notes', () => {
    const result = buildCustomPrompt({ title: 'T' })
    expect(result).toContain('Notes: (none)')
  })

  it('renders placeholder when no events', () => {
    const result = buildCustomPrompt({ title: 'T' })
    expect(result).toContain('(no recent activity)')
  })

  it('includes CLAUDE.md constraints', () => {
    const result = buildCustomPrompt({ title: 'T' })
    expect(result).toContain('Constraints from CLAUDE.md')
  })

  it('includes Suggested approach', () => {
    const result = buildCustomPrompt({ title: 'T' })
    expect(result).toContain('Suggested approach:')
  })

  it('includes vault references when provided', () => {
    const result = buildCustomPrompt({ title: 'T', vaultReferences: ['knowledge/x.md'] })
    expect(result).toContain('knowledge/x.md')
  })
})

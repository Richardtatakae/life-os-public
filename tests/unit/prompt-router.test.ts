/**
 * prompt-router.test.ts — integration tests for the prompt tRPC router.
 *
 * Blueprint §10.13 / Plan 13.
 * Uses a real SQLite DB (prisma/data.db).
 * All entities use prefix `__plan13_test_` for safe cleanup.
 *
 * Tests:
 *   forTask   — returns text with title + Status + linked goal + event line + Event row written
 *   forHabit  — returns text with habit name + streak + Event row written
 *   forCustom — returns text with custom title + Event row written
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createCallerFactory } from '@/server/trpc'
import { promptRouter } from '@/server/routers/prompt'
import { prisma } from '@/server/db/client'

const TEST_PREFIX = '__plan13_test_'

const createCaller = createCallerFactory(promptRouter)
const caller = createCaller({ db: prisma })

// ── Cleanup ────────────────────────────────────────────────────────────────

let testGoalId: string
let testTaskId: string
let testHabitId: string
let testStartTime: Date

beforeAll(async () => {
  testStartTime = new Date()

  // Create a goal
  const goal = await prisma.goal.create({
    data: {
      title: `${TEST_PREFIX}goal`,
      status: 'active',
    },
  })
  testGoalId = goal.id

  // Create a task linked to the goal
  const task = await prisma.task.create({
    data: {
      title: `${TEST_PREFIX}task`,
      status: 'todo',
      goalId: testGoalId,
    },
  })
  testTaskId = task.id

  // Write an event for the task so recentEvents is non-empty
  await prisma.event.create({
    data: {
      actor: 'user',
      entityType: 'task',
      entityId: testTaskId,
      action: 'create',
      payload: { title: task.title },
    },
  })

  // Create a habit
  const habit = await prisma.habit.create({
    data: {
      name: `${TEST_PREFIX}habit`,
      type: 'checkbox',
    },
  })
  testHabitId = habit.id

  // Seed StreakState for the habit
  await prisma.streakState.upsert({
    where: { habitId: testHabitId },
    update: { currentStreak: 5, stage: 'in_training' },
    create: {
      habitId: testHabitId,
      currentStreak: 5,
      longestStreak: 5,
      totalChecks: 5,
      totalCount: 5,
      todayCount: 0,
      freeDaysAvailable: 0,
      freeDaysUsed: 0,
      stage: 'in_training',
    },
  })

})

afterAll(async () => {
  // Clean up prompt events
  await prisma.event.deleteMany({
    where: {
      timestamp: { gte: testStartTime },
      entityType: 'prompt',
    },
  })
  // Also clean up the seeded task event
  await prisma.event.deleteMany({
    where: { entityType: 'task', entityId: testTaskId },
  })

  // Clean habit (StreakState cascades)
  if (testHabitId) {
    await prisma.streakState.deleteMany({ where: { habitId: testHabitId } })
    await prisma.habit.deleteMany({ where: { id: testHabitId } })
  }

  // Task before goal (FK)
  if (testTaskId) {
    await prisma.task.deleteMany({ where: { id: testTaskId } })
  }
  if (testGoalId) {
    await prisma.goal.deleteMany({ where: { id: testGoalId } })
  }
})

// ── forTask ────────────────────────────────────────────────────────────────

describe('prompt.forTask', () => {
  it('returns a non-empty text string', async () => {
    const result = await caller.forTask({ taskId: testTaskId })
    expect(result.text).toBeTruthy()
    expect(typeof result.text).toBe('string')
  })

  it('includes the task title', async () => {
    const result = await caller.forTask({ taskId: testTaskId })
    expect(result.text).toContain(`${TEST_PREFIX}task`)
  })

  it('includes Status line', async () => {
    const result = await caller.forTask({ taskId: testTaskId })
    expect(result.text).toContain('Status:')
  })

  it('includes the linked goal title', async () => {
    const result = await caller.forTask({ taskId: testTaskId })
    expect(result.text).toContain(`${TEST_PREFIX}goal`)
  })

  it('includes at least one recent event line (create event)', async () => {
    const result = await caller.forTask({ taskId: testTaskId })
    expect(result.text).toContain('create')
  })

  it('writes an Event row with action generate_task_prompt', async () => {
    await caller.forTask({ taskId: testTaskId })
    const event = await prisma.event.findFirst({
      where: {
        entityType: 'prompt',
        entityId: testTaskId,
        action: 'generate_task_prompt',
        timestamp: { gte: testStartTime },
      },
    })
    expect(event).not.toBeNull()
    expect(event?.actor).toBe('user')
  })
})

// ── forHabit ───────────────────────────────────────────────────────────────

describe('prompt.forHabit', () => {
  it('returns a non-empty text string', async () => {
    const result = await caller.forHabit({ habitId: testHabitId })
    expect(result.text).toBeTruthy()
  })

  it('includes the habit name', async () => {
    const result = await caller.forHabit({ habitId: testHabitId })
    expect(result.text).toContain(`${TEST_PREFIX}habit`)
  })

  it('includes streak count', async () => {
    const result = await caller.forHabit({ habitId: testHabitId })
    expect(result.text).toContain('5 days')
  })

  it('writes an Event row with action generate_habit_prompt', async () => {
    await caller.forHabit({ habitId: testHabitId })
    const event = await prisma.event.findFirst({
      where: {
        entityType: 'prompt',
        entityId: testHabitId,
        action: 'generate_habit_prompt',
        timestamp: { gte: testStartTime },
      },
    })
    expect(event).not.toBeNull()
  })
})

// ── forCustom ──────────────────────────────────────────────────────────────

describe('prompt.forCustom', () => {
  it('returns a non-empty text string', async () => {
    const result = await caller.forCustom({ title: `${TEST_PREFIX}custom-title` })
    expect(result.text).toBeTruthy()
  })

  it('includes the custom title', async () => {
    const result = await caller.forCustom({ title: `${TEST_PREFIX}custom-title` })
    expect(result.text).toContain(`${TEST_PREFIX}custom-title`)
  })

  it('includes context in notes when provided', async () => {
    const result = await caller.forCustom({
      title: `${TEST_PREFIX}custom-title-2`,
      context: 'Some specific context about this topic',
    })
    expect(result.text).toContain('Some specific context about this topic')
  })

  it('writes an Event row with action generate_custom_prompt', async () => {
    const customTitle = `${TEST_PREFIX}custom-event-check`
    await caller.forCustom({ title: customTitle })
    const syntheticId = `custom:${customTitle.slice(0, 60)}`
    const event = await prisma.event.findFirst({
      where: {
        entityType: 'prompt',
        entityId: syntheticId,
        action: 'generate_custom_prompt',
        timestamp: { gte: testStartTime },
      },
    })
    expect(event).not.toBeNull()
  })
})

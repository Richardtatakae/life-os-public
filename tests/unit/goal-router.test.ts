/**
 * goal-router.test.ts — Integration tests for the goal tRPC router.
 *
 * Uses a real SQLite database (prisma/data.db).
 * All test data uses the prefix __plan7_test_ to allow targeted cleanup.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createCallerFactory } from '@/server/trpc'
import { goalRouter } from '@/server/routers/goal'
import { prisma } from '@/server/db/client'

const createCaller = createCallerFactory(goalRouter)
// Context includes db: prisma per src/server/context.ts
const caller = createCaller({ db: prisma })

const PREFIX = '__plan7_test_'

// ─────────────────── Cleanup ───────────────────

async function cleanupTestData() {
  // Find test goals by title prefix
  const testGoals = await prisma.goal.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { id: true },
  })
  const goalIds = testGoals.map((g) => g.id)

  // Find test habits by name prefix
  const testHabits = await prisma.habit.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  })

  if (goalIds.length > 0) {
    await prisma.goalHabit.deleteMany({ where: { goalId: { in: goalIds } } })
    await prisma.task.deleteMany({ where: { goalId: { in: goalIds } } })
    await prisma.goal.deleteMany({ where: { id: { in: goalIds } } })
  }

  if (testHabits.length > 0) {
    await prisma.streakState.deleteMany({
      where: { habitId: { in: testHabits.map((h) => h.id) } },
    })
    await prisma.goalHabit.deleteMany({
      where: { habitId: { in: testHabits.map((h) => h.id) } },
    })
    await prisma.habit.deleteMany({ where: { id: { in: testHabits.map((h) => h.id) } } })
  }
}

beforeAll(async () => {
  await cleanupTestData()
})

afterAll(async () => {
  await cleanupTestData()
  await prisma.$disconnect()
})

// ─────────────────── Tests ───────────────────

describe('goalRouter.create', () => {
  it('creates a root goal and returns it with correct fields', async () => {
    const goal = await caller.create({
      title: `${PREFIX}Health`,
      status: 'active',
      lifeArea: 'Health',
    })

    expect(goal.id).toBeTruthy()
    expect(goal.title).toBe(`${PREFIX}Health`)
    expect(goal.status).toBe('active')
    expect(goal.lifeArea).toBe('Health')
    expect(goal.parentId).toBeNull()
  })

  it('creates a child goal with correct parentId', async () => {
    const parent = await caller.create({
      title: `${PREFIX}Wellness`,
      status: 'active',
    })

    const child = await caller.create({
      title: `${PREFIX}Sleep 8h`,
      parentId: parent.id,
      status: 'planning',
    })

    expect(child.parentId).toBe(parent.id)
    expect(child.status).toBe('planning')
  })

  it('default status is planning when not specified', async () => {
    const goal = await caller.create({ title: `${PREFIX}DefaultStatus` })
    expect(goal.status).toBe('planning')
  })
})

describe('goalRouter.tree', () => {
  it('returns nested tree with parent → child linkage', async () => {
    // Create a parent and two children
    const parent = await caller.create({ title: `${PREFIX}TreeParent` })
    const child1 = await caller.create({
      title: `${PREFIX}TreeChild1`,
      parentId: parent.id,
    })
    const child2 = await caller.create({
      title: `${PREFIX}TreeChild2`,
      parentId: parent.id,
    })

    const tree = await caller.tree()

    // Find our parent node in the tree
    const parentNode = tree.find((n) => n.id === parent.id)
    expect(parentNode).toBeDefined()
    expect(parentNode!.children.length).toBeGreaterThanOrEqual(2)

    const childIds = parentNode!.children.map((c) => c.id)
    expect(childIds).toContain(child1.id)
    expect(childIds).toContain(child2.id)
  })

  it('tree nodes have parentId set correctly', async () => {
    const tree = await caller.tree()
    // Root nodes should have no parentId
    for (const node of tree) {
      expect(node.parentId).toBeNull()
    }
  })
})

describe('goalRouter.linkHabit + unlinkHabit', () => {
  it('links a habit to a goal and can retrieve the link', async () => {
    const goal = await caller.create({ title: `${PREFIX}HabitLinkGoal` })
    const habit = await prisma.habit.create({
      data: { name: `${PREFIX}HabitForLink`, type: 'checkbox' },
    })

    const link = await caller.linkHabit({
      goalId: goal.id,
      habitId: habit.id,
      weight: 2,
    })

    expect(link.goalId).toBe(goal.id)
    expect(link.habitId).toBe(habit.id)
    expect(link.weight).toBe(2)
  })

  it('unlinkHabit removes the link', async () => {
    const goal = await caller.create({ title: `${PREFIX}UnlinkGoal` })
    const habit = await prisma.habit.create({
      data: { name: `${PREFIX}HabitForUnlink`, type: 'checkbox' },
    })

    await caller.linkHabit({ goalId: goal.id, habitId: habit.id, weight: 1 })
    const result = await caller.unlinkHabit({ goalId: goal.id, habitId: habit.id })
    expect(result.success).toBe(true)

    // Confirm link is gone
    const links = await prisma.goalHabit.findMany({ where: { goalId: goal.id } })
    expect(links.find((l) => l.habitId === habit.id)).toBeUndefined()
  })
})

describe('goalRouter.progress', () => {
  it('progress = 0 for goal with no links', async () => {
    const goal = await caller.create({ title: `${PREFIX}EmptyProgressGoal` })
    const result = await caller.progress({ id: goal.id })
    expect(result.progress).toBe(0)
    expect(result.goalId).toBe(goal.id)
  })

  it('progress ~1.0 for goal linked to a mastered habit (streak=30)', async () => {
    const goal = await caller.create({ title: `${PREFIX}MasteredHabitGoal` })
    const habit = await prisma.habit.create({
      data: { name: `${PREFIX}MasteredHabit`, type: 'checkbox' },
    })

    // Upsert a StreakState with currentStreak = 30 (mastered)
    await prisma.streakState.upsert({
      where: { habitId: habit.id },
      create: {
        habitId: habit.id,
        currentStreak: 30,
        longestStreak: 30,
        totalChecks: 30,
        totalCount: 0,
        todayCount: 0,
        freeDaysAvailable: 5,
        freeDaysUsed: 0,
        stage: 'mastered',
      },
      update: {
        currentStreak: 30,
        stage: 'mastered',
      },
    })

    await caller.linkHabit({ goalId: goal.id, habitId: habit.id, weight: 1 })

    const result = await caller.progress({ id: goal.id })
    expect(result.progress).toBeCloseTo(1.0, 5)
    expect(result.contributions.habits).toHaveLength(1)
    expect(result.contributions.habits[0]!.contribution).toBeCloseTo(1.0)
  })

  it('progress rolls up from child to parent goal', async () => {
    const parent = await caller.create({ title: `${PREFIX}RollupParent` })
    const child = await caller.create({
      title: `${PREFIX}RollupChild`,
      parentId: parent.id,
    })

    const habit = await prisma.habit.create({
      data: { name: `${PREFIX}RollupHabit`, type: 'checkbox' },
    })

    await prisma.streakState.upsert({
      where: { habitId: habit.id },
      create: {
        habitId: habit.id,
        currentStreak: 30,
        longestStreak: 30,
        totalChecks: 30,
        totalCount: 0,
        todayCount: 0,
        freeDaysAvailable: 5,
        freeDaysUsed: 0,
        stage: 'mastered',
      },
      update: { currentStreak: 30, stage: 'mastered' },
    })

    // Link habit to child, not parent
    await caller.linkHabit({ goalId: child.id, habitId: habit.id, weight: 1 })

    const parentResult = await caller.progress({ id: parent.id })
    // Parent has no direct links, but has a child with progress ~1.0
    // so rollup should yield progress > 0
    expect(parentResult.progress).toBeGreaterThan(0)
    expect(parentResult.contributions.children).toHaveLength(1)
    expect(parentResult.contributions.children[0]!.progress).toBeCloseTo(1.0, 5)
  })
})

describe('goalRouter.update + archive', () => {
  it('update changes only specified fields', async () => {
    const goal = await caller.create({
      title: `${PREFIX}UpdateTarget`,
      status: 'planning',
      lifeArea: 'Career',
    })

    const updated = await caller.update({
      id: goal.id,
      status: 'active',
    })

    expect(updated.status).toBe('active')
    expect(updated.title).toBe(`${PREFIX}UpdateTarget`)
    expect(updated.lifeArea).toBe('Career')
  })

  it('archive sets status to archived', async () => {
    const goal = await caller.create({ title: `${PREFIX}ArchiveMe` })
    const archived = await caller.archive({ id: goal.id })
    expect(archived.status).toBe('archived')
  })
})

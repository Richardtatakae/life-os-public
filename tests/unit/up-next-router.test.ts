/**
 * up-next-router.test.ts — Integration tests for the upNext tRPC router.
 *
 * Uses a real SQLite database (prisma/data.db).
 * All test data uses the prefix __upnext_test_ to allow targeted cleanup.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createCallerFactory } from '@/server/trpc'
import { upNextRouter } from '@/server/routers/upNext'
import { prisma } from '@/server/db/client'

const createCaller = createCallerFactory(upNextRouter)
const caller = createCaller({ db: prisma })

const PREFIX = '__upnext_test_'

// ─────────────────── Helpers ───────────────────

/** Create a minimal Task for testing (no area/goal required). */
async function createTask(title: string) {
  return prisma.task.create({ data: { title: `${PREFIX}${title}`, status: 'todo' } })
}

/** Create a minimal Goal for testing. */
async function createGoal(title: string) {
  return prisma.goal.create({ data: { title: `${PREFIX}${title}`, status: 'active' } })
}

// ─────────────────── Cleanup ───────────────────

async function cleanupTestData() {
  // Remove all UpNextItems that reference our test tasks/goals.
  const testTasks = await prisma.task.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { id: true },
  })
  const testGoals = await prisma.goal.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { id: true },
  })
  const taskIds = testTasks.map((t) => t.id)
  const goalIds = testGoals.map((g) => g.id)

  await prisma.upNextItem.deleteMany({
    where: { OR: [{ taskId: { in: taskIds } }, { goalId: { in: goalIds } }] },
  })
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } })
  await prisma.goal.deleteMany({ where: { id: { in: goalIds } } })
}

beforeAll(async () => {
  await cleanupTestData()
})

afterAll(async () => {
  await cleanupTestData()
  await prisma.$disconnect()
})

// ─────────────────── Tests ───────────────────

describe('upNextRouter.add — task', () => {
  it('adds a task to the queue and returns a row with correct fields', async () => {
    const task = await createTask('AddTask')
    const item = await caller.add({ kind: 'task', id: task.id })

    expect(item.id).toBeTruthy()
    expect(item.kind).toBe('task')
    expect(item.taskId).toBe(task.id)
    expect(item.goalId).toBeNull()
    expect(typeof item.position).toBe('number')
  })

  it('adds a goal to the queue and returns a row with correct fields', async () => {
    const goal = await createGoal('AddGoal')
    const item = await caller.add({ kind: 'goal', id: goal.id })

    expect(item.id).toBeTruthy()
    expect(item.kind).toBe('goal')
    expect(item.goalId).toBe(goal.id)
    expect(item.taskId).toBeNull()
  })
})

describe('upNextRouter.add — idempotency', () => {
  it('adding the same task twice returns the same row (no duplicate)', async () => {
    const task = await createTask('IdempotentTask')
    const first = await caller.add({ kind: 'task', id: task.id })
    const second = await caller.add({ kind: 'task', id: task.id })

    expect(first.id).toBe(second.id)

    // Confirm only one row in the DB.
    const rows = await prisma.upNextItem.findMany({ where: { taskId: task.id } })
    expect(rows).toHaveLength(1)
  })

  it('adding the same goal twice returns the same row', async () => {
    const goal = await createGoal('IdempotentGoal')
    const first = await caller.add({ kind: 'goal', id: goal.id })
    const second = await caller.add({ kind: 'goal', id: goal.id })

    expect(first.id).toBe(second.id)

    const rows = await prisma.upNextItem.findMany({ where: { goalId: goal.id } })
    expect(rows).toHaveLength(1)
  })
})

describe('upNextRouter.list — ordering', () => {
  it('items are returned ordered by position ascending', async () => {
    const t1 = await createTask('OrderA')
    const t2 = await createTask('OrderB')
    const t3 = await createTask('OrderC')

    // Add in order; each appends at the end.
    const a = await caller.add({ kind: 'task', id: t1.id })
    const b = await caller.add({ kind: 'task', id: t2.id })
    const c = await caller.add({ kind: 'task', id: t3.id })

    expect(a.position).toBeLessThan(b.position)
    expect(b.position).toBeLessThan(c.position)

    const list = await caller.list()
    // Our items should appear in order somewhere in the list.
    const ids = list.map((i) => i.id)
    const posA = ids.indexOf(a.id)
    const posB = ids.indexOf(b.id)
    const posC = ids.indexOf(c.id)

    expect(posA).toBeGreaterThanOrEqual(0)
    expect(posB).toBeGreaterThan(posA)
    expect(posC).toBeGreaterThan(posB)
  })
})

describe('upNextRouter.remove', () => {
  it('removes a task from the queue', async () => {
    const task = await createTask('RemoveTask')
    await caller.add({ kind: 'task', id: task.id })

    const result = await caller.remove({ kind: 'task', id: task.id })
    expect(result.success).toBe(true)

    const row = await prisma.upNextItem.findFirst({ where: { taskId: task.id } })
    expect(row).toBeNull()
  })

  it('removing a goal succeeds', async () => {
    const goal = await createGoal('RemoveGoal')
    await caller.add({ kind: 'goal', id: goal.id })

    const result = await caller.remove({ kind: 'goal', id: goal.id })
    expect(result.success).toBe(true)

    const row = await prisma.upNextItem.findFirst({ where: { goalId: goal.id } })
    expect(row).toBeNull()
  })

  it('removing something not in the queue is a no-op (returns success)', async () => {
    const task = await createTask('RemoveNotInQueue')
    // Do NOT add it first.
    const result = await caller.remove({ kind: 'task', id: task.id })
    expect(result.success).toBe(true)
  })
})

describe('upNextRouter.reorder', () => {
  it('rewrites positions correctly', async () => {
    const t1 = await createTask('ReorderA')
    const t2 = await createTask('ReorderB')
    const t3 = await createTask('ReorderC')

    const a = await caller.add({ kind: 'task', id: t1.id })
    const b = await caller.add({ kind: 'task', id: t2.id })
    const c = await caller.add({ kind: 'task', id: t3.id })

    // Reverse the order.
    await caller.reorder({ orderedIds: [c.id, b.id, a.id] })

    const updated = await prisma.upNextItem.findMany({
      where: { id: { in: [a.id, b.id, c.id] } },
      orderBy: { position: 'asc' },
    })

    // C should now be first (position 0), then B, then A.
    expect(updated[0]!.id).toBe(c.id)
    expect(updated[1]!.id).toBe(b.id)
    expect(updated[2]!.id).toBe(a.id)

    expect(updated[0]!.position).toBe(0)
    expect(updated[1]!.position).toBe(1)
    expect(updated[2]!.position).toBe(2)
  })
})

describe('upNextRouter — cascade delete', () => {
  it('deleting the linked Task removes the UpNextItem automatically', async () => {
    const task = await createTask('CascadeTask')
    const item = await caller.add({ kind: 'task', id: task.id })

    // Delete the task directly (bypasses the router to test the DB cascade).
    await prisma.task.delete({ where: { id: task.id } })

    const row = await prisma.upNextItem.findUnique({ where: { id: item.id } })
    expect(row).toBeNull()
  })
})

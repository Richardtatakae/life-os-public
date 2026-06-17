/**
 * Task router integration tests — Plan 6
 *
 * Uses a real SQLite DB (prisma/data.db). Every task created here uses the
 * prefix `__plan6_test_` so the afterAll cleanup is safe to run alongside
 * other test data.
 *
 * Atomicity note: The router uses sequential await (create → writeEvent)
 * rather than a Prisma transaction. This is intentional — SQLite is local-only,
 * single-writer, so the failure window between the two writes is negligible
 * and the simpler code is preferred. See decisions.md for details.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createCallerFactory } from '@/server/trpc'
import { taskRouter } from '@/server/routers/task'
import { prisma } from '@/server/db/client'
import { readEvents } from '@/server/db/events'

const TEST_PREFIX = '__plan6_test_'

// Build a server-side caller (no HTTP round-trip needed in tests).
// Context requires { db: prisma } because createContext() returns that shape.
const createCaller = createCallerFactory(taskRouter)
const caller = createCaller({ db: prisma })

// ── Cleanup ────────────────────────────────────────────────────────────────

afterAll(async () => {
  await prisma.task.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } })
})

// ── Helpers ────────────────────────────────────────────────────────────────

function title(suffix: string) {
  return `${TEST_PREFIX}${suffix}`
}

// ── Test cases ─────────────────────────────────────────────────────────────

describe('task.create', () => {
  it('creates a task with default status=todo', async () => {
    const task = await caller.create({ title: title('create-basic') })
    expect(task.id).toBeTruthy()
    expect(task.title).toBe(title('create-basic'))
    expect(task.status).toBe('todo')
  })

  it('creates a task with priority and energy', async () => {
    const task = await caller.create({
      title: title('create-with-meta'),
      priority: 1,
      energy: 'high',
      estimateMin: 45,
    })
    expect(task.priority).toBe(1)
    expect(task.energy).toBe('high')
    expect(task.estimateMin).toBe(45)
  })

  it('writes a create Event row', async () => {
    const task = await caller.create({ title: title('create-event') })
    const events = await readEvents({ entityType: 'task', entityId: task.id })
    const createEvent = events.find((e) => e.action === 'create')
    expect(createEvent).toBeDefined()
    expect(createEvent?.entityType).toBe('task')
    expect(createEvent?.actor).toBe('user')
  })
})

describe('task.update', () => {
  it('updates title', async () => {
    const task = await caller.create({ title: title('update-title-before') })
    const updated = await caller.update({ id: task.id, title: title('update-title-after') })
    expect(updated.title).toBe(title('update-title-after'))
  })

  it('updates energy field', async () => {
    const task = await caller.create({ title: title('update-energy') })
    const updated = await caller.update({ id: task.id, energy: 'high' })
    expect(updated.energy).toBe('high')
  })

  it('writes an update Event with diff payload', async () => {
    const task = await caller.create({ title: title('update-event'), priority: 3 })
    await caller.update({ id: task.id, priority: 1 })
    const events = await readEvents({ entityType: 'task', entityId: task.id })
    const updateEvent = events.find((e) => e.action === 'update')
    expect(updateEvent).toBeDefined()
    // payload.diff should contain priority key
    const payload = updateEvent?.payload as Record<string, unknown>
    expect(payload).toHaveProperty('diff')
  })
})

describe('task.complete', () => {
  it('sets status=done and completedAt', async () => {
    const task = await caller.create({ title: title('complete-basic') })
    const completed = await caller.complete({ id: task.id })
    expect(completed.status).toBe('done')
    expect(completed.completedAt).toBeInstanceOf(Date)
  })

  it('writes a complete Event', async () => {
    const task = await caller.create({ title: title('complete-event') })
    await caller.complete({ id: task.id })
    const events = await readEvents({ entityType: 'task', entityId: task.id })
    const completeEvent = events.find((e) => e.action === 'complete')
    expect(completeEvent).toBeDefined()
    expect(completeEvent?.actor).toBe('user')
  })
})

describe('task.defer', () => {
  it('sets status=deferred', async () => {
    const task = await caller.create({ title: title('defer-basic') })
    const deferred = await caller.defer({ id: task.id })
    expect(deferred.status).toBe('deferred')
  })

  it('writes a defer Event', async () => {
    const task = await caller.create({ title: title('defer-event') })
    await caller.defer({ id: task.id, reason: 'not urgent' })
    const events = await readEvents({ entityType: 'task', entityId: task.id })
    const deferEvent = events.find((e) => e.action === 'defer')
    expect(deferEvent).toBeDefined()
    const payload = deferEvent?.payload as Record<string, unknown>
    expect(payload?.reason).toBe('not urgent')
  })
})

describe('task.stale', () => {
  it('returns tasks older than threshold that are in non-terminal status', async () => {
    // Create task then backdate its createdAt to 10 days ago
    const task = await caller.create({ title: title('stale-10d'), status: 'todo' })
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await prisma.task.update({
      where: { id: task.id },
      data: { createdAt: tenDaysAgo },
    })

    const stale = await caller.stale({ thresholdDays: 7 })
    const found = stale.find((t) => t.id === task.id)
    expect(found).toBeDefined()
    expect(found?.status).toBe('todo')
  })

  it('does NOT return done tasks in stale list', async () => {
    const task = await caller.create({ title: title('stale-done-excluded') })
    await caller.complete({ id: task.id })
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await prisma.task.update({ where: { id: task.id }, data: { createdAt: tenDaysAgo } })

    const stale = await caller.stale({ thresholdDays: 7 })
    const found = stale.find((t) => t.id === task.id)
    expect(found).toBeUndefined()
  })

  it('does NOT return deferred tasks in stale list', async () => {
    const task = await caller.create({ title: title('stale-deferred-excluded') })
    await caller.defer({ id: task.id })
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await prisma.task.update({ where: { id: task.id }, data: { createdAt: tenDaysAgo } })

    const stale = await caller.stale({ thresholdDays: 7 })
    const found = stale.find((t) => t.id === task.id)
    expect(found).toBeUndefined()
  })

  it('returns tasks with status=blocked in stale list', async () => {
    const task = await caller.create({ title: title('stale-blocked'), status: 'blocked' })
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await prisma.task.update({ where: { id: task.id }, data: { createdAt: tenDaysAgo } })

    const stale = await caller.stale({ thresholdDays: 7 })
    const found = stale.find((t) => t.id === task.id)
    expect(found).toBeDefined()
  })
})

describe('task.byStatus', () => {
  it('returns only tasks matching requested statuses', async () => {
    const t1 = await caller.create({ title: title('bystatus-todo'), status: 'todo' })
    const t2 = await caller.create({ title: title('bystatus-blocked'), status: 'blocked' })
    const t3 = await caller.create({ title: title('bystatus-done') })
    await caller.complete({ id: t3.id })

    const results = await caller.byStatus({ statuses: ['todo', 'blocked'] })
    const ids = results.map((t) => t.id)
    expect(ids).toContain(t1.id)
    expect(ids).toContain(t2.id)
    expect(ids).not.toContain(t3.id)
  })
})

describe('Event log — every mutation writes an Event', () => {
  it('create + update + complete produce ≥3 events', async () => {
    const task = await caller.create({ title: title('event-chain-create'), priority: 1 })
    await caller.update({ id: task.id, energy: 'high' })
    await caller.complete({ id: task.id })

    const events = await readEvents({ entityType: 'task', entityId: task.id })
    const actions = events.map((e) => e.action)
    expect(actions).toContain('create')
    expect(actions).toContain('update')
    expect(actions).toContain('complete')
    expect(events.length).toBeGreaterThanOrEqual(3)
  })
})

describe('task.list', () => {
  it('returns tasks filtered by status', async () => {
    const t = await caller.create({ title: title('list-inbox'), status: 'inbox' })
    const results = await caller.list({ status: 'inbox' })
    const found = results.find((x) => x.id === t.id)
    expect(found).toBeDefined()
  })

  it('respects limit parameter', async () => {
    // Create 3 tasks
    await caller.create({ title: title('list-limit-1') })
    await caller.create({ title: title('list-limit-2') })
    await caller.create({ title: title('list-limit-3') })
    const results = await caller.list({ limit: 1 })
    expect(results.length).toBeLessThanOrEqual(1)
  })
})

describe('task state machine — permissive in v1', () => {
  it('allows any status transition (inbox → done)', async () => {
    const task = await caller.create({ title: title('state-machine-permissive'), status: 'inbox' })
    const updated = await caller.update({ id: task.id, status: 'done' })
    expect(updated.status).toBe('done')
  })
})

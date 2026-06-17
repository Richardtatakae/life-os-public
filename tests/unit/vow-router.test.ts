/**
 * Vow router integration tests
 *
 * Uses a real SQLite DB (prisma/data.db). All rows use the prefix
 * __vowtest_ so afterAll cleanup is safe. Vow rows are also cleaned up
 * so the single-active-vow invariant never leaks between test runs.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { createCallerFactory } from '@/server/trpc'
import { vowRouter } from '@/server/routers/vow'
import { ideaRouter } from '@/server/routers/idea'
import { prisma } from '@/server/db/client'
import { readEvents } from '@/server/db/events'

const TEST_PREFIX = '__vowtest_'

const createVowCaller = createCallerFactory(vowRouter)
const vowCaller = createVowCaller({ db: prisma })

const createIdeaCaller = createCallerFactory(ideaRouter)
const ideaCaller = createIdeaCaller({ db: prisma })

// ── Cleanup ────────────────────────────────────────────────────────────────

afterAll(async () => {
  // End any lingering active vows first (foreign key / single-active invariant).
  await prisma.vow.updateMany({
    where: { endedAt: null },
    data: { endedAt: new Date(), outcome: 'broken', breakReason: 'test cleanup' },
  })

  // Delete vows linked to test tasks.
  const testTasks = await prisma.task.findMany({
    where: { title: { startsWith: TEST_PREFIX } },
    select: { id: true },
  })
  const testTaskIds = testTasks.map((t) => t.id)
  if (testTaskIds.length > 0) {
    await prisma.vow.deleteMany({ where: { taskId: { in: testTaskIds } } })
  }

  // Delete test tasks and ideas.
  await prisma.task.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } })
  await prisma.idea.deleteMany({ where: { text: { startsWith: TEST_PREFIX } } })
})

// Ensure no active vow before each test so tests don't bleed.
beforeEach(async () => {
  await prisma.vow.updateMany({
    where: { endedAt: null },
    data: { endedAt: new Date(), outcome: 'broken', breakReason: 'beforeEach cleanup' },
  })
})

// ── Helpers ────────────────────────────────────────────────────────────────

async function makeTask(suffix: string, status: 'todo' | 'done' = 'todo') {
  return prisma.task.create({
    data: { title: `${TEST_PREFIX}${suffix}`, status },
  })
}

// ── Test cases ─────────────────────────────────────────────────────────────

describe('vow.activate — happy path', () => {
  it('creates a vow and returns a VowSnapshot', async () => {
    const task = await makeTask('activate-happy')
    const snap = await vowCaller.activate({ taskId: task.id, finishCriteria: 'Ship it.' })

    expect(snap.id).toBeTruthy()
    expect(snap.taskId).toBe(task.id)
    expect(snap.taskTitle).toBe(task.title)
    expect(snap.finishCriteria).toBe('Ship it.')
    expect(snap.startedAt).toBeInstanceOf(Date)
    expect(typeof snap.keptCount).toBe('number')
  })
})

describe('vow.activate — CONFLICT: active vow already exists', () => {
  it('throws CONFLICT when a vow is already active', async () => {
    const task1 = await makeTask('activate-conflict-1')
    const task2 = await makeTask('activate-conflict-2')
    await vowCaller.activate({ taskId: task1.id, finishCriteria: 'First.' })

    await expect(
      vowCaller.activate({ taskId: task2.id, finishCriteria: 'Second.' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('vow.activate — CONFLICT: task already done', () => {
  it('throws CONFLICT when the target task is already done', async () => {
    const task = await makeTask('activate-done-task', 'done')
    await expect(
      vowCaller.activate({ taskId: task.id, finishCriteria: 'Already done.' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('vow.active — returns active vow and keptCount', () => {
  it('returns { vow: null } when no vow is active', async () => {
    const result = await vowCaller.active()
    expect(result.vow).toBeNull()
    expect(typeof result.keptCount).toBe('number')
  })

  it('returns the active vow snapshot when one exists', async () => {
    const task = await makeTask('active-query')
    await vowCaller.activate({ taskId: task.id, finishCriteria: 'Done when chart is green.' })

    const result = await vowCaller.active()
    expect(result.vow).not.toBeNull()
    expect(result.vow?.taskId).toBe(task.id)
    expect(result.vow?.taskTitle).toBe(task.title)
    // keptCount is a non-negative integer
    expect(result.keptCount).toBeGreaterThanOrEqual(0)
  })
})

describe('vow.complete — marks vow kept AND task done', () => {
  it('ends the active vow with outcome=kept and sets task status=done', async () => {
    const task = await makeTask('complete-happy')
    await vowCaller.activate({ taskId: task.id, finishCriteria: 'All tests pass.' })

    const snap = await vowCaller.complete()
    expect(snap.keptCount).toBeGreaterThanOrEqual(1)

    // Verify vow row in DB.
    const vow = await prisma.vow.findUnique({ where: { id: snap.id } })
    expect(vow?.outcome).toBe('kept')
    expect(vow?.endedAt).toBeInstanceOf(Date)

    // Verify task row in DB.
    const updatedTask = await prisma.task.findUnique({ where: { id: task.id } })
    expect(updatedTask?.status).toBe('done')
    expect(updatedTask?.completedAt).toBeInstanceOf(Date)
  })
})

describe('vow.breakVow — sets outcome=broken, does not touch task', () => {
  it('ends the active vow with outcome=broken and the provided reason', async () => {
    const task = await makeTask('break-happy')
    await vowCaller.activate({ taskId: task.id, finishCriteria: 'Deployed to prod.' })

    const snap = await vowCaller.breakVow({ reason: 'Got distracted.' })

    // Verify vow row in DB.
    const vow = await prisma.vow.findUnique({ where: { id: snap.id } })
    expect(vow?.outcome).toBe('broken')
    expect(vow?.breakReason).toBe('Got distracted.')
    expect(vow?.endedAt).toBeInstanceOf(Date)

    // Task status should be unchanged (still 'todo').
    const updatedTask = await prisma.task.findUnique({ where: { id: task.id } })
    expect(updatedTask?.status).toBe('todo')
  })
})

describe('vow.logOverride — writes an Event row, no table mutation', () => {
  it('writes an override Event and returns { ok: true }', async () => {
    const task = await makeTask('override-event')
    const snap = await vowCaller.activate({ taskId: task.id, finishCriteria: 'All green.' })

    const result = await vowCaller.logOverride({ toTab: 'habits', reason: 'Quick check.' })
    expect(result.ok).toBe(true)

    // Verify Event row was written.
    const events = await readEvents({ entityType: 'vow', entityId: snap.id, action: 'override' })
    expect(events.length).toBeGreaterThanOrEqual(1)
    const payload = events[0].payload as Record<string, unknown>
    expect(payload.toTab).toBe('habits')
    expect(payload.reason).toBe('Quick check.')
  })
})

describe('idea.create — persists source=vow', () => {
  it('stores source field when source is vow', async () => {
    const idea = await ideaCaller.create({ text: `${TEST_PREFIX}idea-source-vow`, source: 'vow' })
    expect(idea.source).toBe('vow')

    // Confirm persisted in DB.
    const row = await prisma.idea.findUnique({ where: { id: idea.id } })
    expect(row?.source).toBe('vow')
  })

  it('source defaults to null when not provided', async () => {
    const idea = await ideaCaller.create({ text: `${TEST_PREFIX}idea-no-source` })
    expect(idea.source).toBeNull()
  })
})

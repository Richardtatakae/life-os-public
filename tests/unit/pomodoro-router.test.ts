/**
 * Plan 9 — Pomodoro router integration tests
 * Uses a real SQLite DB (no mocking per project conventions).
 * Cleanup: deletes any pomodoro with notes starting with '__plan9_test_'.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createCallerFactory } from '@/server/trpc'
import { pomodoroRouter } from '@/server/routers/pomodoro'
import { prisma } from '@/server/db/client'

const createCaller = createCallerFactory(pomodoroRouter)
const caller = createCaller({ db: prisma })

const TEST_NOTE_PREFIX = '__plan9_test_'

async function cleanup() {
  const toDelete = await prisma.pomodoro.findMany({
    where: { notes: { startsWith: TEST_NOTE_PREFIX } },
    select: { id: true },
  })
  const ids = toDelete.map((p) => p.id)

  await prisma.event.deleteMany({
    where: { entityType: 'pomodoro', entityId: { in: ids } },
  })
  await prisma.pomodoro.deleteMany({
    where: { id: { in: ids } },
  })
}

afterEach(async () => {
  await cleanup()
})

function testNote(label: string) {
  return `${TEST_NOTE_PREFIX}${label}_${Date.now()}`
}

// ─────────── Tests ───────────

describe('pomodoro router', () => {
  it('start without taskId returns a running pomodoro', async () => {
    const pom = await caller.start({ notes: testNote('no-task') })
    expect(pom.id).toBeTruthy()
    expect(pom.status).toBe('running')
    expect(pom.taskId).toBeNull()
    expect(pom.targetMin).toBe(25) // default
    expect(pom.pausedMs).toBe(0)
    expect(pom.endedAt).toBeNull()
  })

  it('start with explicit targetMin=15 sets correct duration', async () => {
    const pom = await caller.start({ targetMin: 15, notes: testNote('target15') })
    expect(pom.status).toBe('running')
    expect(pom.targetMin).toBe(15)
  })

  it('start with targetMin=50 sets correct duration', async () => {
    const pom = await caller.start({ targetMin: 50, notes: testNote('target50') })
    expect(pom.targetMin).toBe(50)
  })

  it('start with targetMin=90 sets correct duration', async () => {
    const pom = await caller.start({ targetMin: 90, notes: testNote('target90') })
    expect(pom.targetMin).toBe(90)
  })

  it('only-one-running guard: starting a second pomodoro auto-abandons the first', async () => {
    const first = await caller.start({ notes: testNote('guard-first') })
    expect(first.status).toBe('running')

    const second = await caller.start({ notes: testNote('guard-second') })
    expect(second.status).toBe('running')

    // The first should now be abandoned
    const refetched = await prisma.pomodoro.findUnique({ where: { id: first.id } })
    expect(refetched?.status).toBe('abandoned')
    expect(refetched?.endedAt).not.toBeNull()

    // current() should return the second one
    const current = await caller.current()
    expect(current?.id).toBe(second.id)
  })

  it('pause increments: status becomes paused and Event is written', async () => {
    const pom = await caller.start({ notes: testNote('pause-test') })

    const paused = await caller.pause({ id: pom.id })
    expect(paused.status).toBe('paused')

    // Confirm a pause event was written
    const events = await prisma.event.findMany({
      where: { entityType: 'pomodoro', entityId: pom.id, action: 'pause' },
    })
    expect(events.length).toBe(1)
    expect((events[0].payload as Record<string, unknown>).at).toBeTruthy()
  })

  it('pause then resume: pausedMs is positive after resume', async () => {
    const pom = await caller.start({ notes: testNote('resume-test') })
    await caller.pause({ id: pom.id })

    // Small wait so pausedMs is measurably > 0
    await new Promise((r) => setTimeout(r, 50))

    const resumed = await caller.resume({ id: pom.id })
    expect(resumed.status).toBe('running')
    expect(resumed.pausedMs).toBeGreaterThan(0)
  })

  it('complete: status=completed and endedAt is set', async () => {
    const pom = await caller.start({ notes: testNote('complete-test') })
    const completed = await caller.complete({ id: pom.id })
    expect(completed.status).toBe('completed')
    expect(completed.endedAt).not.toBeNull()

    // Confirm complete event
    const events = await prisma.event.findMany({
      where: { entityType: 'pomodoro', entityId: pom.id, action: 'complete' },
    })
    expect(events.length).toBe(1)
    const payload = events[0].payload as Record<string, unknown>
    expect(typeof payload.durationMs).toBe('number')
  })

  it('abandon: status=abandoned and endedAt is set', async () => {
    const pom = await caller.start({ notes: testNote('abandon-test') })
    const abandoned = await caller.abandon({ id: pom.id, reason: 'test run' })
    expect(abandoned.status).toBe('abandoned')
    expect(abandoned.endedAt).not.toBeNull()
  })

  it('current() returns the running pomodoro', async () => {
    // Ensure no leftover running pomodoro before this test
    const before = await caller.current()
    if (before) {
      await caller.abandon({ id: before.id })
    }

    const pom = await caller.start({ notes: testNote('current-test') })
    const current = await caller.current()
    expect(current).not.toBeNull()
    expect(current?.id).toBe(pom.id)
    expect(current?.status).toBe('running')
  })

  it('current() returns null after completing', async () => {
    const pom = await caller.start({ notes: testNote('current-null-test') })
    await caller.complete({ id: pom.id })
    const current = await caller.current()
    // current should be null or point to a different pomodoro (not this completed one)
    if (current) {
      expect(current.id).not.toBe(pom.id)
    } else {
      expect(current).toBeNull()
    }
  })

  it('recent() returns completed and abandoned pomodoros', async () => {
    const note1 = testNote('recent-a')
    const note2 = testNote('recent-b')
    const a = await caller.start({ notes: note1 })
    await caller.complete({ id: a.id })

    const b = await caller.start({ notes: note2 })
    await caller.abandon({ id: b.id })

    const recent = await caller.recent({ limit: 5 })
    const ids = recent.map((r) => r.id)
    expect(ids).toContain(a.id)
    expect(ids).toContain(b.id)

    // Verify statuses in results
    const aResult = recent.find((r) => r.id === a.id)
    const bResult = recent.find((r) => r.id === b.id)
    expect(aResult?.status).toBe('completed')
    expect(bResult?.status).toBe('abandoned')
  })

  it('pause on already-paused pomodoro throws', async () => {
    const pom = await caller.start({ notes: testNote('double-pause') })
    await caller.pause({ id: pom.id })
    await expect(caller.pause({ id: pom.id })).rejects.toThrow()
  })

  it('resume on running pomodoro throws', async () => {
    const pom = await caller.start({ notes: testNote('bad-resume') })
    // pom is running, not paused
    await expect(caller.resume({ id: pom.id })).rejects.toThrow()
  })
})

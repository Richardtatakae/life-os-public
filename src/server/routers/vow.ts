import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * VowSnapshot — the shape returned by activate() and active().
 *
 * startedAt is a Date object (not an ISO string). The caller (UI or test)
 * should call .toISOString() when a string is needed. This keeps the shape
 * consistent with how the rest of the routers expose timestamps (they return
 * Prisma model rows whose Date fields are Date instances).
 *
 * keptCount = lifetime count of vows with outcome 'kept'.
 */
export interface VowSnapshot {
  id: string
  taskId: string
  taskTitle: string
  finishCriteria: string
  startedAt: Date
  keptCount: number
}

/** Fetch the currently active vow (endedAt null). */
async function findActiveVow() {
  return prisma.vow.findFirst({
    where: { endedAt: null },
    include: { task: { select: { id: true, title: true, status: true } } },
  })
}

/** Count lifetime kept vows. */
async function countKept(): Promise<number> {
  return prisma.vow.count({ where: { outcome: 'kept' } })
}

/** Shape a Vow + task into a VowSnapshot. keptCount must be supplied. */
function toSnapshot(
  vow: { id: string; taskId: string; task: { title: string }; finishCriteria: string; startedAt: Date },
  keptCount: number,
): VowSnapshot {
  return {
    id: vow.id,
    taskId: vow.taskId,
    taskTitle: vow.task.title,
    finishCriteria: vow.finishCriteria,
    startedAt: vow.startedAt,
    keptCount,
  }
}

export const vowRouter = router({
  /**
   * Activate a new vow against a task.
   * Throws CONFLICT if an active vow already exists or the task is already done.
   * Throws NOT_FOUND if the task doesn't exist.
   */
  activate: publicProcedure
    .input(z.object({
      taskId: z.string(),
      finishCriteria: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      // Guard: task must exist and not be done.
      const task = await prisma.task.findUnique({ where: { id: input.taskId } })
      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found.' })
      }
      if (task.status === 'done') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Cannot vow on an already-completed task.' })
      }

      // Guard: only one active vow at a time.
      const existing = await findActiveVow()
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A vow is already active. Complete or break it first.' })
      }

      const vow = await prisma.vow.create({
        data: {
          taskId: input.taskId,
          finishCriteria: input.finishCriteria,
        },
        include: { task: { select: { id: true, title: true, status: true } } },
      })

      await writeEvent({
        actor: 'user',
        entityType: 'vow',
        entityId: vow.id,
        action: 'activate',
        payload: { taskId: vow.taskId, finishCriteria: vow.finishCriteria },
      })

      const keptCount = await countKept()
      return toSnapshot(vow, keptCount)
    }),

  /**
   * Return the currently active vow plus keptCount.
   * vow is null if no vow is active.
   */
  active: publicProcedure.query(async () => {
    const [vow, keptCount] = await Promise.all([findActiveVow(), countKept()])
    return {
      vow: vow ? toSnapshot(vow, keptCount) : null,
      keptCount,
    }
  }),

  /**
   * Complete the active vow: outcome = 'kept', task marked done.
   * Throws NOT_FOUND if no active vow exists.
   */
  complete: publicProcedure.mutation(async () => {
    const active = await findActiveVow()
    if (!active) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'No active vow to complete.' })
    }

    const now = new Date()

    // End the vow and mark the task done in parallel.
    const [vow] = await Promise.all([
      prisma.vow.update({
        where: { id: active.id },
        data: { outcome: 'kept', endedAt: now },
        include: { task: { select: { id: true, title: true, status: true } } },
      }),
      prisma.task.update({
        where: { id: active.taskId },
        data: { status: 'done', completedAt: now },
      }),
    ])

    await writeEvent({
      actor: 'user',
      entityType: 'vow',
      entityId: active.id,
      action: 'complete',
      payload: { taskId: active.taskId, outcome: 'kept' },
    })

    const keptCount = await countKept()
    return toSnapshot(vow, keptCount)
  }),

  /**
   * Break the active vow: outcome = 'broken', breakReason set.
   * Does NOT touch the task.
   * Throws NOT_FOUND if no active vow exists.
   */
  breakVow: publicProcedure
    .input(z.object({ reason: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const active = await findActiveVow()
      if (!active) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No active vow to break.' })
      }

      const vow = await prisma.vow.update({
        where: { id: active.id },
        data: { outcome: 'broken', breakReason: input.reason, endedAt: new Date() },
        include: { task: { select: { id: true, title: true, status: true } } },
      })

      await writeEvent({
        actor: 'user',
        entityType: 'vow',
        entityId: active.id,
        action: 'break',
        payload: { taskId: active.taskId, reason: input.reason },
      })

      const keptCount = await countKept()
      return toSnapshot(vow, keptCount)
    }),

  /**
   * Log a tab navigation override while a vow is active.
   * Writes an Event row only — no table mutation.
   * Throws NOT_FOUND if no active vow exists.
   */
  logOverride: publicProcedure
    .input(z.object({
      toTab: z.string(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const active = await findActiveVow()
      if (!active) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No active vow to log an override against.' })
      }

      await writeEvent({
        actor: 'user',
        entityType: 'vow',
        entityId: active.id,
        action: 'override',
        payload: { toTab: input.toTab, reason: input.reason },
      })

      return { ok: true }
    }),
})

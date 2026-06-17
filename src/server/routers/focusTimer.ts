import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * focusTimer router — the editable "upper bar" of Pomodoro timers in Focus mode.
 *
 * A FocusTimer is a user-defined work/break pair (e.g. Classic 25/5). The bar
 * lets you add (＋), edit, delete, and drag-reorder timers; the selected one
 * drives the next Focus interval. Deliberately small (name + two ints + manual
 * order). Removing one is a soft-delete (archivedAt). Mirrors the `idea` router.
 *
 * Every mutation writes an Event row (project convention — non-negotiable).
 */
export const focusTimerRouter = router({
  // All non-archived timers, left → right in manual order.
  list: publicProcedure.query(async () => {
    return prisma.focusTimer.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
  }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(40),
        workMin: z.number().int().min(1).max(180),
        breakMin: z.number().int().min(1).max(60),
      }),
    )
    .mutation(async ({ input }) => {
      // Append at the bottom (right end of the bar): position = current max + 1.
      const last = await prisma.focusTimer.findFirst({
        where: { archivedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const timer = await prisma.focusTimer.create({
        data: {
          name: input.name.trim(),
          workMin: input.workMin,
          breakMin: input.breakMin,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'focusTimer',
        entityId: timer.id,
        action: 'create',
        payload: { name: timer.name, workMin: timer.workMin, breakMin: timer.breakMin },
      })
      return timer
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(40).optional(),
        workMin: z.number().int().min(1).max(180).optional(),
        breakMin: z.number().int().min(1).max(60).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...rest } = input
      const data: { name?: string; workMin?: number; breakMin?: number } = {}
      if (rest.name !== undefined) data.name = rest.name.trim()
      if (rest.workMin !== undefined) data.workMin = rest.workMin
      if (rest.breakMin !== undefined) data.breakMin = rest.breakMin
      const timer = await prisma.focusTimer.update({ where: { id }, data })
      await writeEvent({
        actor: 'user',
        entityType: 'focusTimer',
        entityId: timer.id,
        action: 'update',
        payload: { name: timer.name, workMin: timer.workMin, breakMin: timer.breakMin },
      })
      return timer
    }),

  // Soft-delete. Guard: never remove the last remaining timer (the bar must
  // always offer at least one choice).
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const remaining = await prisma.focusTimer.count({ where: { archivedAt: null } })
      if (remaining <= 1) {
        return { ok: false as const, reason: 'last-timer' }
      }
      const timer = await prisma.focusTimer.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'focusTimer',
        entityId: timer.id,
        action: 'archive',
        payload: {},
      })
      return { ok: true as const }
    }),

  // Persist a new manual order (array of timer ids, left → right).
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.focusTimer.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'focusTimer',
        entityId: 'batch',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),
})

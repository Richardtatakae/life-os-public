import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * upNext router — the "do next" queue.
 *
 * A short ordered list of Tasks or Goals that the user has flagged as "up next".
 * Each slot references exactly one entity (either a Task or a Goal); the same
 * entity cannot appear twice (enforced by @unique on taskId / goalId).
 * Positions are 0-based integers, sorted ascending. Every mutation writes an
 * Event row (project convention — non-negotiable).
 */

const KindEnum = z.enum(['task', 'goal'])

export const upNextRouter = router({
  // All queued items in position order (ascending).
  list: publicProcedure.query(async () => {
    return prisma.upNextItem.findMany({
      orderBy: { position: 'asc' },
    })
  }),

  // Add a task or goal to the queue. Idempotent: if the entity is already
  // queued, the existing row is returned unchanged (no duplicate, no error).
  add: publicProcedure
    .input(z.object({ kind: KindEnum, id: z.string() }))
    .mutation(async ({ input }) => {
      // Check for existing row first (idempotency guard).
      const existing = await prisma.upNextItem.findFirst({
        where: input.kind === 'task' ? { taskId: input.id } : { goalId: input.id },
      })
      if (existing) return existing

      // Append at the end: position = current max + 1.
      const last = await prisma.upNextItem.findFirst({
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const item = await prisma.upNextItem.create({
        data: {
          kind: input.kind,
          taskId: input.kind === 'task' ? input.id : null,
          goalId: input.kind === 'goal' ? input.id : null,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'upNext',
        entityId: item.id,
        action: 'add',
        payload: { kind: input.kind, refId: input.id },
      })
      return item
    }),

  // Remove a task or goal from the queue by its entity reference.
  remove: publicProcedure
    .input(z.object({ kind: KindEnum, id: z.string() }))
    .mutation(async ({ input }) => {
      const where = input.kind === 'task' ? { taskId: input.id } : { goalId: input.id }
      const item = await prisma.upNextItem.findFirst({ where })
      if (!item) return { success: true }

      await prisma.upNextItem.delete({ where: { id: item.id } })
      await writeEvent({
        actor: 'user',
        entityType: 'upNext',
        entityId: item.id,
        action: 'remove',
        payload: { kind: input.kind, refId: input.id },
      })
      return { success: true }
    }),

  // Reorder the queue: supply the full ordered array of UpNextItem ids
  // (top to bottom = positions 0..n). Runs in a transaction so the queue
  // is never partially reordered.
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.upNextItem.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'upNext',
        entityId: 'batch',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),
})

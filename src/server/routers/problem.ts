import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * problem router — the Pursuits "Problems" capture box.
 *
 * A Problem is a raw, single-line jot: something you want to turn into a goal
 * or task later. Deliberately minimal (text + manual order). Removing one is a
 * soft-delete (archivedAt), mirroring areas.
 *
 * Every mutation writes an Event row (project convention — non-negotiable).
 */
export const problemRouter = router({
  // All non-archived problems, in manual order.
  list: publicProcedure.query(async () => {
    return prisma.problem.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
  }),

  create: publicProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // Append to the end: position = current max + 1.
      const last = await prisma.problem.findFirst({
        where: { archivedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const problem = await prisma.problem.create({
        data: { text: input.text.trim(), position: (last?.position ?? -1) + 1 },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'problem',
        entityId: problem.id,
        action: 'create',
        payload: { text: problem.text },
      })
      return problem
    }),

  update: publicProcedure
    .input(z.object({ id: z.string(), text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const problem = await prisma.problem.update({
        where: { id: input.id },
        data: { text: input.text.trim() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'problem',
        entityId: problem.id,
        action: 'update',
        payload: { text: problem.text },
      })
      return problem
    }),

  // Soft-delete: mark resolved/removed.
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const problem = await prisma.problem.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'problem',
        entityId: problem.id,
        action: 'archive',
        payload: {},
      })
      return problem
    }),
})

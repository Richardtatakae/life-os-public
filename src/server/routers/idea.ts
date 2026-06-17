import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * idea router — the "Ideas" tab capture list.
 *
 * An Idea is a raw jot: an optional heading (title), a body (text), and an
 * optional folder (null = "Unfiled"). Deliberately minimal — manual order,
 * soft-delete (archivedAt). Mirrors the `problem` router.
 *
 * Wave 3 additions:
 *   - heading: optional title field (text stays as the body)
 *   - folderId: optional folder grouping (null = Unfiled)
 *   - listByFolder: query ideas in a specific folder (or Unfiled)
 *   - update: extended to accept heading + folderId
 *
 * Every mutation writes an Event row (project convention — non-negotiable).
 */
export const ideaRouter = router({
  // All non-archived ideas, in manual order.
  list: publicProcedure.query(async () => {
    return prisma.idea.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
  }),

  // Ideas in a specific folder, or Unfiled (folderId: null).
  listByFolder: publicProcedure
    .input(z.object({ folderId: z.string().nullable() }))
    .query(async ({ input }) => {
      return prisma.idea.findMany({
        where: { archivedAt: null, folderId: input.folderId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      })
    }),

  create: publicProcedure
    .input(z.object({
      text: z.string().min(1),
      heading: z.string().optional(),
      folderId: z.string().nullable().optional(),
      // Optional origin tag — 'vow' marks ideas parked while the user was under
      // a Vow, so they can be reviewed after completion.
      source: z.enum(['vow']).optional(),
    }))
    .mutation(async ({ input }) => {
      // Prepend to the top: position = current min - 1. New ideas appear right
      // under the input box (where the eye already is) instead of being appended
      // below the fold of a height-constrained, scrollbar-hidden box — which read
      // as "nothing happened". Manual drag-reorder still works (it rewrites all
      // positions 0..n top-to-bottom on reorder).
      const first = await prisma.idea.findFirst({
        where: { archivedAt: null, folderId: input.folderId ?? null },
        orderBy: { position: 'asc' },
        select: { position: true },
      })
      const idea = await prisma.idea.create({
        data: {
          text: input.text.trim(),
          heading: input.heading?.trim() || null,
          folderId: input.folderId ?? null,
          position: (first?.position ?? 0) - 1,
          source: input.source ?? null,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'idea',
        entityId: idea.id,
        action: 'create',
        payload: {
          text: idea.text,
          heading: idea.heading ?? null,
          folderId: idea.folderId ?? null,
          source: input.source ?? null,
        },
      })
      return idea
    }),

  // Extended update: accepts heading, text, and folderId.
  update: publicProcedure
    .input(z.object({
      id: z.string(),
      text: z.string().min(1).optional(),
      heading: z.string().nullable().optional(),
      folderId: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const data: {
        text?: string
        heading?: string | null
        folderId?: string | null
      } = {}
      if (input.text !== undefined) data.text = input.text.trim()
      if (input.heading !== undefined) data.heading = input.heading?.trim() || null
      if (input.folderId !== undefined) data.folderId = input.folderId

      const idea = await prisma.idea.update({
        where: { id: input.id },
        data,
      })
      await writeEvent({
        actor: 'user',
        entityType: 'idea',
        entityId: idea.id,
        action: 'update',
        payload: {
          text: input.text ?? null,
          heading: input.heading ?? null,
          folderId: input.folderId ?? null,
        },
      })
      return idea
    }),

  // Soft-delete: mark removed.
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const idea = await prisma.idea.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'idea',
        entityId: idea.id,
        action: 'archive',
        payload: {},
      })
      return idea
    }),

  // Persist a new manual order (array of idea ids, top → bottom).
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.idea.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'idea',
        entityId: 'batch',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),
})

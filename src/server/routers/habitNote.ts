import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * habitNote router — the temporary "Habits" tab jot list.
 *
 * A HabitNote is a raw, single-line jot: a placeholder scratchpad until the
 * real habit-tracking tool is built. Deliberately minimal (text + manual
 * order). Removing one is a soft-delete (archivedAt). Mirrors the `idea` router.
 *
 * Every mutation writes an Event row (project convention — non-negotiable).
 */
export const habitNoteRouter = router({
  // All non-archived notes, in manual order.
  list: publicProcedure.query(async () => {
    return prisma.habitNote.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
  }),

  create: publicProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // Append to the end: position = current max + 1.
      const last = await prisma.habitNote.findFirst({
        where: { archivedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const note = await prisma.habitNote.create({
        data: { text: input.text.trim(), position: (last?.position ?? -1) + 1 },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'habitNote',
        entityId: note.id,
        action: 'create',
        payload: { text: note.text },
      })
      return note
    }),

  update: publicProcedure
    .input(z.object({ id: z.string(), text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const note = await prisma.habitNote.update({
        where: { id: input.id },
        data: { text: input.text.trim() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'habitNote',
        entityId: note.id,
        action: 'update',
        payload: { text: note.text },
      })
      return note
    }),

  // Soft-delete: mark removed.
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const note = await prisma.habitNote.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'habitNote',
        entityId: note.id,
        action: 'archive',
        payload: {},
      })
      return note
    }),

  // Persist a new manual order (array of note ids, top → bottom).
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.habitNote.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'habitNote',
        entityId: 'batch',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),
})

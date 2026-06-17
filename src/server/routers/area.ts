import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * area router — the top level of the Pursuits module.
 *
 * An Area is a user-created, freely-named life domain (e.g. "Career",
 * "Health"). Goals live inside an Area. Areas supersede the old free-text
 * `lifeArea` string on Goal.
 *
 * Every mutation writes an Event row (project convention — non-negotiable).
 */
export const areaRouter = router({
  // All non-archived areas, in manual order.
  list: publicProcedure.query(async () => {
    return prisma.area.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
  }),

  // Single area by id — used by Focus mode when focusing an area directly.
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return prisma.area.findUniqueOrThrow({ where: { id: input.id } })
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      color: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      // Append to the end: position = current max + 1.
      const last = await prisma.area.findFirst({
        where: { archivedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const area = await prisma.area.create({
        data: {
          name: input.name.trim(),
          color: input.color ?? null,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'area',
        entityId: area.id,
        action: 'create',
        payload: { name: area.name },
      })
      return area
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      color: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input
      const area = await prisma.area.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.color !== undefined && { color: data.color }),
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'area',
        entityId: area.id,
        action: 'update',
        payload: { fields: Object.keys(data) },
      })
      return area
    }),

  // Soft-delete: archive the area. Its goals' areaId is set to null by the DB
  // (onDelete: SetNull only fires on a hard delete), so we detach them here.
  archive: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.goal.updateMany({
        where: { areaId: input.id },
        data: { areaId: null },
      })
      // Detach loose tasks too — they become orphan ("No goal") tasks.
      await prisma.task.updateMany({
        where: { areaId: input.id },
        data: { areaId: null },
      })
      const area = await prisma.area.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'area',
        entityId: area.id,
        action: 'archive',
        payload: {},
      })
      return area
    }),

  // Persist a new manual order (array of area ids, top → bottom).
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.area.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'area',
        entityId: 'batch',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),
})

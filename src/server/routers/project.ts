import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * project router — the layer between Area and Goal in the Pursuits module.
 *
 * A Project groups goals inside an Area (e.g. several initiatives within a
 * "Finance" area). Hierarchy: Area → Project → Goal → Task. A goal may also
 * live directly under an area (no project). Archiving a project is a
 * soft-delete: its goals' projectId is set to null so they fall back to being
 * area-level goals.
 *
 * Every mutation writes an Event row (project convention — non-negotiable).
 */
export const projectRouter = router({
  // All non-archived projects (optionally just one area's), in manual order.
  list: publicProcedure
    .input(z.object({ areaId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return prisma.project.findMany({
        where: { archivedAt: null, ...(input?.areaId ? { areaId: input.areaId } : {}) },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      })
    }),

  // Single project by id — used by Focus mode when focusing a project directly.
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return prisma.project.findUniqueOrThrow({ where: { id: input.id } })
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      areaId: z.string(),
      color: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      // Append to the end of this area's projects: position = current max + 1.
      const last = await prisma.project.findFirst({
        where: { archivedAt: null, areaId: input.areaId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const project = await prisma.project.create({
        data: {
          name: input.name.trim(),
          areaId: input.areaId,
          color: input.color ?? null,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'project',
        entityId: project.id,
        action: 'create',
        payload: { name: project.name, areaId: project.areaId },
      })
      return project
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      color: z.string().optional().nullable(),
      areaId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input
      const project = await prisma.project.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.color !== undefined && { color: data.color }),
          ...(data.areaId !== undefined && { areaId: data.areaId }),
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'project',
        entityId: project.id,
        action: 'update',
        payload: { fields: Object.keys(data) },
      })
      return project
    }),

  // Soft-delete the project. Detach its goals (projectId → null) so they fall
  // back to being area-level goals rather than vanishing.
  archive: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.goal.updateMany({
        where: { projectId: input.id },
        data: { projectId: null },
      })
      const project = await prisma.project.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'project',
        entityId: project.id,
        action: 'archive',
        payload: {},
      })
      return project
    }),

  // Persist a new manual order within an area (array of project ids).
  reorder: publicProcedure
    .input(z.object({ areaId: z.string(), orderedIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.project.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'project',
        entityId: input.areaId,
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),
})

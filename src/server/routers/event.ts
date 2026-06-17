import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { writeEvent, readEvents } from '../db/events'
import type { Prisma } from '@prisma/client'

export const eventRouter = router({
  log: publicProcedure
    .input(z.object({
      actor: z.enum(['user', 'system', 'scheduler', 'coach']),
      entityType: z.string().min(1),
      entityId: z.string().min(1),
      action: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) =>
      writeEvent({
        ...input,
        payload: input.payload as Prisma.InputJsonValue | undefined,
      })
    ),

  recent: publicProcedure
    .input(z.object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => readEvents(input ?? {})),
})

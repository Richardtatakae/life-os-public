import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * meditation router — logged meditation sittings for a duration-tracked habit
 * (the "Meditation" row in the life-habits tracker). Each session is a
 * {date, startTime, durationMin} record tied to its LifeHabit; the detail popup
 * lists them and charts total minutes per day/week/month.
 *
 * Logging a session is independent of the day-7 tick grid — it never auto-ticks
 * the calendar cell. Every mutation writes an Event row (project convention).
 */

const TIME_RE = /^\d{2}:\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const meditationRouter = router({
  // Every session for one habit, newest first.
  list: publicProcedure
    .input(z.object({ habitId: z.string() }))
    .query(async ({ input }) => {
      return prisma.meditationSession.findMany({
        where: { habitId: input.habitId },
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
      })
    }),

  add: publicProcedure
    .input(
      z.object({
        habitId: z.string(),
        date: z.string().regex(DATE_RE),
        startTime: z.string().regex(TIME_RE),
        durationMin: z.number().int().min(1).max(1440),
      }),
    )
    .mutation(async ({ input }) => {
      const session = await prisma.meditationSession.create({
        data: {
          habitId: input.habitId,
          date: input.date,
          startTime: input.startTime,
          durationMin: input.durationMin,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'meditationSession',
        entityId: session.id,
        action: 'add',
        payload: {
          habitId: input.habitId,
          date: input.date,
          startTime: input.startTime,
          durationMin: input.durationMin,
        },
      })
      return session
    }),

  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const session = await prisma.meditationSession.delete({ where: { id: input.id } })
      await writeEvent({
        actor: 'user',
        entityType: 'meditationSession',
        entityId: session.id,
        action: 'remove',
        payload: { habitId: session.habitId, date: session.date },
      })
      return { success: true }
    }),
})

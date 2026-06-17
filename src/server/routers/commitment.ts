import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * commitment — recurring obligations that auto-schedule onto the day planner.
 *
 * A RecurringCommitment is a TEMPLATE (gym Mon/Wed/Fri at 07:00, etc.). It never
 * shows up on the axis itself; instead `materialize({date})` spawns one placed
 * PlannerBlock (kind 'commitment') per matching day. A CommitmentInstance row is
 * written at the same time so the day is marked "handled" — that's what makes a
 * per-day edit or delete stick: re-opening the day won't recreate the block, and
 * later changing the template's settings won't disturb days already laid out.
 *
 * Materialisation only runs for today and future days (we never back-fill the
 * past). Every mutation writes an Event row.
 */

const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/** Local calendar date as "YYYY-MM-DD". */
function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** JS weekday (0=Sun..6=Sat) for a "YYYY-MM-DD" key, in local time. */
function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** The Monday (00:00 local) of the week containing `iso`, as a Date. */
function mondayOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const day = dt.getDay() // 0=Sun
  const offset = day === 0 ? -6 : 1 - day
  dt.setDate(dt.getDate() + offset)
  dt.setHours(0, 0, 0, 0)
  return dt
}

/** Whole weeks between the Mondays of two day-keys (can be negative). */
function weeksBetween(anchor: string, target: string): number {
  const ms = mondayOf(target).getTime() - mondayOf(anchor).getTime()
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000))
}

/** Parse a "1,3,5" weekday CSV into a Set of numbers (ignores junk/empties). */
function parseWeekdays(csv: string): Set<number> {
  return new Set(
    csv
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  )
}

const Weekdays = z.array(z.number().int().min(0).max(6)).max(7)

export const commitmentRouter = router({
  // All commitment templates, newest control over order via position.
  list: publicProcedure.query(async () => {
    return prisma.recurringCommitment.findMany({ orderBy: { position: 'asc' } })
  }),

  // Create a recurring commitment. anchorWeek is set to this week so biweekly
  // parity has a reference point ("this week is week 0").
  create: publicProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        startMin: z.number().int().min(0).max(1440),
        durationMin: z.number().int().min(5).max(600),
        frequency: z.enum(['weekly', 'biweekly']),
        weekdays: Weekdays.min(1),
        startDate: DateKey.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const last = await prisma.recurringCommitment.findFirst({
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      // Biweekly parity is measured from anchorWeek. If a start date is given,
      // anchor to it so "week 0" is the first scheduled week; otherwise this week.
      const startDate = input.startDate ?? ''
      const c = await prisma.recurringCommitment.create({
        data: {
          title: input.title.trim(),
          startMin: input.startMin,
          durationMin: input.durationMin,
          frequency: input.frequency,
          weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b).join(','),
          anchorWeek: startDate || todayISO(),
          startDate,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'recurringCommitment',
        entityId: c.id,
        action: 'create',
        payload: { title: c.title, frequency: c.frequency, weekdays: c.weekdays, startMin: c.startMin },
      })
      return c
    }),

  // Edit a commitment's settings. Only affects days not yet materialised — days
  // already laid out keep their independent blocks (per-day edits stick).
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        startMin: z.number().int().min(0).max(1440).optional(),
        durationMin: z.number().int().min(5).max(600).optional(),
        frequency: z.enum(['weekly', 'biweekly']).optional(),
        weekdays: Weekdays.min(1).optional(),
        active: z.boolean().optional(),
        startDate: DateKey.or(z.literal('')).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...rest } = input
      const data: {
        title?: string
        startMin?: number
        durationMin?: number
        frequency?: string
        weekdays?: string
        active?: boolean
        startDate?: string
        anchorWeek?: string
      } = {}
      if (rest.title !== undefined) data.title = rest.title.trim()
      if (rest.startMin !== undefined) data.startMin = rest.startMin
      if (rest.durationMin !== undefined) data.durationMin = rest.durationMin
      if (rest.frequency !== undefined) data.frequency = rest.frequency
      if (rest.weekdays !== undefined)
        data.weekdays = [...new Set(rest.weekdays)].sort((a, b) => a - b).join(',')
      if (rest.active !== undefined) data.active = rest.active
      // Changing the start date re-anchors biweekly parity to that week (or to
      // this week when cleared) so the rhythm starts from the new first day.
      if (rest.startDate !== undefined) {
        data.startDate = rest.startDate
        data.anchorWeek = rest.startDate || todayISO()
      }
      const c = await prisma.recurringCommitment.update({ where: { id }, data })
      await writeEvent({
        actor: 'user',
        entityType: 'recurringCommitment',
        entityId: c.id,
        action: 'update',
        payload: data,
      })
      return c
    }),

  // Delete a commitment template. Cascade drops its instance records, so it
  // stops spawning new blocks. Blocks already placed on past/current days stay
  // (they're independent once materialised).
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const c = await prisma.recurringCommitment.delete({ where: { id: input.id } })
      await writeEvent({
        actor: 'user',
        entityType: 'recurringCommitment',
        entityId: input.id,
        action: 'remove',
        payload: { title: c.title },
      })
      return { success: true }
    }),

  // Lay out every active commitment that falls on `date` as a placed block —
  // exactly once per day. Idempotent: a day already handled (has an instance
  // row) is skipped, so deleted/edited copies are never resurrected. Never
  // back-fills the past. Called by the planner whenever a day is opened.
  materialize: publicProcedure
    .input(z.object({ date: DateKey }))
    .mutation(async ({ input }) => {
      const today = todayISO()
      if (input.date < today) return { created: 0 } // never back-fill the past

      const dow = weekdayOf(input.date)
      const commitments = await prisma.recurringCommitment.findMany({ where: { active: true } })

      let created = 0
      for (const c of commitments) {
        // Respect a start date: never schedule before the first allowed day.
        if (c.startDate && input.date < c.startDate) continue
        if (!parseWeekdays(c.weekdays).has(dow)) continue
        if (c.frequency === 'biweekly' && Math.abs(weeksBetween(c.anchorWeek || today, input.date)) % 2 !== 0)
          continue

        // Already handled this day? (block kept, deleted, or edited — all stick.)
        const already = await prisma.commitmentInstance.findUnique({
          where: { commitmentId_date: { commitmentId: c.id, date: input.date } },
        })
        if (already) continue

        const last = await prisma.plannerBlock.findFirst({
          where: { date: input.date },
          orderBy: { position: 'desc' },
          select: { position: true },
        })
        const block = await prisma.plannerBlock.create({
          data: {
            date: input.date,
            title: c.title,
            kind: 'commitment',
            energy: 'med',
            durationMin: c.durationMin,
            placed: true,
            startMin: c.startMin,
            position: (last?.position ?? -1) + 1,
            commitmentId: c.id,
          },
        })
        await prisma.commitmentInstance.create({
          data: { commitmentId: c.id, date: input.date },
        })
        await writeEvent({
          actor: 'system',
          entityType: 'plannerBlock',
          entityId: block.id,
          action: 'materializeCommitment',
          payload: { commitmentId: c.id, date: input.date, startMin: c.startMin },
        })
        created++
      }
      return { created }
    }),
})

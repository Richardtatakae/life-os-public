import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'
import type { Prisma } from '@prisma/client'

/**
 * dailyPlan — the "push to today" list shown in the Schedule tab.
 *
 * A DailyPlanItem references a Pursuits entity (task / goal / project / area)
 * for one calendar day. It is NOT a copy: the Schedule tab re-renders the real
 * entity, so checking a task off there updates the same task everywhere.
 *
 * The list is per-day (scoped to the local date), so each new day starts empty.
 * The same entity can't be pushed twice on one day (DB unique + a guard here).
 */

const KindEnum = z.enum(['task', 'goal', 'project', 'area'])
type Kind = z.infer<typeof KindEnum>

/** Local calendar date as "YYYY-MM-DD" (matches the ScheduleBoard convention). */
function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The single *Id column that holds the reference for a given kind. */
function fieldFor(kind: Kind): 'taskId' | 'goalId' | 'projectId' | 'areaId' {
  return `${kind}Id` as 'taskId' | 'goalId' | 'projectId' | 'areaId'
}

/** Build the four-column reference object (three nulls + the one that is set). */
function refFor(kind: Kind, id: string) {
  return {
    taskId: kind === 'task' ? id : null,
    goalId: kind === 'goal' ? id : null,
    projectId: kind === 'project' ? id : null,
    areaId: kind === 'area' ? id : null,
  }
}

export const dailyPlanRouter = router({
  // Today's list, in manual order. Raw refs — the client resolves them against
  // the task/goal/project/area trees it already has loaded.
  today: publicProcedure.query(async () => {
    return prisma.dailyPlanItem.findMany({
      where: { date: todayISO() },
      orderBy: { position: 'asc' },
    })
  }),

  // Pin an entity to today's plan. Idempotent: if it's already there, returns
  // the existing row instead of erroring on the unique constraint.
  push: publicProcedure
    .input(z.object({ kind: KindEnum, id: z.string() }))
    .mutation(async ({ input }) => {
      const date = todayISO()
      const where = { date, [fieldFor(input.kind)]: input.id } as Prisma.DailyPlanItemWhereInput
      const existing = await prisma.dailyPlanItem.findFirst({ where })
      if (existing) return existing

      const last = await prisma.dailyPlanItem.findFirst({
        where: { date },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const position = last ? last.position + 1 : 0

      const item = await prisma.dailyPlanItem.create({
        data: { date, kind: input.kind, position, ...refFor(input.kind, input.id) },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'dailyPlan',
        entityId: item.id,
        action: 'push',
        payload: { kind: input.kind, refId: input.id, date },
      })
      return item
    }),

  // Remove an entity from today's plan (no-op if it isn't on the list).
  remove: publicProcedure
    .input(z.object({ kind: KindEnum, id: z.string() }))
    .mutation(async ({ input }) => {
      const date = todayISO()
      const where = { date, [fieldFor(input.kind)]: input.id } as Prisma.DailyPlanItemWhereInput
      const rows = await prisma.dailyPlanItem.findMany({ where })
      await prisma.dailyPlanItem.deleteMany({ where })
      for (const row of rows) {
        await writeEvent({
          actor: 'user',
          entityType: 'dailyPlan',
          entityId: row.id,
          action: 'remove',
          payload: { kind: input.kind, refId: input.id, date },
        })
      }
      return { success: true, removed: rows.length }
    }),

  // Rewrite today's order to the given list of DailyPlanItem ids (0,1,2,…).
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, i) =>
          prisma.dailyPlanItem.update({ where: { id }, data: { position: i } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'dailyPlan',
        entityId: 'today',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),
})

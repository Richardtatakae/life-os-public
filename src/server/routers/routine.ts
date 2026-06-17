import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * routine router — the "Routines" tab.
 *
 * A Routine is a named, ordered checklist of steps (e.g. "Morning routine").
 * Each RoutineItem has a duration (minutes) and may have an optional fixed
 * clock time (HH:MM). The UI computes a timeline from these. Removing a routine
 * is a soft-delete (archivedAt); items are hard-deleted (and re-created freely).
 *
 * Every mutation writes an Event row (project convention — non-negotiable).
 */

// HH:MM 24-hour clock string (e.g. "06:30", "23:05").
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour)')

// HH:MM ↔ minutes-since-midnight helpers (wraps around 24h to stay valid).
function toMin(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function fmtClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const routineRouter = router({
  // All non-archived routines with their items, both in manual order.
  list: publicProcedure.query(async () => {
    return prisma.routine.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: {
            subItems: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
          },
        },
        conditions: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      },
    })
  }),

  // ── Routine-level ──────────────────────────────────────────────────────

  create: publicProcedure
    .input(z.object({ name: z.string().min(1), startTime: hhmm.optional() }))
    .mutation(async ({ input }) => {
      const last = await prisma.routine.findFirst({
        where: { archivedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const routine = await prisma.routine.create({
        data: {
          name: input.name.trim(),
          // No start time given → an unscheduled "do whenever" routine (null).
          startTime: input.startTime ?? null,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routine',
        entityId: routine.id,
        action: 'create',
        payload: { name: routine.name },
      })
      return routine
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        startTime: hhmm.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const routine = await prisma.routine.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routine',
        entityId: routine.id,
        action: 'update',
        payload: { name: routine.name, startTime: routine.startTime },
      })
      return routine
    }),

  // Change the routine's start time AND shift the whole routine with it: every
  // time-pinned item moves by the same delta, so the routine keeps its shape
  // but slides earlier/later. (Un-pinned items already flow from the start.)
  setStartTime: publicProcedure
    .input(z.object({ id: z.string(), startTime: hhmm }))
    .mutation(async ({ input }) => {
      const routine = await prisma.routine.findUniqueOrThrow({
        where: { id: input.id },
        include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
      })
      // Reference = the routine's TRUE current start = the first step's start
      // (its pinned time if it has one, else the stored routine start). Using
      // routine.startTime alone drifts out of sync when the first step is
      // time-pinned, so we always re-anchor to the first step here. The whole
      // routine then slides so it begins exactly at the requested time.
      const first = routine.items[0]
      // If the routine had no start time (a "whenever" routine being given one),
      // anchor to the requested time so nothing shifts (delta 0).
      const currentStart = first?.fixedTime
        ? toMin(first.fixedTime)
        : toMin(routine.startTime ?? input.startTime)
      const delta = toMin(input.startTime) - currentStart
      const pinned = routine.items.filter((i) => i.fixedTime)
      await prisma.$transaction([
        prisma.routine.update({ where: { id: input.id }, data: { startTime: input.startTime } }),
        ...pinned.map((i) =>
          prisma.routineItem.update({
            where: { id: i.id },
            data: { fixedTime: fmtClock(toMin(i.fixedTime as string) + delta) },
          }),
        ),
      ])
      await writeEvent({
        actor: 'user',
        entityType: 'routine',
        entityId: input.id,
        action: 'set-start-time',
        payload: { startTime: input.startTime, delta },
      })
      return { ok: true }
    }),

  // Switch a routine to "do whenever" mode: drop its start time (null). The
  // timeline then runs in elapsed minutes from 0. Item fixed times are kept in
  // the DB (ignored while unscheduled, restored if a start time is set again).
  setUnscheduled: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const routine = await prisma.routine.update({
        where: { id: input.id },
        data: { startTime: null },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routine',
        entityId: input.id,
        action: 'set-unscheduled',
        payload: {},
      })
      return routine
    }),

  // Reorder the whole routines: pass the full ordered list of routine ids.
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, index) =>
          prisma.routine.update({ where: { id }, data: { position: index } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'routine',
        entityId: 'routines',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { ok: true }
    }),

  // Soft-delete the routine (items cascade with it visually since we filter).
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const routine = await prisma.routine.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routine',
        entityId: routine.id,
        action: 'archive',
        payload: {},
      })
      return routine
    }),

  // ── Item-level ─────────────────────────────────────────────────────────

  addItem: publicProcedure
    .input(
      z.object({
        routineId: z.string(),
        text: z.string().min(1),
        durationMin: z.number().int().min(0).default(0),
        fixedTime: hhmm.nullish(),
      }),
    )
    .mutation(async ({ input }) => {
      const last = await prisma.routineItem.findFirst({
        where: { routineId: input.routineId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const item = await prisma.routineItem.create({
        data: {
          routineId: input.routineId,
          text: input.text.trim(),
          durationMin: input.durationMin,
          fixedTime: input.fixedTime ?? null,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routineItem',
        entityId: item.id,
        action: 'create',
        payload: { routineId: item.routineId, text: item.text },
      })
      return item
    }),

  updateItem: publicProcedure
    .input(
      z.object({
        id: z.string(),
        text: z.string().min(1).optional(),
        durationMin: z.number().int().min(0).optional(),
        // null clears the fixed time; undefined leaves it unchanged.
        fixedTime: hhmm.nullish(),
      }),
    )
    .mutation(async ({ input }) => {
      const item = await prisma.routineItem.update({
        where: { id: input.id },
        data: {
          ...(input.text !== undefined ? { text: input.text.trim() } : {}),
          ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
          ...(input.fixedTime !== undefined ? { fixedTime: input.fixedTime } : {}),
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routineItem',
        entityId: item.id,
        action: 'update',
        payload: { text: item.text, durationMin: item.durationMin, fixedTime: item.fixedTime },
      })
      return item
    }),

  // Hard-delete an item (and write an event).
  removeItem: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const item = await prisma.routineItem.delete({ where: { id: input.id } })
      await writeEvent({
        actor: 'user',
        entityType: 'routineItem',
        entityId: item.id,
        action: 'delete',
        payload: { routineId: item.routineId },
      })
      return item
    }),

  // ── Sub-item-level (nested detail lines, e.g. ingredients) ──────────────

  addSubItem: publicProcedure
    .input(z.object({ itemId: z.string(), text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const last = await prisma.routineSubItem.findFirst({
        where: { itemId: input.itemId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const sub = await prisma.routineSubItem.create({
        data: {
          itemId: input.itemId,
          text: input.text.trim(),
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routineSubItem',
        entityId: sub.id,
        action: 'create',
        payload: { itemId: sub.itemId, text: sub.text },
      })
      return sub
    }),

  updateSubItem: publicProcedure
    .input(z.object({ id: z.string(), text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const sub = await prisma.routineSubItem.update({
        where: { id: input.id },
        data: { text: input.text.trim() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routineSubItem',
        entityId: sub.id,
        action: 'update',
        payload: { text: sub.text },
      })
      return sub
    }),

  removeSubItem: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const sub = await prisma.routineSubItem.delete({ where: { id: input.id } })
      await writeEvent({
        actor: 'user',
        entityType: 'routineSubItem',
        entityId: sub.id,
        action: 'delete',
        payload: { itemId: sub.itemId },
      })
      return sub
    }),

  // Reorder items within a routine: pass the full ordered list of item ids.
  reorderItems: publicProcedure
    .input(z.object({ routineId: z.string(), orderedIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, index) =>
          prisma.routineItem.update({ where: { id }, data: { position: index } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'routine',
        entityId: input.routineId,
        action: 'reorder-items',
        payload: { orderedIds: input.orderedIds },
      })
      return { ok: true }
    }),

  // ── Condition-level (non-timeline criteria, e.g. "no phone during") ─────
  //
  // Conditions have no duration or clock time, so they never appear on the
  // timeline. When the routine is attached to a habit they show as extra
  // checkboxes in the habit's daily checklist (see lifeHabit router).

  addCondition: publicProcedure
    .input(z.object({ routineId: z.string(), text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const last = await prisma.routineCondition.findFirst({
        where: { routineId: input.routineId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const cond = await prisma.routineCondition.create({
        data: {
          routineId: input.routineId,
          text: input.text.trim(),
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routineCondition',
        entityId: cond.id,
        action: 'create',
        payload: { routineId: cond.routineId, text: cond.text },
      })
      return cond
    }),

  updateCondition: publicProcedure
    .input(z.object({ id: z.string(), text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const cond = await prisma.routineCondition.update({
        where: { id: input.id },
        data: { text: input.text.trim() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'routineCondition',
        entityId: cond.id,
        action: 'update',
        payload: { text: cond.text },
      })
      return cond
    }),

  removeCondition: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const cond = await prisma.routineCondition.delete({ where: { id: input.id } })
      await writeEvent({
        actor: 'user',
        entityType: 'routineCondition',
        entityId: cond.id,
        action: 'delete',
        payload: { routineId: cond.routineId },
      })
      return cond
    }),

  // Reorder conditions within a routine: pass the full ordered list of ids.
  reorderConditions: publicProcedure
    .input(z.object({ routineId: z.string(), orderedIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, index) =>
          prisma.routineCondition.update({ where: { id }, data: { position: index } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'routine',
        entityId: input.routineId,
        action: 'reorder-conditions',
        payload: { orderedIds: input.orderedIds },
      })
      return { ok: true }
    }),
})

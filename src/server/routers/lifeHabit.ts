import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'
import { consistencyScore, todayISO } from '@/lib/lifeHabits'
import { levelFor } from '@/lib/habitLevels'
import { anyRoutineComplete } from '@/lib/routineChecklist'

/**
 * lifeHabit router — the "Habits that definitely improve my life" tracker.
 *
 * A LifeHabit is one row in the grid; its LifeHabitDay rows are the explicit
 * ticks/un-ticks the user has made. Days the user never touched are NOT stored:
 * the client derives their state from the day-7 default (src/lib/lifeHabits.ts).
 * `setDay` therefore upserts only when the user actively clicks a cell.
 *
 * The eight starter habits are seeded once via `seedStarter`, guarded by an
 * AppSetting flag so they never reappear after you delete them.
 *
 * Every mutation writes an Event row (project convention — non-negotiable).
 */

const SEED_FLAG = 'lifeHabitsSeeded'

// ── Routine timeline helpers (mirror RoutinesView) ───────────────────────────
// Used by the `checklist` query to label each step with its start time, the same
// way the Routines tab does: a wall-clock time for a scheduled routine, or
// elapsed time ("0:15") for an unscheduled "do whenever" one.
function toMin(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function fmtClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function fmtElapsed(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

// Shared: write an explicit day tick/un-tick for one (habit, date) cell and
// recompute the peak score, firing a `levelUp` event if the peak crossed into a
// new rung. Used by `setDay` (user clicks a grid cell) and `setChecklistItem`
// (the auto-tick when every attached-routine box is ticked). Upserts, so a day
// can be toggled freely; the value is the user's intent regardless of the day-7
// default (the client computes the displayed state). The current level is NOT
// stored (it's derived live in the client and may drop) — only the peak persists.
async function applyDayDone(habitId: string, date: string, done: boolean) {
  const day = await prisma.lifeHabitDay.upsert({
    where: { habitId_date: { habitId, date } },
    create: { habitId, date, done },
    update: { done },
  })
  await writeEvent({
    actor: 'user',
    entityType: 'lifeHabitDay',
    entityId: day.id,
    action: 'setDay',
    payload: { habitId, date, done },
  })

  const habit = await prisma.lifeHabit.findUnique({
    where: { id: habitId },
    include: { days: { select: { date: true, done: true } } },
  })
  if (habit) {
    const explicit = new Map(habit.days.map((d) => [d.date, d.done]))
    const score = consistencyScore(habit.startDate, explicit, todayISO(), habit.autoSince, habit.cadenceDays)
    if (score > habit.peakScore) {
      const oldLevel = levelFor(habit.peakScore).level
      const newLevel = levelFor(score).level
      await prisma.lifeHabit.update({
        where: { id: habit.id },
        data: { peakScore: score },
      })
      // A level-up is the "badge earned" moment: the peak crossing into a new
      // rung. The Event log IS the unlock history — it drives the celebration
      // toast. (A simple new peak within the same level isn't logged.)
      if (newLevel > oldLevel) {
        await writeEvent({
          actor: 'user',
          entityType: 'lifeHabit',
          entityId: habit.id,
          action: 'levelUp',
          payload: { habitId: habit.id, level: newLevel, score },
        })
      }
    }
  }
  return day
}

// Load a habit's attached, non-archived routines, each reduced to the flat set
// of source ids (every step + condition) that must be ticked for that one
// routine to count as complete. Shared by `checklist`, `setChecklistItem`, and
// `removeRoutine`.
async function attachedRoutineSourceIds(
  habitId: string,
): Promise<{ routineId: string; sourceIds: string[] }[]> {
  const links = await prisma.habitRoutine.findMany({
    where: { habitId, routine: { archivedAt: null } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      routineId: true,
      routine: {
        select: {
          items: { select: { id: true } },
          conditions: { select: { id: true } },
        },
      },
    },
  })
  return links.map((l) => ({
    routineId: l.routineId,
    sourceIds: [
      ...l.routine.items.map((i) => i.id),
      ...l.routine.conditions.map((c) => c.id),
    ],
  }))
}

// Recompute whether a (habit, date) should be ticked from its attached routines
// (OR logic: any one routine fully checked → day done) and sync the day — but
// only write when the done-state actually flips, so toggling boxes mid-checklist
// doesn't spam setDay events. No-op when the habit has no live routine attached,
// so manual ticks are never clobbered.
async function recomputeHabitDay(habitId: string, date: string) {
  const routines = await attachedRoutineSourceIds(habitId)
  if (routines.length === 0) return
  const checks = await prisma.habitRoutineCheck.findMany({
    where: { habitId, date },
    select: { sourceId: true, done: true },
  })
  const checkMap = new Map(checks.map((c) => [c.sourceId, c.done]))
  const complete = anyRoutineComplete(routines, checkMap)
  const existingDay = await prisma.lifeHabitDay.findUnique({
    where: { habitId_date: { habitId, date } },
    select: { done: true },
  })
  if (!existingDay || existingDay.done !== complete) {
    await applyDayDone(habitId, date, complete)
  }
}

/** Default starter habits seeded on first open. Order is preserved. */
const STARTER_HABITS = [
  'Drink Water',
  'Exercise',
  'Read 20 min',
  'Meditate',
  'Wake Up Early',
  'No Screens After 22:00',
  'Plan Tomorrow',
  'Stretch',
]

export const lifeHabitRouter = router({
  // All non-archived habits (row order) with their explicit day marks attached.
  list: publicProcedure.query(async () => {
    return prisma.lifeHabit.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { days: { select: { date: true, done: true } } },
    })
  }),

  // All archived habits (soft-deleted: archivedAt != null), same shape as `list`.
  // Kept separate so the active `list` stays clean (excluded from every tally /
  // chart). Powers the collapsible "Archived" section.
  listArchived: publicProcedure.query(async () => {
    return prisma.lifeHabit.findMany({
      where: { archivedAt: { not: null } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { days: { select: { date: true, done: true } } },
    })
  }),

  // Toggle a habit's archived state. true → set archivedAt to now (hidden from
  // the active list/tally/chart); false → clear it (restore). Does not touch
  // autoSince or position — restoring lands it back where the caller places it
  // via a follow-up moveToSection.
  setArchived: publicProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      const habit = await prisma.lifeHabit.update({
        where: { id: input.id },
        data: { archivedAt: input.archived ? new Date() : null },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: habit.id,
        action: 'setArchived',
        payload: { archived: input.archived },
      })
      return habit
    }),

  // Permanently delete an archived habit (LifeHabitDay rows cascade). No undo —
  // the UI guards this behind a confirm.
  destroy: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.lifeHabit.delete({ where: { id: input.id } })
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: input.id,
        action: 'destroy',
        payload: {},
      })
      return { id: input.id }
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        startDate: z.string(),
        // 1 = daily (default). >1 = an interval habit due once per calendar-aligned
        // period of this many days (3 = every 3 days, 7 = weekly, …).
        cadenceDays: z.number().int().min(1).max(365).default(1),
      }),
    )
    .mutation(async ({ input }) => {
      const last = await prisma.lifeHabit.findFirst({
        where: { archivedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const habit = await prisma.lifeHabit.create({
        data: {
          name: input.name.trim(),
          startDate: input.startDate,
          cadenceDays: input.cadenceDays,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: habit.id,
        action: 'create',
        payload: { name: habit.name, startDate: habit.startDate, cadenceDays: habit.cadenceDays },
      })
      return habit
    }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const habit = await prisma.lifeHabit.update({
        where: { id: input.id },
        data: { name: input.name.trim() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: habit.id,
        action: 'rename',
        payload: { name: habit.name },
      })
      return habit
    }),

  // Set the free-text notes shown in the habit's detail popup. Empty string
  // clears them (stored as null).
  setNotes: publicProcedure
    .input(z.object({ id: z.string(), notes: z.string() }))
    .mutation(async ({ input }) => {
      const trimmed = input.notes.trim()
      const habit = await prisma.lifeHabit.update({
        where: { id: input.id },
        data: { notes: trimmed || null },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: habit.id,
        action: 'setNotes',
        payload: { hasNotes: Boolean(habit.notes) },
      })
      return habit
    }),

  // Soft-delete a habit row (its day marks cascade-delete with it on hard delete,
  // but here we keep them and just hide the row).
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const habit = await prisma.lifeHabit.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: habit.id,
        action: 'archive',
        payload: {},
      })
      return habit
    }),

  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.lifeHabit.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: 'batch',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),

  // Move a habit between the "Building" (top) and "Established" (bottom) sections,
  // and reorder all rows in one atomic write. `auto` true → set autoSince to the
  // caller's local today (auto-tick from now on); false → clear it (back to the
  // 7-day rule). `orderedIds` is the new full row order across BOTH sections.
  moveToSection: publicProcedure
    .input(
      z.object({
        id: z.string(),
        auto: z.boolean(),
        since: z.string(),
        orderedIds: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ input }) => {
      await prisma.$transaction([
        prisma.lifeHabit.update({
          where: { id: input.id },
          data: { autoSince: input.auto ? input.since : null },
        }),
        ...input.orderedIds.map((id, position) =>
          prisma.lifeHabit.update({ where: { id }, data: { position } }),
        ),
      ])
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: input.id,
        action: 'moveToSection',
        payload: { auto: input.auto, since: input.auto ? input.since : null },
      })
      return { success: true }
    }),

  // Record an explicit tick/un-tick for one (habit, date) cell. Upserts so a day
  // can be toggled freely; the value is the user's intent regardless of the
  // day-7 default (the client computes the displayed state).
  setDay: publicProcedure
    .input(z.object({ habitId: z.string(), date: z.string(), done: z.boolean() }))
    .mutation(async ({ input }) => {
      return applyDayDone(input.habitId, input.date, input.done)
    }),

  // Attach a Routine to this habit. A habit can attach several routines; its day
  // auto-ticks when ANY one of them is fully checked (OR logic). Idempotent — a
  // routine already attached is a no-op. Recompute the day afterward in case the
  // newly-attached routine is already complete for that date.
  addRoutine: publicProcedure
    .input(z.object({ habitId: z.string(), routineId: z.string(), date: z.string().optional() }))
    .mutation(async ({ input }) => {
      const last = await prisma.habitRoutine.findFirst({
        where: { habitId: input.habitId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const link = await prisma.habitRoutine.upsert({
        where: { habitId_routineId: { habitId: input.habitId, routineId: input.routineId } },
        create: { habitId: input.habitId, routineId: input.routineId, position: (last?.position ?? -1) + 1 },
        update: {},
      })
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: input.habitId,
        action: 'addRoutine',
        payload: { habitId: input.habitId, routineId: input.routineId },
      })
      if (input.date) await recomputeHabitDay(input.habitId, input.date)
      return link
    }),

  // Detach one Routine from this habit. Recompute the day afterward: removing a
  // routine that was the one satisfying the OR may flip the day back to un-ticked
  // (only when other routines remain — see recomputeHabitDay).
  removeRoutine: publicProcedure
    .input(z.object({ habitId: z.string(), routineId: z.string(), date: z.string().optional() }))
    .mutation(async ({ input }) => {
      await prisma.habitRoutine.deleteMany({
        where: { habitId: input.habitId, routineId: input.routineId },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: input.habitId,
        action: 'removeRoutine',
        payload: { habitId: input.habitId, routineId: input.routineId },
      })
      if (input.date) await recomputeHabitDay(input.habitId, input.date)
      return { habitId: input.habitId, routineId: input.routineId }
    }),

  // The per-day checklist for a habit, one entry per attached (live) routine:
  // each routine's steps + conditions with their done-state for `date`, and
  // whether that routine is complete (so the UI can show the OR auto-tick). An
  // empty array means no routine attached → the modal shows the attach picker.
  checklist: publicProcedure
    .input(z.object({ habitId: z.string(), date: z.string() }))
    .query(async ({ input }) => {
      const links = await prisma.habitRoutine.findMany({
        where: { habitId: input.habitId, routine: { archivedAt: null } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          routine: {
            select: {
              id: true,
              name: true,
              startTime: true,
              items: {
                orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                select: { id: true, text: true, durationMin: true, fixedTime: true },
              },
              conditions: {
                orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                select: { id: true, text: true },
              },
            },
          },
        },
      })
      if (links.length === 0) return []

      const checks = await prisma.habitRoutineCheck.findMany({
        where: { habitId: input.habitId, date: input.date },
        select: { sourceId: true, done: true },
      })
      const doneMap = new Map(checks.map((c) => [c.sourceId, c.done]))

      return links.map(({ routine }) => {
        // Label each step with its start time, walking the timeline exactly as the
        // Routines tab does: each step flows from the previous one's end unless
        // it's time-pinned. Unscheduled routines (null startTime) show elapsed.
        const elapsed = routine.startTime === null
        let cursor = elapsed ? 0 : toMin(routine.startTime as string)
        const steps = routine.items.map((i) => {
          const startMin = !elapsed && i.fixedTime ? toMin(i.fixedTime) : cursor
          cursor = startMin + (i.durationMin || 0)
          return {
            id: i.id,
            text: i.text,
            done: doneMap.get(i.id) === true,
            time: elapsed ? fmtElapsed(startMin) : fmtClock(startMin),
          }
        })
        const conditions = routine.conditions.map((c) => ({
          id: c.id,
          text: c.text,
          done: doneMap.get(c.id) === true,
        }))
        const total = steps.length + conditions.length
        const doneCount = steps.filter((s) => s.done).length + conditions.filter((c) => c.done).length
        return {
          routineId: routine.id,
          routineName: routine.name,
          steps,
          conditions,
          complete: total > 0 && doneCount === total,
        }
      })
    }),

  // Tick/un-tick one routine step or condition for a (habit, date). After the
  // upsert, recompute the day across ALL attached routines (OR logic): the day
  // ticks when any one routine is fully checked, and un-ticks when none is.
  setChecklistItem: publicProcedure
    .input(
      z.object({
        habitId: z.string(),
        date: z.string(),
        sourceId: z.string(),
        sourceKind: z.enum(['step', 'condition']),
        done: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const check = await prisma.habitRoutineCheck.upsert({
        where: {
          habitId_date_sourceId: {
            habitId: input.habitId,
            date: input.date,
            sourceId: input.sourceId,
          },
        },
        create: {
          habitId: input.habitId,
          date: input.date,
          sourceId: input.sourceId,
          sourceKind: input.sourceKind,
          done: input.done,
        },
        update: { done: input.done, sourceKind: input.sourceKind },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'habitRoutineCheck',
        entityId: check.id,
        action: 'setChecklistItem',
        payload: { habitId: input.habitId, date: input.date, sourceId: input.sourceId, done: input.done },
      })
      await recomputeHabitDay(input.habitId, input.date)
      return check
    }),

  // Idempotently create the eight starter habits the first time the tracker is
  // opened. Guarded by an AppSetting flag so deleting them doesn't bring them
  // back. `startDate` is the caller's local "today" (day 1 for all of them).
  seedStarter: publicProcedure
    .input(z.object({ startDate: z.string() }))
    .mutation(async ({ input }) => {
      const flag = await prisma.appSetting.findUnique({ where: { key: SEED_FLAG } })
      if (flag) return { seeded: false }

      await prisma.$transaction([
        ...STARTER_HABITS.map((name, position) =>
          prisma.lifeHabit.create({
            data: { name, startDate: input.startDate, position },
          }),
        ),
        prisma.appSetting.create({ data: { key: SEED_FLAG, value: input.startDate } }),
      ])
      await writeEvent({
        actor: 'user',
        entityType: 'lifeHabit',
        entityId: 'seed',
        action: 'seedStarter',
        payload: { count: STARTER_HABITS.length, startDate: input.startDate },
      })
      return { seeded: true }
    }),
})

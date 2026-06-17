import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * dayPlanner — the warm-paper day-view planner that lives in the Schedule tab
 * (ported from the "gentle climb" HTML). Each PlannerBlock is a task or pause
 * for one calendar day: it sits in the right-hand box until you drag it onto the
 * time axis (placed=true, startMin set). Blocks can link to a real Task (so
 * Focus mode works) and/or a Goal (pushed from Pursuits as one block).
 *
 * Unlike dailyPlan (which only references Pursuits entities), the planner OWNS
 * its blocks: a quick-add here creates a real loose Task AND a block linked to
 * it. Per-day, scoped to the local date. Every mutation writes an Event row.
 */

// Planner's 4-way energy palette (HTML colours). Note 'med' (not 'medium').
const PlannerEnergy = z.enum(['high', 'med', 'low', 'fun'])

/** Map a Task's energy ('high'|'medium'|'low'|null) to the planner palette. */
function mapTaskEnergy(e: string | null): z.infer<typeof PlannerEnergy> {
  if (e === 'high') return 'high'
  if (e === 'low') return 'low'
  return 'med' // 'medium' or null → med
}

/** Local calendar date as "YYYY-MM-DD" (matches the ScheduleBoard convention). */
function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** A "YYYY-MM-DD" day key. Optional everywhere — defaults to today when absent,
 *  so existing callers (and the Pursuits ☆ Today button) keep targeting today. */
const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/**
 * The "Personal" Pursuits area — where tasks quick-added in the Schedule module
 * are filed so they show up in Pursuits under Personal. Found by name; created
 * once if it doesn't exist yet (so the module never fails on a fresh vault).
 */
async function personalAreaId(): Promise<string> {
  const existing = await prisma.area.findFirst({ where: { name: 'Personal', archivedAt: null } })
  if (existing) return existing.id
  const last = await prisma.area.findFirst({
    where: { archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const area = await prisma.area.create({
    data: { name: 'Personal', position: (last?.position ?? -1) + 1 },
  })
  await writeEvent({
    actor: 'user',
    entityType: 'area',
    entityId: area.id,
    action: 'create',
    payload: { name: area.name },
  })
  return area.id
}

export const dayPlannerRouter = router({
  // All blocks for a date range (from ≤ date ≤ to), ordered by date then
  // position. Same include shape as `today` — useful for week-view rendering
  // and calendar exports. Read-only.
  range: publicProcedure
    .input(z.object({ from: DateKey, to: DateKey }))
    .query(async ({ input }) => {
      return prisma.plannerBlock.findMany({
        where: { date: { gte: input.from, lte: input.to } },
        orderBy: [{ date: 'asc' }, { position: 'asc' }],
        include: { task: { select: { notes: true } } },
      })
    }),

  // All of one day's blocks, in manual box order. Placed ones carry startMin.
  // `date` defaults to today, so the planner can page through past/future days.
  today: publicProcedure
    .input(z.object({ date: DateKey.optional() }).optional())
    .query(async ({ input }) => {
      return prisma.plannerBlock.findMany({
        where: { date: input?.date ?? todayISO() },
        orderBy: { position: 'asc' },
        // The linked task's notes power the detail "Context" box (so a task's
        // context lives on the task itself, shared with Pursuits / Focus).
        include: { task: { select: { notes: true } } },
      })
    }),

  // Quick-add from the planner's own controls: make a real loose Task (so Focus
  // mode has something to run) plus a box block linked to it.
  addTask: publicProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        durationMin: z.number().int().min(5).max(600).default(20),
        energy: PlannerEnergy.default('med'),
        date: DateKey.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const date = input.date ?? todayISO()
      // The real Task. energy maps back to the Task enum ('med' → 'medium').
      const taskEnergy =
        input.energy === 'high' ? 'high' : input.energy === 'low' ? 'low' : input.energy === 'fun' ? null : 'medium'
      // File it under the Pursuits "Personal" area so it shows up there too.
      const task = await prisma.task.create({
        data: {
          title: input.title.trim(),
          status: 'todo',
          energy: taskEnergy,
          estimateMin: input.durationMin,
          areaId: await personalAreaId(),
        },
      })

      const last = await prisma.plannerBlock.findFirst({
        where: { date },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const block = await prisma.plannerBlock.create({
        data: {
          date,
          title: input.title.trim(),
          kind: 'task',
          energy: input.energy,
          durationMin: input.durationMin,
          position: (last?.position ?? -1) + 1,
          taskId: task.id,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'addTask',
        payload: { title: block.title, durationMin: block.durationMin, energy: block.energy, taskId: task.id },
      })
      return block
    }),

  // A break/pause block (no task, no focus).
  addPause: publicProcedure
    .input(
      z.object({
        durationMin: z.number().int().min(5).max(600).default(15),
        date: DateKey.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const date = input.date ?? todayISO()
      const last = await prisma.plannerBlock.findFirst({
        where: { date },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const block = await prisma.plannerBlock.create({
        data: {
          date,
          title: 'Pause',
          kind: 'pause',
          energy: 'low',
          durationMin: input.durationMin,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'addPause',
        payload: { durationMin: block.durationMin },
      })
      return block
    }),

  // Create a 'work' block directly on the axis (dragged from the elements
  // palette onto the timeline). It's a container; tasks get nested into it.
  addWork: publicProcedure
    .input(
      z.object({
        startMin: z.number().int().min(0).max(1440),
        durationMin: z.number().int().min(5).max(600).default(60),
        date: DateKey.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const date = input.date ?? todayISO()
      const last = await prisma.plannerBlock.findFirst({
        where: { date },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const block = await prisma.plannerBlock.create({
        data: {
          date,
          title: 'Work block',
          kind: 'work',
          energy: 'med',
          durationMin: input.durationMin,
          placed: true,
          startMin: input.startMin,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'addWork',
        payload: { startMin: input.startMin, durationMin: input.durationMin },
      })
      return block
    }),

  // Create a placed 'meal' | 'break' | 'read' block from the palette (no task,
  // no nesting — just a fixed-purpose block dropped straight onto the axis).
  addElement: publicProcedure
    .input(
      z.object({
        kind: z.enum(['meal', 'break', 'read', 'meditation']),
        durationMin: z.number().int().min(5).max(600),
        startMin: z.number().int().min(0).max(1440),
        date: DateKey.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const date = input.date ?? todayISO()
      const last = await prisma.plannerBlock.findFirst({
        where: { date },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const title =
        input.kind === 'meal'
          ? 'Meal'
          : input.kind === 'read'
            ? 'Read'
            : input.kind === 'meditation'
              ? 'Meditation'
              : 'Break'
      const block = await prisma.plannerBlock.create({
        data: {
          date,
          title,
          kind: input.kind,
          energy: 'low',
          durationMin: input.durationMin,
          placed: true,
          startMin: input.startMin,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'addElement',
        payload: { kind: input.kind, durationMin: input.durationMin, startMin: input.startMin },
      })
      return block
    }),

  // Push a Pursuits task or goal onto today's box as one block. Idempotent per
  // (date, ref): if it's already there, returns the existing block.
  addFromPursuits: publicProcedure
    .input(z.object({ kind: z.enum(['task', 'goal']), id: z.string(), date: DateKey.optional() }))
    .mutation(async ({ input }) => {
      const date = input.date ?? todayISO()
      const existing = await prisma.plannerBlock.findFirst({
        where: input.kind === 'task' ? { date, taskId: input.id } : { date, goalId: input.id },
      })
      if (existing) return existing

      // Pull title + (for tasks) energy/duration from the real entity.
      let title = ''
      let energy: z.infer<typeof PlannerEnergy> = 'med'
      let durationMin = 20
      if (input.kind === 'task') {
        const task = await prisma.task.findUniqueOrThrow({ where: { id: input.id } })
        title = task.title
        energy = mapTaskEnergy(task.energy)
        if (task.estimateMin && task.estimateMin > 0) durationMin = task.estimateMin
      } else {
        const goal = await prisma.goal.findUniqueOrThrow({ where: { id: input.id } })
        title = goal.title
      }

      const last = await prisma.plannerBlock.findFirst({
        where: { date },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const block = await prisma.plannerBlock.create({
        data: {
          date,
          title,
          kind: 'task',
          energy,
          durationMin,
          position: (last?.position ?? -1) + 1,
          taskId: input.kind === 'task' ? input.id : null,
          goalId: input.kind === 'goal' ? input.id : null,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'addFromPursuits',
        payload: { kind: input.kind, refId: input.id, date },
      })
      return block
    }),

  // Drop today's block(s) for a Pursuits ref (powers the ☆ Today toggle).
  removeByRef: publicProcedure
    .input(z.object({ kind: z.enum(['task', 'goal']), id: z.string(), date: DateKey.optional() }))
    .mutation(async ({ input }) => {
      const date = input.date ?? todayISO()
      const where = input.kind === 'task' ? { date, taskId: input.id } : { date, goalId: input.id }
      const rows = await prisma.plannerBlock.findMany({ where })
      await prisma.plannerBlock.deleteMany({ where })
      for (const row of rows) {
        await writeEvent({
          actor: 'user',
          entityType: 'plannerBlock',
          entityId: row.id,
          action: 'removeByRef',
          payload: { kind: input.kind, refId: input.id, date },
        })
      }
      return { success: true, removed: rows.length }
    }),

  // Place a boxed block onto the axis (or move an already-placed one).
  place: publicProcedure
    .input(z.object({ id: z.string(), startMin: z.number().int().min(0).max(1440) }))
    .mutation(async ({ input }) => {
      const block = await prisma.plannerBlock.update({
        where: { id: input.id },
        data: { placed: true, startMin: input.startMin },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'place',
        payload: { startMin: input.startMin },
      })
      return block
    }),

  // Move a placed block to a new start time.
  move: publicProcedure
    .input(z.object({ id: z.string(), startMin: z.number().int().min(0).max(1440) }))
    .mutation(async ({ input }) => {
      const block = await prisma.plannerBlock.update({
        where: { id: input.id },
        data: { startMin: input.startMin },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'move',
        payload: { startMin: input.startMin },
      })
      return block
    }),

  // Send a placed block back to the box.
  unplace: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const block = await prisma.plannerBlock.update({
        where: { id: input.id },
        data: { placed: false, startMin: null },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'unplace',
        payload: {},
      })
      return block
    }),

  // Nest a task block inside a 'work' block (dropped onto it on the axis).
  // Nested blocks carry no startMin of their own — their time is derived from the
  // parent's startMin + earlier siblings' durations — so the group moves as one.
  nest: publicProcedure
    .input(z.object({ id: z.string(), parentId: z.string() }))
    .mutation(async ({ input }) => {
      if (input.id === input.parentId) throw new Error('cannot nest a block in itself')
      const lastChild = await prisma.plannerBlock.findFirst({
        where: { parentId: input.parentId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const block = await prisma.plannerBlock.update({
        where: { id: input.id },
        data: {
          parentId: input.parentId,
          placed: true,
          startMin: null,
          position: (lastChild?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'nest',
        payload: { parentId: input.parentId },
      })
      return block
    }),

  // Pull a nested task back out of its work block, into the task box.
  unnest: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      // Box position is scoped to the block's OWN day, not necessarily today.
      const self = await prisma.plannerBlock.findUniqueOrThrow({
        where: { id: input.id },
        select: { date: true },
      })
      const last = await prisma.plannerBlock.findFirst({
        where: { date: self.date, parentId: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const block = await prisma.plannerBlock.update({
        where: { id: input.id },
        data: { parentId: null, placed: false, startMin: null, position: (last?.position ?? -1) + 1 },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'unnest',
        payload: {},
      })
      return block
    }),

  // Reorder the tasks inside one work block (top → bottom = chronological).
  reorderChildren: publicProcedure
    .input(z.object({ parentId: z.string(), orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.plannerBlock.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: input.parentId,
        action: 'reorderChildren',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),

  // Edit a block's fields from the detail modal.
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        durationMin: z.number().int().min(5).max(600).optional(),
        energy: PlannerEnergy.optional(),
        landmark: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...rest } = input
      const data: {
        title?: string
        durationMin?: number
        energy?: string
        landmark?: string | null
      } = {}
      if (rest.title !== undefined) data.title = rest.title.trim()
      if (rest.durationMin !== undefined) data.durationMin = rest.durationMin
      if (rest.energy !== undefined) data.energy = rest.energy
      if (rest.landmark !== undefined) data.landmark = rest.landmark
      const block = await prisma.plannerBlock.update({ where: { id }, data })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'update',
        payload: data,
      })
      return block
    }),

  // Mark a block done / not-done (stamps completedAt).
  setDone: publicProcedure
    .input(z.object({ id: z.string(), done: z.boolean() }))
    .mutation(async ({ input }) => {
      const block = await prisma.plannerBlock.update({
        where: { id: input.id },
        data: {
          status: input.done ? 'done' : 'todo',
          completedAt: input.done ? new Date() : null,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: input.done ? 'done' : 'undone',
        payload: {},
      })
      return block
    }),

  // Hard-delete a block (planner-owned, so this is a real delete). Deleting a
  // work block first RELEASES its nested tasks back to the box (they aren't
  // deleted — the container just goes away).
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const children = await prisma.plannerBlock.findMany({
        where: { parentId: input.id },
        select: { id: true },
      })
      if (children.length) {
        // Released children go to the box of the work block's OWN day.
        const self = await prisma.plannerBlock.findUniqueOrThrow({
          where: { id: input.id },
          select: { date: true },
        })
        const last = await prisma.plannerBlock.findFirst({
          where: { date: self.date, parentId: null },
          orderBy: { position: 'desc' },
          select: { position: true },
        })
        let pos = (last?.position ?? -1) + 1
        await prisma.$transaction(
          children.map((c) =>
            prisma.plannerBlock.update({
              where: { id: c.id },
              data: { parentId: null, placed: false, startMin: null, position: pos++ },
            }),
          ),
        )
      }
      const block = await prisma.plannerBlock.delete({ where: { id: input.id } })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: input.id,
        action: 'remove',
        payload: { title: block.title },
      })
      return { success: true }
    }),

  // Move ONE block to another day. It lands in the target day's task box
  // (unplaced, un-nested) so you re-plan its time on that day. Powers the
  // per-card "→ tomorrow" / pick-a-date push in the task box.
  reschedule: publicProcedure
    .input(z.object({ id: z.string(), date: DateKey }))
    .mutation(async ({ input }) => {
      const last = await prisma.plannerBlock.findFirst({
        where: { date: input.date, parentId: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const block = await prisma.plannerBlock.update({
        where: { id: input.id },
        data: {
          date: input.date,
          placed: false,
          startMin: null,
          parentId: null,
          position: (last?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: block.id,
        action: 'reschedule',
        payload: { date: input.date },
      })
      return block
    }),

  // Bulk-push every block sitting in one day's task box (unplaced, not done,
  // top-level) onto another day's box. Placed blocks and nested tasks are left
  // where they are. Powers the "→ Tomorrow" button on the box header.
  rescheduleBox: publicProcedure
    .input(z.object({ fromDate: DateKey, toDate: DateKey }))
    .mutation(async ({ input }) => {
      const rows = await prisma.plannerBlock.findMany({
        where: { date: input.fromDate, placed: false, parentId: null, status: { not: 'done' } },
        orderBy: { position: 'asc' },
        select: { id: true },
      })
      if (rows.length === 0) return { success: true, moved: 0 }
      const last = await prisma.plannerBlock.findFirst({
        where: { date: input.toDate, parentId: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      let pos = (last?.position ?? -1) + 1
      await prisma.$transaction(
        rows.map((r) =>
          prisma.plannerBlock.update({
            where: { id: r.id },
            data: { date: input.toDate, position: pos++ },
          }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: 'batch',
        action: 'rescheduleBox',
        payload: { fromDate: input.fromDate, toDate: input.toDate, count: rows.length },
      })
      return { success: true, moved: rows.length }
    }),

  // Persist a new box order (array of block ids, top → bottom).
  reorderBox: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.plannerBlock.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'plannerBlock',
        entityId: 'batch',
        action: 'reorderBox',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),
})

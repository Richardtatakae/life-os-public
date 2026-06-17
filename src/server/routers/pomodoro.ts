import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent, readEvents } from '@/server/db/events'

export const pomodoroRouter = router({
  current: publicProcedure.query(async () => {
    return prisma.pomodoro.findFirst({
      where: { status: { in: ['running', 'paused'] } },
      orderBy: { startedAt: 'desc' },
    })
  }),

  recent: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 10
      return prisma.pomodoro.findMany({
        where: { status: { in: ['completed', 'abandoned'] } },
        orderBy: { startedAt: 'desc' },
        take: limit,
      })
    }),

  // Completed focus sessions that started on a given local day — for the day
  // planner's read-only "focus session" layer on the timeline. Each row is
  // reduced to what the axis needs: a start-minute (time of day), a wall-clock
  // duration (start→end, so it lines up with where it sat in the day), and the
  // task title for the label.
  completedForDate: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD') }))
    .query(async ({ input }) => {
      const [y, m, d] = input.date.split('-').map(Number)
      const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0)
      const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0)
      const rows = await prisma.pomodoro.findMany({
        where: { status: 'completed', startedAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { startedAt: 'asc' },
        include: { task: { select: { title: true } } },
      })
      return rows.map((p) => {
        const startMin = p.startedAt.getHours() * 60 + p.startedAt.getMinutes()
        const endMs = (p.endedAt ?? p.startedAt).getTime()
        const durationMin = Math.max(5, Math.round((endMs - p.startedAt.getTime()) / 60000))
        return { id: p.id, startMin, durationMin, title: p.task?.title ?? null }
      })
    }),

  // Focus mode: total completed focus time on one task (sum of completed sessions).
  statsForTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input }) => {
      const sessions = await prisma.pomodoro.findMany({
        where: { taskId: input.taskId, status: 'completed', endedAt: { not: null } },
      })
      const totalMs = sessions.reduce(
        (sum, p) => sum + Math.max(0, p.endedAt!.getTime() - p.startedAt.getTime() - p.pausedMs),
        0,
      )
      return { count: sessions.length, totalMs }
    }),

  start: publicProcedure
    .input(
      z.object({
        // A focus session targets exactly one Pursuit: a task (the common case),
        // or — for goal/project/area Focus mode — one of the other ids. The
        // caller sets exactly one; the server just stores what it's given.
        taskId: z.string().optional().nullable(),
        goalId: z.string().optional().nullable(),
        projectId: z.string().optional().nullable(),
        areaId: z.string().optional().nullable(),
        // Loosened for Focus mode custom durations. 15/25/50/90 still valid;
        // Pomodoro.targetMin is already an Int column, so no migration is needed.
        targetMin: z.number().int().min(1).max(180).default(25),
        notes: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      // Decision: auto-abandon any running/paused pomodoro when starting a new one.
      // Rationale: better UX than throwing — user can freely start a new session
      // without needing to manually clean up the previous one.
      const existing = await prisma.pomodoro.findFirst({
        where: { status: { in: ['running', 'paused'] } },
        orderBy: { startedAt: 'desc' },
      })

      if (existing) {
        const now = new Date()
        await prisma.pomodoro.update({
          where: { id: existing.id },
          data: { status: 'abandoned', endedAt: now },
        })
        await writeEvent({
          actor: 'user',
          entityType: 'pomodoro',
          entityId: existing.id,
          action: 'abandon',
          payload: { reason: 'auto-abandoned by new start', taskId: existing.taskId },
        })
      }

      const now = new Date()
      const pomodoro = await prisma.pomodoro.create({
        data: {
          taskId: input.taskId ?? null,
          goalId: input.goalId ?? null,
          projectId: input.projectId ?? null,
          areaId: input.areaId ?? null,
          startedAt: now,
          pausedMs: 0,
          targetMin: input.targetMin,
          status: 'running',
          notes: input.notes ?? null,
        },
      })

      await writeEvent({
        actor: 'user',
        entityType: 'pomodoro',
        entityId: pomodoro.id,
        action: 'start',
        payload: {
          taskId: input.taskId ?? null,
          goalId: input.goalId ?? null,
          projectId: input.projectId ?? null,
          areaId: input.areaId ?? null,
          targetMin: input.targetMin,
        },
      })

      return pomodoro
    }),

  pause: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const pomodoro = await prisma.pomodoro.findUnique({ where: { id: input.id } })
      if (!pomodoro) throw new Error(`Pomodoro not found: ${input.id}`)
      if (pomodoro.status !== 'running') {
        throw new Error(`Cannot pause a pomodoro with status '${pomodoro.status}'`)
      }

      const now = new Date()

      // Decision: store pausedAt via the Event log (payload.at).
      // On resume, we read the most recent 'pause' event to compute how long the pause lasted.
      // This is fully event-sourced and avoids adding a column to the Pomodoro model.
      await writeEvent({
        actor: 'user',
        entityType: 'pomodoro',
        entityId: pomodoro.id,
        action: 'pause',
        payload: { at: now.toISOString() },
      })

      return prisma.pomodoro.update({
        where: { id: input.id },
        data: { status: 'paused' },
      })
    }),

  resume: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const pomodoro = await prisma.pomodoro.findUnique({ where: { id: input.id } })
      if (!pomodoro) throw new Error(`Pomodoro not found: ${input.id}`)
      if (pomodoro.status !== 'paused') {
        throw new Error(`Cannot resume a pomodoro with status '${pomodoro.status}'`)
      }

      // Read the most recent 'pause' event to compute elapsed paused time
      const pauseEvents = await readEvents({
        entityType: 'pomodoro',
        entityId: pomodoro.id,
        action: 'pause',
        limit: 1,
      })

      const now = new Date()
      let additionalPausedMs = 0

      if (pauseEvents.length > 0) {
        const pausePayload = pauseEvents[0].payload as Record<string, unknown>
        const pausedAt = pausePayload.at as string | undefined
        if (pausedAt) {
          additionalPausedMs = now.getTime() - new Date(pausedAt).getTime()
        }
      }

      const newPausedMs = pomodoro.pausedMs + additionalPausedMs

      await writeEvent({
        actor: 'user',
        entityType: 'pomodoro',
        entityId: pomodoro.id,
        action: 'resume',
        payload: { pausedMs: newPausedMs, additionalPausedMs },
      })

      return prisma.pomodoro.update({
        where: { id: input.id },
        data: { status: 'running', pausedMs: newPausedMs },
      })
    }),

  complete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const pomodoro = await prisma.pomodoro.findUnique({ where: { id: input.id } })
      if (!pomodoro) throw new Error(`Pomodoro not found: ${input.id}`)
      if (pomodoro.status !== 'running' && pomodoro.status !== 'paused') {
        throw new Error(`Cannot complete a pomodoro with status '${pomodoro.status}'`)
      }

      const now = new Date()
      const durationMs = now.getTime() - pomodoro.startedAt.getTime() - pomodoro.pausedMs

      const updated = await prisma.pomodoro.update({
        where: { id: input.id },
        data: { status: 'completed', endedAt: now },
      })

      await writeEvent({
        actor: 'user',
        entityType: 'pomodoro',
        entityId: pomodoro.id,
        action: 'complete',
        payload: { durationMs, taskId: pomodoro.taskId },
      })

      return updated
    }),

  abandon: publicProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const pomodoro = await prisma.pomodoro.findUnique({ where: { id: input.id } })
      if (!pomodoro) throw new Error(`Pomodoro not found: ${input.id}`)
      if (pomodoro.status !== 'running' && pomodoro.status !== 'paused') {
        throw new Error(`Cannot abandon a pomodoro with status '${pomodoro.status}'`)
      }

      const now = new Date()

      const updated = await prisma.pomodoro.update({
        where: { id: input.id },
        data: { status: 'abandoned', endedAt: now },
      })

      await writeEvent({
        actor: 'user',
        entityType: 'pomodoro',
        entityId: pomodoro.id,
        action: 'abandon',
        payload: { reason: input.reason ?? null, taskId: pomodoro.taskId },
      })

      return updated
    }),
})

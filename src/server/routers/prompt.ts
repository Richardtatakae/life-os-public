/**
 * prompt.ts — tRPC router for copy-prompt generation.
 *
 * Blueprint §10.13 / Plan 13.
 *
 * Procedures:
 *   forTask(taskId)      — builds context-rich prompt for a Task entity
 *   forHabit(habitId)    — builds context-rich prompt for a Habit entity
 *   forCustom(title, context?) — generic prompt from free-form text
 *
 * Every call writes an Event row so the user has a history of assembled prompts.
 */

import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'
import {
  buildTaskPrompt,
  buildHabitPrompt,
  buildCustomPrompt,
} from '@/server/domain/prompts'

export const promptRouter = router({
  // ── forTask ───────────────────────────────────────────────────────────────

  forTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input }) => {
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: input.taskId },
        include: { goal: true },
      })

      const events = await prisma.event.findMany({
        where: { entityType: 'task', entityId: input.taskId },
        orderBy: { timestamp: 'desc' },
        take: 10,
      })

      const text = buildTaskPrompt({
        title: task.title,
        status: task.status,
        linkedGoalTitle: task.goal?.title ?? null,
        recentEvents: events.map((e) => ({
          timestamp: e.timestamp,
          action: e.action,
          payload: e.payload,
        })),
        notes: task.notes,
        priority: task.priority,
        energy: task.energy,
        deadline: task.deadline,
      })

      await writeEvent({
        actor: 'user',
        entityType: 'prompt',
        entityId: task.id,
        action: 'generate_task_prompt',
        payload: { length: text.length },
      })

      return { text }
    }),

  // ── forHabit ──────────────────────────────────────────────────────────────

  forHabit: publicProcedure
    .input(z.object({ habitId: z.string() }))
    .query(async ({ input }) => {
      const habit = await prisma.habit.findUniqueOrThrow({
        where: { id: input.habitId },
      })

      const streakState = await prisma.streakState.findUnique({
        where: { habitId: input.habitId },
      })

      const events = await prisma.event.findMany({
        where: { entityType: 'habit', entityId: input.habitId },
        orderBy: { timestamp: 'desc' },
        take: 10,
      })

      const text = buildHabitPrompt({
        title: habit.name,
        status: habit.archivedAt ? 'archived' : 'active',
        linkedGoalTitle: null,
        recentEvents: events.map((e) => ({
          timestamp: e.timestamp,
          action: e.action,
          payload: e.payload,
        })),
        notes: null,
        habitType: habit.type,
        currentStreak: streakState?.currentStreak ?? 0,
        stage: streakState?.stage ?? 'in_training',
      })

      await writeEvent({
        actor: 'user',
        entityType: 'prompt',
        entityId: habit.id,
        action: 'generate_habit_prompt',
        payload: { length: text.length },
      })

      return { text }
    }),

  // ── forCustom ─────────────────────────────────────────────────────────────

  forCustom: publicProcedure
    .input(
      z.object({
        title: z.string().min(1),
        context: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const text = buildCustomPrompt({
        title: input.title,
        notes: input.context ?? null,
      })

      // Use a stable synthetic entityId so events are queryable
      const syntheticId = `custom:${input.title.slice(0, 60)}`

      await writeEvent({
        actor: 'user',
        entityType: 'prompt',
        entityId: syntheticId,
        action: 'generate_custom_prompt',
        payload: { length: text.length },
      })

      return { text }
    }),
})

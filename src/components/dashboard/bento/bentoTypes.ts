/**
 * bentoTypes.ts — element types for the dashboard bento cards.
 *
 * Each card renders a thin read-only summary of one router's output. We derive
 * the item shapes straight from the live tRPC router types (single source of
 * truth) so a card never drifts from the data it reads. No runtime code here.
 *
 * Clean-Modern redesign Phase C2.
 */

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers/_app'

type RouterOutputs = inferRouterOutputs<AppRouter>

export type HabitItem = RouterOutputs['lifeHabit']['list'][number]
export type PlanBlock = RouterOutputs['dayPlanner']['today'][number]
export type GoalNode = RouterOutputs['goal']['tree'][number]
export type TaskItem = RouterOutputs['task']['todayList'][number]
export type JournalEntry = RouterOutputs['journal']['list'][number]

/**
 * prompts/index.ts — barrel for prompt builder functions.
 *
 * Blueprint §10.13 / Plan 13.
 */

export interface BasePromptInput {
  title: string
  status?: string | null
  linkedGoalTitle?: string | null
  recentEvents?: Array<{ timestamp: Date; action: string; payload?: unknown }>
  notes?: string | null
  vaultReferences?: string[]
  extra?: Record<string, string | number>
}

export { buildTaskPrompt } from './task-prompt'
export { buildHabitPrompt } from './habit-prompt'
export { buildCustomPrompt } from './custom-prompt'

export type { TaskPromptInput } from './task-prompt'
export type { HabitPromptInput } from './habit-prompt'

/**
 * habit-prompt.ts — builds a context-rich plain-text prompt for a habit entity.
 *
 * Blueprint §10.13 / Plan 13.
 * Pure function — no DB access.
 */

import type { BasePromptInput } from './index'

export interface HabitPromptInput extends BasePromptInput {
  habitType: string
  currentStreak: number
  stage: string
}

function formatEvent(e: { timestamp: Date; action: string; payload?: unknown }): string {
  const ts = e.timestamp instanceof Date
    ? e.timestamp.toISOString().slice(0, 16).replace('T', ' ')
    : String(e.timestamp)
  return `[${ts}] ${e.action}`
}

function stageLabel(stage: string): string {
  switch (stage) {
    case 'legendary':  return 'Legendary (30+ days — protect at all costs)'
    case 'mastered':   return 'Mastered (14+ days — keep the chain alive)'
    case 'in_training':
    default:           return 'In Training (building the habit — consistency is the goal)'
  }
}

export function buildHabitPrompt(input: HabitPromptInput): string {
  const eventLines = (input.recentEvents ?? [])
    .map((e) => `  - ${formatEvent(e)}`)
    .join('\n') || '  - (no recent activity)'

  const vaultLines = (input.vaultReferences ?? [])
    .map((p) => `- ${p}`)
    .join('\n') || '- (none)'

  return `You are helping me work on: ${input.title}

Context:
- Status: ${input.status ?? 'active'}
- Linked goal: ${input.linkedGoalTitle ?? 'none'}
- Habit type: ${input.habitType}
- Current streak: ${input.currentStreak} days
- Stage: ${stageLabel(input.stage)}
- Recent activity:
${eventLines}
- Notes: ${input.notes ?? '(none)'}

Vault references:
${vaultLines}

Suggested approach:
Focus on what is making this habit difficult to maintain right now. If the streak is high, identify risk factors (travel, schedule changes, energy dips). If the streak is low, suggest the minimum viable version of this habit to rebuild momentum. Consider whether the habit type and frequency are still appropriate for the current life context.

Constraints from CLAUDE.md:
- Literal mode; change only what I ask
- Research escalation: local → online → ask`
}

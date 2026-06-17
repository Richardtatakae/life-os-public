/**
 * task-prompt.ts — builds a context-rich plain-text prompt for a task entity.
 *
 * Blueprint §10.13 / Plan 13.
 * Pure function — no DB access.
 */

import type { BasePromptInput } from './index'

export interface TaskPromptInput extends BasePromptInput {
  priority?: number | null
  energy?: string | null
  deadline?: Date | null
}

function formatEvent(e: { timestamp: Date; action: string; payload?: unknown }): string {
  const ts = e.timestamp instanceof Date
    ? e.timestamp.toISOString().slice(0, 16).replace('T', ' ')
    : String(e.timestamp)
  return `[${ts}] ${e.action}`
}

function formatDeadline(d: Date | null | undefined): string {
  if (!d) return 'none'
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d)
}

export function buildTaskPrompt(input: TaskPromptInput): string {
  const eventLines = (input.recentEvents ?? [])
    .map((e) => `  - ${formatEvent(e)}`)
    .join('\n') || '  - (no recent activity)'

  const vaultLines = (input.vaultReferences ?? [])
    .map((p) => `- ${p}`)
    .join('\n') || '- (none)'

  const metaLines: string[] = []
  if (input.priority != null) metaLines.push(`- Priority: ${input.priority}`)
  if (input.energy != null) metaLines.push(`- Energy: ${input.energy}`)
  if (input.deadline != null) metaLines.push(`- Deadline: ${formatDeadline(input.deadline)}`)

  const metaSection = metaLines.length > 0 ? `\n${metaLines.join('\n')}` : ''

  return `You are helping me work on: ${input.title}

Context:
- Status: ${input.status ?? 'unknown'}
- Linked goal: ${input.linkedGoalTitle ?? 'none'}
- Recent activity:
${eventLines}
- Notes: ${input.notes ?? '(none)'}${metaSection}

Vault references:
${vaultLines}

Suggested approach:
Break this task into the smallest possible next action. If the task is ambiguous, clarify scope first. If there are blockers, surface them explicitly before diving into implementation. Check the linked goal to make sure this task still aligns with the intended outcome.

Constraints from CLAUDE.md:
- Literal mode; change only what I ask
- Research escalation: local → online → ask`
}

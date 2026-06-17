/**
 * custom-prompt.ts — builds a generic plain-text prompt for arbitrary input.
 *
 * Blueprint §10.13 / Plan 13.
 * Pure function — no DB access.
 */

import type { BasePromptInput } from './index'

function formatEvent(e: { timestamp: Date; action: string; payload?: unknown }): string {
  const ts = e.timestamp instanceof Date
    ? e.timestamp.toISOString().slice(0, 16).replace('T', ' ')
    : String(e.timestamp)
  return `[${ts}] ${e.action}`
}

export function buildCustomPrompt(input: BasePromptInput): string {
  const eventLines = (input.recentEvents ?? [])
    .map((e) => `  - ${formatEvent(e)}`)
    .join('\n') || '  - (no recent activity)'

  const vaultLines = (input.vaultReferences ?? [])
    .map((p) => `- ${p}`)
    .join('\n') || '- (none)'

  return `You are helping me work on: ${input.title}

Context:
- Status: ${input.status ?? 'unknown'}
- Linked goal: ${input.linkedGoalTitle ?? 'none'}
- Recent activity:
${eventLines}
- Notes: ${input.notes ?? '(none)'}

Vault references:
${vaultLines}

Suggested approach:
Help me think through this clearly. Start by restating what I'm trying to achieve in one sentence. Then identify the biggest unknown or risk. Suggest a first step that is small enough to do in the next 30 minutes, and a way to know when it's done.

Constraints from CLAUDE.md:
- Literal mode; change only what I ask
- Research escalation: local → online → ask`
}

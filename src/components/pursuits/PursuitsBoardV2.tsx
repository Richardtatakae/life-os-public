'use client'

/**
 * PursuitsBoardV2 — the full Pursuits screen on the consolidated design system.
 *
 * Mirrors the mockup (pursuits-mission-control-3-upnext.html) layout:
 *   topbar (title + subtitle)
 *   Up next            (UpNextQueueV2)
 *   three columns      (PursuitsColumnsV2 → Areas · Goals · Tasks)
 *   bottom row         (ProblemsPanelV2 + DeadlinesPanelV2, 1fr / 1.45fr)
 *   Plan your days     (WeekPlannerV2)
 *
 * Pure primitives + design tokens — zero .pmc/.cal/.boa/.cbo scoped CSS. Follows
 * the active theme (data-theme/data-mode on <html>) like every other primitive.
 */

import { type ReactElement } from 'react'
import { UpNextQueueV2 } from '@/components/pursuits/UpNextQueueV2'
import { PursuitsColumnsV2 } from '@/components/pursuits/PursuitsColumnsV2'
import { ProblemsPanelV2 } from '@/components/pursuits/ProblemsPanelV2'
import { DeadlinesPanelV2 } from '@/components/pursuits/DeadlinesPanelV2'
import { WeekPlannerV2 } from '@/components/pursuits/WeekPlannerV2'

export function PursuitsBoardV2(): ReactElement {
  return (
    <div data-testid="pursuits-board" className="flex flex-col gap-[18px]">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">Pursuits</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Track goals, tasks, and commitments across all life areas
        </p>
      </div>

      {/* Up next */}
      <UpNextQueueV2 />

      {/* Three linked columns */}
      <PursuitsColumnsV2 />

      {/* Problems + Deadlines */}
      <div
        className="grid items-start gap-[18px]"
        style={{ gridTemplateColumns: '1fr 1.45fr' }}
      >
        <ProblemsPanelV2 />
        <DeadlinesPanelV2 />
      </div>

      {/* Plan your days */}
      <WeekPlannerV2 />
    </div>
  )
}

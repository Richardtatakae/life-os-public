'use client'

/**
 * MainDashboard.tsx — the Dashboard tab.
 *
 * Renders the fixed <DashboardBento>: a calm-modern bento of 6 read-only summary
 * cards (Habits · Plan · Goals · Tasks · Focus · Journal), each wired to its real
 * tRPC router — plus a greeting header with the Calm⇄Focused density toggle.
 *
 * Sits BELOW the <TabBar> (56px), so it sizes to the viewport minus the bar and
 * scrolls if the bento is taller than the window.
 *
 * Blueprint §9 / Plan 16 + Clean-Modern redesign Phase C2.
 */

import { DashboardBento } from '@/components/dashboard/bento/DashboardBento'

export function MainDashboard() {
  return (
    <div className="app-root flex h-[calc(100vh-56px)] flex-col bg-base text-ink">
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1500px] px-6 pb-10">
          <DashboardBento />
        </div>
      </main>
    </div>
  )
}

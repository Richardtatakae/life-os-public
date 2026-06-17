'use client'

/**
 * dailyPlanContext — tells the shared Pursuits row components which surface
 * they're rendered on, so a single <PlanButton> can render the right control:
 *   • 'pursuits' (default) → a "☆ Today" toggle to push/remove the item
 *   • 'today'              → a "✕" to drop the item from today's list
 *
 * Using context (instead of threading a prop through Area → Project → Goal →
 * Task) keeps the row components unchanged apart from a single <PlanButton>.
 */

import { createContext, useContext } from 'react'

export type DailyPlanMode = 'pursuits' | 'today'

const DailyPlanModeContext = createContext<DailyPlanMode>('pursuits')

export const DailyPlanModeProvider = DailyPlanModeContext.Provider

export function useDailyPlanMode(): DailyPlanMode {
  return useContext(DailyPlanModeContext)
}

/**
 * plannerDateContext — which calendar day the shared <PlanButton> targets.
 * Defaults to today, so the Pursuits tab's ☆ Today toggle behaves as before.
 * The day planner's "＋ From Pursuits" picker overrides it with the day the
 * user is currently viewing, so toggled items land on THAT day's planner.
 */
function localTodayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const PlannerDateContext = createContext<string | null>(null)

export const PlannerDateProvider = PlannerDateContext.Provider

/** The day <PlanButton> should add/remove on. Falls back to today. */
export function usePlannerDate(): string {
  return useContext(PlannerDateContext) ?? localTodayISO()
}

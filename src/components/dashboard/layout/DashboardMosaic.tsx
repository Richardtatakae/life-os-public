'use client'

/**
 * DashboardMosaic.tsx — the Dashboard tab's canvas.
 *
 * The dashboard is intentionally EMPTY on first load. Its left sidebar is a
 * persistent dock holding every other tab's element (Pursuits · Today · the two
 * Habits boxes · Ideas · Progress · Routines) plus the Pomodoro timer. Each icon
 * stays in the rail at all times; click one to OPEN that element onto the canvas
 * (as a movable/resizable box), click it again to MINIMIZE it back. Icons are
 * grouped by source tab (a thin divider between groups) and can be dragged to
 * reorder.
 *
 * These are the SAME components the tabs use, so they render the real entities —
 * checking a task off here updates it everywhere. The dashboard keeps its own
 * layout (independent per-surface sizing, see AppSetting key "dashboardLayout"),
 * so an element can be a different size here than in its home tab.
 *
 * Redesign v2 §2.6 (reworked: empty canvas + grouped persistent dock).
 */

import { type ReactNode } from 'react'
import type { Layout } from 'react-grid-layout'

import { BoxBoard } from '@/components/shared/BoxBoard'
import { PursuitsColumns } from '@/components/pursuits/PursuitsColumns'
import { DayPlanner } from '@/components/schedule/DayPlanner'
import { LifeHabitTracker } from '@/components/habits/LifeHabitTracker'
import { HabitsJotList } from '@/components/habits/HabitsJotList'
import { IdeasList } from '@/components/ideas/IdeasList'
import { ProgressPlaceholder } from '@/components/progress/ProgressPlaceholder'
import { RoutinesView } from '@/components/routines/RoutinesView'
import { PomodoroWidget } from '@/components/dashboard/PomodoroWidget'
import { HABIT_BOX_ICONS } from '@/components/habits/HabitBoxIcons'

// ── Sidebar icons (18px line glyphs, inherit the dock colour) ────────────────

const svg = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Checklist — Pursuits. */
const PursuitsIcon = (
  <svg {...svg}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
  </svg>
)
/** Calendar with a dot — Today (Schedule). */
const TodayIcon = (
  <svg {...svg}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4" />
    <circle cx="12" cy="15" r="1.5" />
  </svg>
)
/** Lightbulb — Ideas. */
const IdeasIcon = (
  <svg {...svg}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.4 1 2.5h6c0-1.1.3-1.8 1-2.5A6 6 0 0 0 12 3z" />
  </svg>
)
/** Bar chart — Progress. */
const ProgressIcon = (
  <svg {...svg}>
    <path d="M3 3v18h18" />
    <rect x="7" y="11" width="3" height="6" />
    <rect x="12" y="7" width="3" height="10" />
    <rect x="17" y="13" width="3" height="4" />
  </svg>
)
/** Repeat loop — Routines. */
const RoutinesIcon = (
  <svg {...svg}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)
/** Timer — Pomodoro. */
const PomodoroIcon = (
  <svg {...svg}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 13V9M9 2h6M18 6l1.5-1.5" />
  </svg>
)

// ── Panes ────────────────────────────────────────────────────────────────────

interface DashPane {
  key: string
  title: string
  icon: ReactNode
  node: ReactNode
  autoHeight?: boolean
}

const PANES: DashPane[] = [
  { key: 'pursuits', title: 'Pursuits', icon: PursuitsIcon, node: <PursuitsColumns /> },
  { key: 'today', title: 'Today', icon: TodayIcon, node: <DayPlanner /> },
  { key: 'life-habits', title: 'Habits', icon: HABIT_BOX_ICONS['life-habits'], node: <LifeHabitTracker />, autoHeight: true },
  { key: 'habits-jot', title: 'Jot list', icon: HABIT_BOX_ICONS['habits-jot'], node: <HabitsJotList /> },
  { key: 'ideas', title: 'Ideas', icon: IdeasIcon, node: <IdeasList /> },
  { key: 'progress', title: 'Progress', icon: ProgressIcon, node: <ProgressPlaceholder /> },
  { key: 'routines', title: 'Routines', icon: RoutinesIcon, node: <RoutinesView /> },
  { key: 'pomodoro', title: 'Pomodoro', icon: PomodoroIcon, node: <PomodoroWidget inline /> },
]

/** Dock groups — one per source tab, in sidebar order (thin divider between). */
const DOCK_GROUPS = [
  { id: 'pursuits', paneKeys: ['pursuits'] },
  { id: 'schedule', paneKeys: ['today'] },
  { id: 'habits', paneKeys: ['life-habits', 'habits-jot'] },
  { id: 'ideas', paneKeys: ['ideas'] },
  { id: 'progress', paneKeys: ['progress'] },
  { id: 'routines', paneKeys: ['routines'] },
  { id: 'pomodoro', paneKeys: ['pomodoro'] },
]

/** Where each element lands the first time it's opened (12-col grid). */
const DEFAULT_LAYOUT: Layout = [
  { i: 'pursuits', x: 0, y: 0, w: 6, h: 12, minW: 3, minH: 5 },
  { i: 'today', x: 6, y: 0, w: 6, h: 12, minW: 3, minH: 5 },
  { i: 'life-habits', x: 0, y: 12, w: 7, h: 10, minW: 5, minH: 4 },
  { i: 'habits-jot', x: 7, y: 12, w: 3, h: 12, minW: 3, minH: 4 },
  { i: 'ideas', x: 0, y: 22, w: 5, h: 9, minW: 3, minH: 4 },
  { i: 'progress', x: 5, y: 22, w: 5, h: 7, minW: 3, minH: 3 },
  { i: 'routines', x: 0, y: 31, w: 6, h: 12, minW: 3, minH: 5 },
  { i: 'pomodoro', x: 6, y: 31, w: 3, h: 7, minW: 2, minH: 5 },
]

/** Every pane starts parked in the sidebar — the dashboard opens empty. */
const ALL_KEYS = PANES.map((p) => p.key)

export function DashboardMosaic() {
  return (
    <BoxBoard
      storageKey="dashboardLayout"
      defaultLayout={DEFAULT_LAYOUT}
      panes={PANES}
      defaultMinimized={ALL_KEYS}
      dockMode="persistent"
      dockGroups={DOCK_GROUPS}
    />
  )
}

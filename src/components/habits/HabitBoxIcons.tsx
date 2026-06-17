/**
 * HabitBoxIcons — small inline glyphs shown in the BoxBoard left dock when a
 * Habits-tab widget is minimized. Each is an 18px line icon that inherits the
 * dock colour via `stroke="currentColor"`, so they brighten to amber on hover
 * with the rest of the dock tile. One icon per pane key in the Habits layout.
 */

import type { ReactNode } from 'react'

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Rising line chart — the score chart. */
function ChartIcon() {
  return (
    <svg {...base}>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  )
}

/** Three sliders — the live-weights tuning panel. */
function SlidersIcon() {
  return (
    <svg {...base}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  )
}

/** Flame — the P/M/O streak fires. */
function FlameIcon() {
  return (
    <svg {...base}>
      <path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 11 12 9 12 3z" />
    </svg>
  )
}

/** Smiley — the mood check-in. */
function MoodIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <path d="M9 9h.01M15 9h.01" />
    </svg>
  )
}

/** Open book — the journal. */
function JournalIcon() {
  return (
    <svg {...base}>
      <path d="M12 6c-1.5-1-4-1.5-6-1.5V18c2 0 4.5.5 6 1.5 1.5-1 4-1.5 6-1.5V4.5c-2 0-4.5.5-6 1.5z" />
      <path d="M12 6v13.5" />
    </svg>
  )
}

/** Target — the hard-task difficulty logger. */
function TargetIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  )
}

/** Refresh loop — habit influence (good habits kept today). */
function LoopIcon() {
  return (
    <svg {...base}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

/** Note lines — the habits jot list. */
function NoteIcon() {
  return (
    <svg {...base}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  )
}

/** Calendar grid with a tick — the daily habit-checkbox tracker. */
function GridCheckIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M9 9v12M15 9v12" />
      <path d="M5.5 14.5l1.2 1.2 2-2.2" />
    </svg>
  )
}

/** Icon for each Habits-tab pane key. */
export const HABIT_BOX_ICONS: Record<string, ReactNode> = {
  'life-habits': <GridCheckIcon />,
  'score-chart': <ChartIcon />,
  weights: <SlidersIcon />,
  streaks: <FlameIcon />,
  mood: <MoodIcon />,
  journal: <JournalIcon />,
  'task-difficulty': <TargetIcon />,
  'habit-influence': <LoopIcon />,
  'habits-jot': <NoteIcon />,
}

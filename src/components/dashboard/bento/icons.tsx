/**
 * icons.tsx — tiny inline SVG icon set for the dashboard bento.
 *
 * The project has no icon library (a deliberate choice — see decisions.md), so
 * these are a handful of hand-rolled lucide-style stroke glyphs used in the card
 * headers + the density toggle. `currentColor` stroke so they inherit text
 * colour (and recolour per theme). Purely presentational — no hooks.
 *
 * Clean-Modern redesign Phase C2.
 */

import type { ReactNode } from 'react'

function Svg({ size = 17, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function HabitsIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8M13 12h8M13 18h8" />
    </Svg>
  )
}

export function PlanIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Svg>
  )
}

export function GoalsIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </Svg>
  )
}

export function TasksIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m8 12 3 3 5-6" />
    </Svg>
  )
}

export function FocusIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2M9 2h6" />
    </Svg>
  )
}

export function JournalIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H20v15H4.5A2.5 2.5 0 0 0 2 19.5z" />
      <path d="M2 19.5A2.5 2.5 0 0 0 4.5 22H20" />
    </Svg>
  )
}

export function PlusIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function ArrowIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  )
}

export function CheckIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m5 12 5 5L20 7" />
    </Svg>
  )
}

export function WindIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
      <path d="M17.5 8A2.5 2.5 0 1 1 19.5 12H2" />
      <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
    </Svg>
  )
}

export function GridIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </Svg>
  )
}

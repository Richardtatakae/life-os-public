'use client'

/**
 * DotBar.tsx — Horizontal row of dots representing the last N days of a habit.
 *
 * Dot states:
 *  - checked (normal check): filled emerald
 *  - free day:               filled amber
 *  - today (no check yet):   dim with bright border (pending)
 *  - missed / past + no check: dim red
 *  - future:                 not shown
 *
 * The rightmost dot represents `today`.
 */

'use client'

import React from 'react'
import { format, subDays, parseISO } from 'date-fns'

interface CheckEntry {
  date: string
  isFreeDay?: boolean
  isMissed?: boolean
}

interface DotBarProps {
  /** Number of days to show (rightmost = today) */
  days?: number
  /** Existing check entries (any subset of the window is fine) */
  checks: CheckEntry[]
  /** Today as YYYY-MM-DD — required for accurate slot alignment */
  today: string
  /** Diameter of each dot in px */
  dotSize?: number
}

export function DotBar({ days = 90, checks, today, dotSize = 6 }: DotBarProps) {
  // Build a lookup by date
  const checkMap = new Map<string, CheckEntry>()
  for (const c of checks) {
    checkMap.set(c.date, c)
  }

  // Build the date slots from oldest → newest (rightmost = today)
  const slots: string[] = []
  const todayDate = parseISO(today)
  for (let i = days - 1; i >= 0; i--) {
    slots.push(format(subDays(todayDate, i), 'yyyy-MM-dd'))
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        alignItems: 'center',
      }}
      role="img"
      aria-label={`Habit history — last ${days} days`}
    >
      {slots.map((date) => {
        const entry = checkMap.get(date)
        const isToday = date === today

        let bgColor: string
        let border: string | undefined

        if (entry) {
          if (entry.isFreeDay) {
            bgColor = 'var(--color-amber)' // amber — free day
            border = undefined
          } else if (entry.isMissed) {
            bgColor = 'var(--color-red-deep)' // very dim red tint
            border = '1px solid var(--color-red)'
          } else {
            bgColor = 'var(--color-emerald)' // emerald — checked
            border = undefined
          }
        } else if (isToday) {
          bgColor = 'transparent'
          border = `1px solid var(--color-muted)` // muted border = pending
        } else {
          bgColor = 'var(--color-surface-2)' // dim = no check, past
          border = undefined
        }

        return (
          <div
            key={date}
            title={date}
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: '50%',
              backgroundColor: bgColor,
              border: border ?? 'none',
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}

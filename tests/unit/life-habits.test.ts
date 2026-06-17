/**
 * lifeHabits pure-logic tests — the day-7 default rule + date helpers for the
 * "Habits that definitely improve my life" tracker. No DB: these are pure
 * functions, tested in isolation.
 */

import { describe, it, expect } from 'vitest'
import {
  daysBetween,
  addDaysISO,
  dayIndex,
  isActiveDay,
  defaultDone,
  cellDone,
  dateRange,
  periodStart,
  periodEnd,
  consistencyScore,
} from '@/lib/lifeHabits'

const START = '2026-06-04'

describe('daysBetween', () => {
  it('is 0 for the same day', () => expect(daysBetween(START, START)).toBe(0))
  it('counts forward', () => expect(daysBetween(START, '2026-06-11')).toBe(7))
  it('counts backward as negative', () => expect(daysBetween(START, '2026-06-01')).toBe(-3))
  it('spans a month boundary', () => expect(daysBetween('2026-06-28', '2026-07-02')).toBe(4))
})

describe('addDaysISO', () => {
  it('adds days', () => expect(addDaysISO(START, 7)).toBe('2026-06-11'))
  it('subtracts days', () => expect(addDaysISO(START, -4)).toBe('2026-05-31'))
  it('rolls over a year', () => expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01'))
})

describe('dayIndex / isActiveDay', () => {
  it('start date is day 1', () => expect(dayIndex(START, START)).toBe(1))
  it('day 8 is index 8', () => expect(dayIndex(START, '2026-06-11')).toBe(8))
  it('pre-start days are <= 0 and inactive', () => {
    expect(dayIndex(START, '2026-06-03')).toBe(0)
    expect(isActiveDay(START, '2026-06-03')).toBe(false)
    expect(isActiveDay(START, START)).toBe(true)
  })
})

describe('defaultDone — Building section (no autoSince) is always manual', () => {
  it('day 1 defaults OFF', () => {
    expect(defaultDone(START, START)).toBe(false)
  })
  it('days 1..7 default OFF', () => {
    for (let i = 0; i < 7; i++) {
      expect(defaultDone(START, addDaysISO(START, i))).toBe(false)
    }
  })
  it('day 8 (was the old auto-flip point) still defaults OFF — no auto-fill', () => {
    expect(defaultDone(START, addDaysISO(START, 7))).toBe(false) // day 8
  })
  it('day 40 defaults OFF — Building habits NEVER auto-check', () => {
    expect(defaultDone(START, addDaysISO(START, 39))).toBe(false) // day 40
  })
  it('null autoSince is identical to omitting it — always OFF', () => {
    expect(defaultDone(START, addDaysISO(START, 7), null)).toBe(false)
    expect(defaultDone(START, addDaysISO(START, 40), null)).toBe(false)
  })
})

describe('cellDone — explicit overrides the default (Building, no autoSince)', () => {
  it('returns false when no explicit mark (Building habit, any day)', () => {
    expect(cellDone(START, START, undefined)).toBe(false)                     // day 1
    expect(cellDone(START, addDaysISO(START, 7), undefined)).toBe(false)      // day 8
    expect(cellDone(START, addDaysISO(START, 10), undefined)).toBe(false)     // day 11
  })
  it('honours an explicit tick on any day', () => {
    expect(cellDone(START, START, true)).toBe(true)
    expect(cellDone(START, addDaysISO(START, 7), true)).toBe(true)            // day 8
  })
  it('honours an explicit false on any day', () => {
    expect(cellDone(START, addDaysISO(START, 10), false)).toBe(false)
  })
})

describe('defaultDone — the "Established" auto-tick section (autoSince)', () => {
  // A habit started on START, promoted to the auto section on day 5.
  const SINCE = addDaysISO(START, 4) // day 5

  it('days before autoSince keep the normal 7-day rule (no history rewrite)', () => {
    expect(defaultDone(START, START, SINCE)).toBe(false) // day 1, still manual
    expect(defaultDone(START, addDaysISO(START, 3), SINCE)).toBe(false) // day 4, < since
  })
  it('days on/after autoSince default ON, even inside the first 7 days', () => {
    expect(defaultDone(START, SINCE, SINCE)).toBe(true) // day 5 = since
    expect(defaultDone(START, addDaysISO(START, 5), SINCE)).toBe(true) // day 6, well before day 8
  })
  it('null autoSince means Building (manual only) — always OFF regardless of day count', () => {
    expect(defaultDone(START, START, null)).toBe(false)
    expect(defaultDone(START, addDaysISO(START, 8), null)).toBe(false)  // was once true; no longer
    expect(defaultDone(START, addDaysISO(START, 40), null)).toBe(false)
  })
})

describe('cellDone — autoSince with explicit overrides', () => {
  const SINCE = addDaysISO(START, 4)
  it('auto-era day with no mark reads done', () => {
    expect(cellDone(START, SINCE, undefined, SINCE)).toBe(true)
  })
  it('an explicit un-tick still wins in the auto era (a logged miss)', () => {
    expect(cellDone(START, SINCE, false, SINCE)).toBe(false)
  })
  it('a pre-autoSince manual day is unaffected by the section', () => {
    expect(cellDone(START, START, undefined, SINCE)).toBe(false)
    expect(cellDone(START, START, true, SINCE)).toBe(true)
  })
})

describe('dateRange', () => {
  it('is inclusive on both ends', () => {
    expect(dateRange(START, addDaysISO(START, 3))).toEqual([
      '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07',
    ])
  })
  it('returns a single day when from === to', () => {
    expect(dateRange(START, START)).toEqual([START])
  })
})

describe('periodStart / periodEnd — calendar-aligned interval periods', () => {
  it('daily (cadence 1) is the day itself', () => {
    expect(periodStart('2026-06-04', 1)).toBe('2026-06-04')
    expect(periodEnd('2026-06-04', 1)).toBe('2026-06-04')
  })
  it('weekly periods start on Monday (epoch-aligned) and end Sunday', () => {
    expect(periodStart('2026-06-04', 7)).toBe('2026-06-01') // Thu → that Monday
    expect(periodEnd('2026-06-04', 7)).toBe('2026-06-07') // → Sunday
    expect(periodStart('2026-06-01', 7)).toBe('2026-06-01') // Monday itself
    expect(periodStart('2026-06-07', 7)).toBe('2026-06-01') // Sunday, same week
    expect(periodStart('2026-06-08', 7)).toBe('2026-06-08') // next Monday
  })
  it('all dates within a 3-day period share one start', () => {
    expect(periodStart('2026-06-04', 3)).toBe('2026-06-04')
    expect(periodStart('2026-06-05', 3)).toBe('2026-06-04')
    expect(periodStart('2026-06-06', 3)).toBe('2026-06-04')
    expect(periodStart('2026-06-07', 3)).toBe('2026-06-07')
  })
  it('boundaries are independent of any habit start (calendar-aligned)', () => {
    expect(periodStart('2026-06-10', 7)).toBe('2026-06-08')
    expect(periodStart('2026-06-12', 7)).toBe('2026-06-08')
  })
})

describe('defaultDone — interval habits never day-7 auto-flip', () => {
  it('an interval period defaults OFF even long after start', () => {
    expect(defaultDone(START, '2026-07-30', null, 7)).toBe(false)
    expect(defaultDone(START, '2026-07-30', null, 3)).toBe(false)
  })
  it('autoSince still promotes interval periods to default ON', () => {
    const since = '2026-06-15'
    expect(defaultDone(START, '2026-06-22', since, 7)).toBe(true) // period on/after since
    expect(defaultDone(START, '2026-06-08', since, 7)).toBe(false) // period before since
  })
  it('daily Building habit (cadence omitted, no autoSince) is always OFF', () => {
    expect(defaultDone(START, addDaysISO(START, 7))).toBe(false) // day 8 — no auto-flip
    expect(defaultDone(START, START)).toBe(false)
    expect(defaultDone(START, addDaysISO(START, 40))).toBe(false)
  })
})

describe('consistencyScore — period-based for interval habits', () => {
  const today = '2026-06-30'
  it('cadence omitted equals cadence 1 (daily path unchanged)', () => {
    const explicit = new Map([['2026-06-10', true]])
    expect(consistencyScore(START, explicit, today, null)).toBe(
      consistencyScore(START, explicit, today, null, 1),
    )
  })
  it('an unticked interval habit scores 0', () => {
    expect(consistencyScore(START, new Map(), today, null, 7)).toBe(0)
  })
  it('ticking every weekly period lifts the score well above zero', () => {
    const explicit = new Map([
      ['2026-06-01', true], ['2026-06-08', true], ['2026-06-15', true],
      ['2026-06-22', true], ['2026-06-29', true],
    ])
    expect(consistencyScore(START, explicit, today, null, 7)).toBeGreaterThan(50)
  })
  it('a tick on a non-period-start day does not count', () => {
    // 2026-06-04 (Thu) is not a weekly period start — only Mondays are.
    const explicit = new Map([['2026-06-04', true]])
    expect(consistencyScore(START, explicit, today, null, 7)).toBe(0)
  })
})

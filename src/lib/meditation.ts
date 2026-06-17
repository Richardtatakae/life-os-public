/**
 * meditation — pure helpers for the meditation logger + chart shown inside a
 * habit's detail popup (HabitDetailModal) when the habit is duration-tracked (the
 * "Meditation" row). No server/Prisma imports, so the router, the panel, and the
 * unit tests can all share them.
 *
 * The chart's x-scope is a continuous time window measured in days (`spanDays`),
 * which the user widens/narrows by dragging. The bucket granularity
 * (day / week / month) is DERIVED from that width (see bucketForSpan), so zooming
 * the time scope wide enough auto-switches the chart to weekly, then monthly. The
 * Day/Week/Month buttons are just presets that jump the span into each band.
 */

import { addDaysISO, daysBetween } from '@/lib/lifeHabits'

/** Habit names (lower-cased) that show the meditation duration logger + chart. */
const MEDITATION_NAMES = new Set(['meditation', 'meditate'])

/** Does this habit get the meditation logger in its detail popup? */
export function isMeditationHabit(name: string): boolean {
  return MEDITATION_NAMES.has(name.trim().toLowerCase())
}

/** A logged sitting, as the chart/aggregation needs it. */
export interface MeditationPoint {
  date: string // "YYYY-MM-DD"
  durationMin: number
}

export type MeditationBucket = 'day' | 'week' | 'month'

export const BUCKET_LABEL: Record<MeditationBucket, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
}

/** Visible window (in days) each preset button jumps to. */
export const SPAN_PRESET: Record<MeditationBucket, number> = {
  day: 30,
  week: 112, // ~16 weeks
  month: 365, // ~12 months
}

/** How far the time scope can be dragged. */
export const MIN_SPAN = 7
export const MAX_SPAN = 1095 // ~3 years

/** How far the window can be panned relative to today (days). Positive = into the
 *  future (empty whitespace); negative = back through past dates. */
export const OFFSET_MIN = -3650 // ~10 years back
export const OFFSET_MAX = 365 // up to a year of future whitespace

/**
 * Granularity for a given window width. Narrow → per-day points; widen past ~7
 * weeks → weekly buckets; widen past ~1 year → monthly. The thresholds line up
 * with the presets so each button lands squarely in its band.
 */
export function bucketForSpan(spanDays: number): MeditationBucket {
  if (spanDays <= 49) return 'day'
  if (spanDays <= 364) return 'week'
  return 'month'
}

/** One plotted point: a bucket's start date, total minutes, and #sessions. */
export interface MeditationBar {
  /** "YYYY-MM-DD" — the bucket's first day (day = the day itself). */
  bucket: string
  /** Sum of durations of every session that fell in the bucket. */
  totalMin: number
  /** How many sittings fell in the bucket. */
  sessions: number
}

/** Monday-anchored "YYYY-MM-DD" of the week containing `date`. */
export function weekStartISO(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() // 0=Sun
  const back = (wd + 6) % 7 // days since Monday
  return addDaysISO(date, -back)
}

/** "YYYY-MM-01" of the month containing `date`. */
export function monthStartISO(date: string): string {
  const [y, m] = date.split('-')
  return `${y}-${m}-01`
}

/** The bucket key a date falls into, for the chosen granularity. */
export function bucketOf(date: string, bucket: MeditationBucket): string {
  if (bucket === 'week') return weekStartISO(date)
  if (bucket === 'month') return monthStartISO(date)
  return date
}

/**
 * Aggregate sessions into an ordered list of buckets covering [fromDate, toDate],
 * including empty buckets (so the line/bars show zero days, not gaps). `fromDate`
 * is snapped down to its bucket boundary. `toDate` may run past `dataCutoff`
 * (today) when the window is panned into the future: those trailing buckets are
 * seeded but stay empty, and sessions are only counted up to `dataCutoff`.
 */
export function aggregate(
  sessions: MeditationPoint[],
  bucket: MeditationBucket,
  fromDate: string,
  toDate: string,
  dataCutoff: string,
): MeditationBar[] {
  const start = bucketOf(fromDate, bucket)

  // Seed every bucket boundary in range with zero, in chronological order.
  const bars = new Map<string, MeditationBar>()
  let cursor = start
  let guard = 0
  while (cursor <= toDate && guard++ < 2000) {
    bars.set(cursor, { bucket: cursor, totalMin: 0, sessions: 0 })
    if (bucket === 'month') {
      const [y, m] = cursor.split('-').map(Number)
      cursor = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    } else {
      cursor = addDaysISO(cursor, bucket === 'week' ? 7 : 1)
    }
  }

  for (const s of sessions) {
    if (s.date < start || s.date > dataCutoff) continue
    const key = bucketOf(s.date, bucket)
    const bar = bars.get(key)
    if (bar) {
      bar.totalMin += s.durationMin
      bar.sessions += 1
    }
  }
  return Array.from(bars.values())
}

/** Summary stats over the buckets in view: totals + averages. */
export function summarize(bars: MeditationBar[]): {
  totalMin: number
  sessions: number
  avgPerSession: number
  avgPerActiveBucket: number
} {
  const totalMin = bars.reduce((a, b) => a + b.totalMin, 0)
  const sessions = bars.reduce((a, b) => a + b.sessions, 0)
  const active = bars.filter((b) => b.totalMin > 0).length
  return {
    totalMin,
    sessions,
    avgPerSession: sessions ? Math.round(totalMin / sessions) : 0,
    avgPerActiveBucket: active ? Math.round(totalMin / active) : 0,
  }
}

/** "1h 05m" / "45m" from a minute count. */
export function formatMinutes(min: number): string {
  if (min <= 0) return '0m'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`
}

/** A short label for the current window width, e.g. "30d" / "16w" / "12mo". */
export function formatSpan(spanDays: number, bucket: MeditationBucket): string {
  if (bucket === 'day') return `${spanDays}d`
  if (bucket === 'week') return `${Math.round(spanDays / 7)}w`
  return `${Math.round(spanDays / 30)}mo`
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Re-export so callers don't need two imports for the date math. */
export { addDaysISO, daysBetween }

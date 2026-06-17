/**
 * lifeHabits — pure date + default-state helpers for the "Habits that definitely
 * improve my life" tracker. No server/Prisma imports, so both the router and the
 * client widget can use them, and the autoSince logic is unit-tested in isolation.
 *
 * The two sections:
 *   • "Building" (no autoSince) → every box defaults OFF; the user ticks each day
 *     manually. No auto-fill ever fires for this section.
 *   • "Established" (autoSince set) → from autoSince onward the box defaults ON;
 *     the user only acts to UN-tick a day they missed.
 * Only days the user explicitly clicks are stored; every other day reads from
 * `defaultDone`, so no background job is needed to "fill in" automatic days.
 */

/**
 * Calendar epoch for interval-habit period alignment. 2024-01-01 was a MONDAY,
 * so weekly (cadence 7) and fortnightly (14) periods start on Mondays, and every
 * habit of a given cadence shares the same period boundaries (calendar-aligned,
 * NOT relative to each habit's own startDate). Every-N-days cadences with no
 * natural calendar anchor (e.g. 3) tile consistently from this same epoch.
 */
export const PERIOD_EPOCH = '2024-01-01'

/** Local calendar date as "YYYY-MM-DD" (matches the dailyPlan convention). */
export function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Whole days between two "YYYY-MM-DD" dates (b − a). Uses UTC noon to dodge DST. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ua = Date.UTC(ay, am - 1, ad, 12)
  const ub = Date.UTC(by, bm - 1, bd, 12)
  return Math.round((ub - ua) / 86_400_000)
}

/** Return a new "YYYY-MM-DD" `n` days after `iso` (n may be negative). */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d, 12) + n * 86_400_000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * 1-based day number of `date` for a habit that began on `startDate`.
 * startDate itself is day 1. Returns ≤ 0 for dates before the habit existed.
 */
export function dayIndex(startDate: string, date: string): number {
  return daysBetween(startDate, date) + 1
}

/** Has `date` fallen on or after the habit's start? (Cells before this are blank.) */
export function isActiveDay(startDate: string, date: string): boolean {
  return dayIndex(startDate, date) >= 1
}

/**
 * The start date ("YYYY-MM-DD") of the calendar-aligned period of length
 * `cadenceDays` that contains `date`. Periods tile from `PERIOD_EPOCH` (a Monday),
 * so all habits of the same cadence share boundaries. `cadenceDays <= 1` (daily)
 * returns the day itself — so the daily code path is unchanged.
 */
export function periodStart(date: string, cadenceDays: number): string {
  const c = Math.max(1, Math.floor(cadenceDays))
  if (c === 1) return date
  const idx = Math.floor(daysBetween(PERIOD_EPOCH, date) / c)
  return addDaysISO(PERIOD_EPOCH, idx * c)
}

/** Inclusive end date of the calendar-aligned period that contains `date`. */
export function periodEnd(date: string, cadenceDays: number): string {
  const c = Math.max(1, Math.floor(cadenceDays))
  return addDaysISO(periodStart(date, c), c - 1)
}

/**
 * The automatic state of a cell with no explicit user mark.
 *
 * `autoSince` puts a habit in the bottom "Established" section: from that date
 * onward the cell defaults ON (auto-ticked), so you only ever un-tick a miss.
 * Days BEFORE `autoSince` keep the manual-off default, so promoting a habit
 * never rewrites its history (the score/dots don't change).
 * `autoSince` null/undefined → the "Building" section (manual only — every cell
 * defaults OFF regardless of how many days have passed).
 */
export function defaultDone(
  startDate: string,
  date: string,
  autoSince?: string | null,
  cadenceDays: number = 1,
): boolean {
  const c = Math.max(1, Math.floor(cadenceDays))
  if (autoSince && periodStart(date, c) >= periodStart(autoSince, c)) return true
  // No autoSince → Building section (manual). All periods default OFF.
  // This includes daily habits past day 7 — they stay manual until explicitly
  // promoted to Established via autoSince.
  return false
}

/** Final displayed state of a cell: the user's explicit mark, else the default. */
export function cellDone(
  startDate: string,
  date: string,
  explicit: boolean | undefined,
  autoSince?: string | null,
  cadenceDays: number = 1,
): boolean {
  return explicit ?? defaultDone(startDate, date, autoSince, cadenceDays)
}

/** Inclusive list of "YYYY-MM-DD" dates from `fromISO` to `toISO`. */
export function dateRange(fromISO: string, toISO: string): string[] {
  const out: string[] = []
  const span = daysBetween(fromISO, toISO)
  for (let i = 0; i <= span; i++) out.push(addDaysISO(fromISO, i))
  return out
}

/**
 * Half-life (in days) of the consistency score's memory. After this many days a
 * given day's influence has decayed by half. 13 is the Loop Habit Tracker value:
 * doing a habit every day reaches ~80% after a month, ~96% after two, ~99% after
 * three — and a single recent miss only dents the score a few points.
 */
export const SCORE_HALF_LIFE_DAYS = 13

/**
 * Consistency score (0–100) for a habit, via exponential smoothing — the same
 * method Loop Habit Tracker uses. It walks every day from `startDate` to `today`,
 * reads each day's done/missed state through the day-7 rule (`cellDone`, so the
 * score always agrees with the boxes), and folds it into a recency-weighted
 * average: `score = score*m + value*(1-m)`, with `m = 0.5^(1/HALF_LIFE)`.
 *
 * Why this and not a streak or a flat average:
 *   • One missed day after a long run barely moves it (no "streak reset" cliff).
 *   • Recent days count most, so getting back on track lifts it quickly.
 *   • It tops out around the high-90s only with sustained consistency, so there's
 *     always headroom to chase.
 *
 * `explicit` is the map of the user's stored ticks/un-ticks (date → done); days
 * the user never touched fall back to the day-7 default.
 */
export function consistencyScore(
  startDate: string,
  explicit: Map<string, boolean>,
  today: string,
  autoSince?: string | null,
  cadenceDays: number = 1,
): number {
  const c = Math.max(1, Math.floor(cadenceDays))
  // Walk PERIODS, not days: each period folds in once. The decay is scaled by the
  // cadence (0.5^(c/HALF_LIFE)) so the score keeps the same ~13-day wall-clock
  // memory regardless of cadence — a weekly habit at 85% means the same sustained
  // consistency as a daily one at 85%. For c=1 this is bit-for-bit the old daily
  // EMA. Days within a period that aren't its start are never read (interval ticks
  // are stored on the period's start date).
  const begin = periodStart(scoreStart(startDate, explicit), c)
  const span = daysBetween(begin, periodStart(today, c))
  if (span < 0) return 0
  const m = Math.pow(0.5, c / SCORE_HALF_LIFE_DAYS)
  let score = 0
  for (let off = 0; off <= span; off += c) {
    const ps = addDaysISO(begin, off)
    const done = cellDone(startDate, ps, explicit.get(ps), autoSince, c)
    score = score * m + (done ? 1 : 0) * (1 - m)
  }
  // Keep two decimals of precision (e.g. 16.73) — the UI formats the display.
  return Math.round(score * 10000) / 100
}

/**
 * The first day the score should count. Normally that's the habit's `startDate`,
 * but if you explicitly ticked (or un-ticked) an even earlier day, the score
 * begins there instead — so marks you made before the row's start date still
 * count, rather than being silently dropped. Exported so the tracker grid can
 * draw (and allow editing of) boxes from the same effective start the score uses,
 * keeping the visible history and the score in agreement.
 */
export function scoreStart(startDate: string, explicit: Map<string, boolean>): string {
  let begin = startDate
  for (const d of explicit.keys()) if (d < begin) begin = d
  return begin
}

/**
 * The consistency score as it stood on every day in [fromDate, toDate] — the
 * series behind the "consistency over time" chart. The EMA is always run from the
 * habit's own `startDate` (so the warm-up history is correct), but only days
 * inside the requested window are emitted; days before the habit existed yield no
 * point, so its line simply begins partway across the chart.
 */
export function consistencyScoreSeries(
  startDate: string,
  explicit: Map<string, boolean>,
  fromDate: string,
  toDate: string,
  autoSince?: string | null,
  cadenceDays: number = 1,
): { date: string; score: number }[] {
  const out: { date: string; score: number }[] = []
  const c = Math.max(1, Math.floor(cadenceDays))
  const begin = periodStart(scoreStart(startDate, explicit), c)
  const span = daysBetween(begin, toDate)
  if (span < 0) return out
  const m = Math.pow(0.5, c / SCORE_HALF_LIFE_DAYS)
  let score = 0
  // Fold one value per period, then emit that (flat) score for every day of the
  // period inside the window — so an interval habit draws a smooth step line that
  // merges cleanly with daily habits' per-day points. For c=1 this is the old
  // per-day series exactly (each period is a single day).
  for (let off = 0; off <= span; off += c) {
    const ps = addDaysISO(begin, off)
    const done = cellDone(startDate, ps, explicit.get(ps), autoSince, c)
    score = score * m + (done ? 1 : 0) * (1 - m)
    const rounded = Math.round(score * 10000) / 100
    for (let k = 0; k < c; k++) {
      const day = addDaysISO(ps, k)
      if (day > toDate) break
      if (day >= fromDate) out.push({ date: day, score: rounded })
    }
  }
  return out
}

/**
 * habitLevels — the level ladder layered on top of the consistency score for the
 * "Habits that definitely improve my life" tracker. Pure module (no server/Prisma
 * imports, like `lifeHabits.ts`), so the table, the chart, the detail modal AND
 * the server router all import from this single source of truth.
 *
 * The consistency score (0–100, see `consistencyScore` in lifeHabits.ts) is an
 * exponential moving average ≈ the recency-weighted % of days you did the habit.
 * Here it's bucketed into an 8-rung ladder, Level 0 → Level 7:
 *
 *   0 Starting   0–9.99    grey/faint
 *   1 Spark      10–24.99  ~2 perfect days  (first win must come fast)
 *   2 Building   25–44.99  ~5
 *   3 Consistent 45–69.99  ~11
 *   4 Strong     70–89.99  ~23
 *   5 Elite      90–98.99  ~43
 *   6 Legend     99.0–99.98 ~86  (gold tier, special shimmer visuals)
 *   7 Mythical   99.99+     ~173 (the summit — blue-iridescent visuals, cap 100)
 *
 * Days-to-reach roughly double each rung — self-balancing pacing, kept on purpose.
 * The score never literally reaches 100 (it asymptotes), so the two summit tiers
 * are razor-thin: Legend is the whole 99.0–99.98 band, and Mythical is everything
 * from 99.99 up to the hard CAP of 100 — a single missed day drops a Mythical habit
 * back down, which is the intended fragility of the summit.
 */

/** One rung of the ladder. `floor` is the inclusive score at which it's reached. */
export interface Level {
  level: number
  name: string
  floor: number
  /** CSS colour (a globals.css token) for the rung's tag / bar / chart line. */
  color: string
  /** Optional override for the chip digit colour. When unset the UI auto-picks
   *  black/white via `inkOn()`; set it to force a specific colour on a borderline
   *  fill (e.g. white on the L2 slate, for visual consistency with L0/L1). */
  ink?: string
  /** The gold summit tier — drives the special shimmer / gold-decimal visuals. */
  isLegend?: boolean
  /** The very top rung above Legend — blue-iridescent "Mythical" summit visuals. */
  isMythical?: boolean
}

/**
 * The ladder, 0-indexed. Thresholds (floors) and names are LOCKED — see the
 * handoff. Colour ramp = "Cividis Turbo" (Variation 3): a saturated, red-free
 * sweep grey (neutral L0 baseline, visible on light + dark)→ steel → tan → bright gold that climbs steadily in brightness, so
 * the level order survives a red-green colour weakness (and even full grayscale).
 * No green anywhere; Legend is the brightest gold, and Mythical jumps to the
 * opposite (blue) pole of the colour-safe axis so the two summit tiers stay
 * distinct from each other as well as from the rest of the ladder.
 */
export const LEVELS: Level[] = [
  { level: 0, name: 'Starting',   floor: 0,     color: '#6b7280' },
  { level: 1, name: 'Spark',      floor: 10,    color: '#2a5a86' },
  { level: 2, name: 'Building',   floor: 25,    color: '#5a7f93', ink: '#ffffff' },
  { level: 3, name: 'Consistent', floor: 45,    color: '#9c8d5a' },
  { level: 4, name: 'Strong',     floor: 70,    color: '#cdaa2c' },
  { level: 5, name: 'Elite',      floor: 90,    color: '#f2cc12' },
  { level: 6, name: 'Legend',     floor: 99,    color: '#ffe34a', isLegend: true },
  { level: 7, name: 'Mythical',   floor: 99.99, color: '#38bdf8', isMythical: true },
]

/** Hard cap on the score — the top of the Mythical band. The EMA never reaches 100. */
export const CAP = 100

/** Bare threshold floors `[0, 10, 25, 45, 70, 90, 99, 99.99]` — for the chart lines. */
export const THRESHOLDS: number[] = LEVELS.map((l) => l.floor)

/** The ceiling of rung `i`: the next rung's floor, or the hard CAP for the top. */
function ceilOf(i: number): number {
  return i < LEVELS.length - 1 ? LEVELS[i + 1].floor : CAP
}

/** The level a score currently sits in, with everything the UI needs to render. */
export interface LevelInfo {
  level: number
  name: string
  floor: number
  ceil: number
  color: string
  /** Forced chip-digit colour, if the rung sets one (else auto via `inkOn`). */
  ink?: string
  /** 0–1 fill of the score WITHIN its band — `(score − floor) / (ceil − floor)`. */
  progress: number
  isLegend: boolean
  isMythical: boolean
}

/**
 * Resolve a consistency score (0–100) to its level. The `progress` is re-based
 * to the current band ONLY — it fills toward the next rung then snaps near-empty
 * on a cross — so the bar always shows "distance to next level", never the raw
 * score across 0–100. For the summit tiers the band is a tiny range stretched
 * across the whole bar (Legend 99.0–99.99, Mythical 99.99–100), which is what
 * makes the top decimals visually meaningful.
 *
 * Scores below 0 clamp to Level 0; 99.99+ is Mythical (progress is clamped to
 * [0, 1], so a score at/above the cap reads as a full Mythical bar).
 */
export function levelFor(score: number): LevelInfo {
  let i = LEVELS.length - 1
  while (i > 0 && score < LEVELS[i].floor) i--
  const lv = LEVELS[i]
  const ceil = ceilOf(i)
  const progress = Math.max(0, Math.min(1, (score - lv.floor) / (ceil - lv.floor)))
  return {
    level: lv.level,
    name: lv.name,
    floor: lv.floor,
    ceil,
    color: lv.color,
    ink: lv.ink,
    progress,
    isLegend: Boolean(lv.isLegend),
    isMythical: Boolean(lv.isMythical),
  }
}

/**
 * The two summit tiers (Legend, Mythical) get special accent visuals; every other
 * rung just uses its own `color`. Centralised here so the dial, pips, chart, modal
 * AND the row all render the summit identically. Legend = gold; Mythical = blue
 * iridescent — the blue↔yellow contrast keeps the two top tiers distinct from each
 * other under a red-green colour weakness. Returns null for ordinary rungs.
 */
export interface SummitStyle {
  /** CSS token for the tier name / level digit / score decimals. */
  accent: string
  /** rgba halo for text-shadow & drop-shadow glows. */
  glow: string
  /** Glyph appended after the tier name (e.g. `Legend ✦`). */
  star: string
  /** Animated gradient fill class for the top pip / unlocked medal. */
  fillClass: string
}

export function summitStyle(info: { isLegend?: boolean; isMythical?: boolean }): SummitStyle | null {
  if (info.isMythical)
    return { accent: 'var(--color-mythic)', glow: 'rgba(56,189,248,0.6)', star: '✧', fillClass: 'habit-mythic-fill' }
  if (info.isLegend)
    return { accent: 'var(--color-amber-light)', glow: 'rgba(251,191,36,0.6)', star: '✦', fillClass: 'habit-legend-fill' }
  return null
}

/**
 * Pick black or white — whichever has the higher WCAG contrast — for a digit/
 * label drawn ON a solid hex fill. Lets the level chip stay legible no matter how
 * dark (navy) or light (gold) its fill is, on any theme. Falls back to black for
 * non-hex input.
 */
export function inkOn(hex: string): string {
  const c = hex.replace('#', '')
  if (c.length < 6) return '#000000'
  const lin = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  // contrast ratio against white (1.0) vs black (0.0); higher wins
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#000000'
}

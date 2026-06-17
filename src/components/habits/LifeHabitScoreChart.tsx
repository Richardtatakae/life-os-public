'use client'

/**
 * LifeHabitScoreChart — the "consistency over time" modal for the
 * "Habits that definitely improve my life" tracker.
 *
 * Opened by clicking a row's consistency bar. It plots that habit's
 * `consistencyScoreSeries` (the same exponential-smoothing score the bar shows,
 * day by day) as a line, and lets you toggle every OTHER habit on/off as extra
 * lines on the same axis — so you can compare how consistent you've been across
 * habits. The clicked habit starts enabled and drawn a little thicker.
 *
 * Everything is derived on the client from the already-loaded habit list (start
 * date + stored ticks), so there's no extra query — it reuses the day-7 logic in
 * src/lib/lifeHabits, exactly like the grid and the bar.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { addDaysISO, dateRange, consistencyScoreSeries } from '@/lib/lifeHabits'
import { LEVELS, CAP } from '@/lib/habitLevels'

interface HabitItem {
  id: string
  name: string
  startDate: string
  cadenceDays?: number
  autoSince?: string | null
  days: { date: string; done: boolean }[]
}

/** Per-habit line colours — a red-free spread so lines stay distinct and legible
 *  under a red-green colour weakness (assigned by row order, stable per habit). */
const PALETTE = [
  'var(--color-emerald)',
  'var(--color-blue)',
  'var(--color-violet)',
  'var(--color-amber)',
  'var(--color-pink)',
  'var(--color-purple)',
  'var(--color-lime)',
  'var(--color-amber-light)',
]

type RangePreset = 30 | 90 | 'all'

/** "Jun 3" from "YYYY-MM-DD". */
function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface Props {
  habits: HabitItem[]
  focusedId: string
  today: string
  onClose: () => void
}

export function LifeHabitScoreChart({ habits, focusedId, today, onClose }: Props) {
  const [preset, setPreset] = useState<RangePreset>(30)
  // The clicked habit is on by default; others are toggled in by the user.
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set([focusedId]))
  // The combined-average line = the daily mean of whichever habits are enabled.
  //   'off'  → just the individual habit lines
  //   'with' → individual lines + the average overlaid
  //   'only' → ONLY the average (individual lines hidden) — a clean single trend
  const [avgMode, setAvgMode] = useState<'off' | 'with' | 'only'>('off')

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const colorOf = (id: string) =>
    PALETTE[Math.max(0, habits.findIndex((h) => h.id === id)) % PALETTE.length]

  // Window start: a fixed look-back, or the earliest habit start for "All".
  const fromDate = useMemo(() => {
    if (preset === 'all') {
      const starts = habits.map((h) => h.startDate)
      return starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : today
    }
    return addDaysISO(today, -(preset - 1))
  }, [preset, habits, today])

  // Merge every enabled habit's daily score into rows keyed by date, so recharts
  // can draw one <Line> per habit. A habit that didn't exist yet on a given day
  // just has no key for that row → its line starts partway across (no fake zero).
  const data = useMemo(() => {
    const axis = dateRange(fromDate, today)
    const byDate = new Map<string, Record<string, number | string>>(
      axis.map((d) => [d, { date: d }]),
    )
    for (const h of habits) {
      if (!enabled.has(h.id)) continue
      const explicit = new Map(h.days.map((d) => [d.date, d.done]))
      for (const pt of consistencyScoreSeries(h.startDate, explicit, fromDate, today, h.autoSince, h.cadenceDays)) {
        const row = byDate.get(pt.date)
        if (row) row[h.id] = pt.score
      }
    }
    // Combined average: the mean of the enabled habits that have a score on each
    // day (a habit not yet started that day simply doesn't count toward it).
    const enabledIds = habits.filter((h) => enabled.has(h.id)).map((h) => h.id)
    for (const row of byDate.values()) {
      const vals = enabledIds
        .map((id) => row[id])
        .filter((v): v is number => typeof v === 'number')
      if (vals.length) row.__avg = vals.reduce((a, b) => a + b, 0) / vals.length
    }
    return Array.from(byDate.values())
  }, [habits, enabled, fromDate, today])

  function toggle(id: string) {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // One-click show/hide of every habit at once (so you don't toggle them one by
  // one). If all are already on it clears the chart; otherwise it turns them all on.
  const allOn = habits.length > 0 && habits.every((h) => enabled.has(h.id))
  function toggleAll() {
    setEnabled(allOn ? new Set() : new Set(habits.map((h) => h.id)))
  }

  const focused = habits.find((h) => h.id === focusedId)

  // The tier bands behind the lines: each level's [floor, ceil) painted in its
  // own colour, so the climb reads as zones (matches the ladder). The summit tiers
  // (Legend, Mythical) get a stronger wash so the top bands stand out.
  const bands = LEVELS.map((l, i) => ({
    y1: l.floor,
    y2: i < LEVELS.length - 1 ? LEVELS[i + 1].floor : CAP,
    color: l.color,
    name: l.name,
    summit: Boolean(l.isLegend || l.isMythical),
  }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-3xl rounded-xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Consistency over time</h2>
            <p className="mt-0.5 text-xs text-muted">
              {focused ? focused.name : 'Habit'} · toggle others below to compare
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-muted hover:border-emerald hover:text-ink"
            aria-label="Close chart"
          >
            ✕
          </button>
        </div>

        {/* Range presets + the combined-average toggle */}
        <div className="mb-3 flex items-center gap-2 text-xs">
          <div className="inline-flex rounded-lg bg-base p-0.5">
            {([30, 90, 'all'] as RangePreset[]).map((p) => (
              <button
                key={String(p)}
                type="button"
                onClick={() => setPreset(p)}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  preset === p ? 'bg-surface text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {p === 'all' ? 'All' : `${p}d`}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAvgMode((m) => (m === 'with' ? 'off' : 'with'))}
            className={`rounded-lg border px-2.5 py-1 transition-colors ${
              avgMode === 'with' ? 'border-line-strong text-ink' : 'border-line text-faint hover:text-ink'
            }`}
            style={avgMode === 'with' ? { boxShadow: 'inset 0 -2px 0 var(--color-ink)' } : undefined}
            title="Overlay the average of the enabled habits on top of their lines"
          >
            Average
          </button>
          <button
            type="button"
            onClick={() => setAvgMode((m) => (m === 'only' ? 'off' : 'only'))}
            className={`rounded-lg border px-2.5 py-1 transition-colors ${
              avgMode === 'only' ? 'border-line-strong text-ink' : 'border-line text-faint hover:text-ink'
            }`}
            style={avgMode === 'only' ? { boxShadow: 'inset 0 -2px 0 var(--color-ink)' } : undefined}
            title="Show ONLY the average line of the enabled habits (hide the individual lines)"
          >
            Avg only
          </button>
          <button
            type="button"
            onClick={toggleAll}
            className={`rounded-lg border px-2.5 py-1 transition-colors ${
              allOn ? 'border-line-strong text-ink' : 'border-line text-faint hover:text-ink'
            }`}
            title={allOn ? 'Hide all habits from the chart' : 'Show every habit on the chart at once'}
          >
            {allOn ? 'Hide all' : 'Show all'}
          </button>
        </div>

        {/* Chart */}
        <div className="h-72 w-full">
          {data.length === 0 ? (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-xs italic text-faint">No data in this range yet.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
                {/* Tier bands behind everything — the level zones, each in its
                    own colour. Real 0–100 score axis is kept (curve shape stays);
                    the bands just colour-code the climb. Summit tiers wash stronger. */}
                {bands.map((b) => (
                  <ReferenceArea
                    key={`band-${b.y1}`}
                    y1={b.y1}
                    y2={b.y2}
                    fill={b.color}
                    fillOpacity={b.summit ? 0.16 : 0.06}
                    stroke="none"
                    ifOverflow="extendDomain"
                  />
                ))}
                {/* Dashed divider at each level floor (skip 0), in that level's
                    colour, labelled with the level name. */}
                {LEVELS.filter((l) => l.floor > 0).map((l) => (
                  <ReferenceLine
                    key={`line-${l.floor}`}
                    y={l.floor}
                    stroke={l.color}
                    strokeOpacity={0.7}
                    strokeWidth={1}
                    strokeDasharray="5 4"
                    label={{
                      value: l.name,
                      position: 'insideTopRight',
                      fill: l.color,
                      fontSize: 9,
                    }}
                  />
                ))}
                <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--color-muted)" fontSize={10} minTickGap={24} />
                <YAxis domain={[0, 100]} stroke="var(--color-muted)" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-base)',
                    border: '1px solid var(--color-line)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(l) => shortDate(String(l))}
                  formatter={(value) => `${Number(value).toFixed(2)}%`}
                />
                {avgMode !== 'only' &&
                  habits
                    .filter((h) => enabled.has(h.id))
                    .map((h) => (
                      <Line
                        key={h.id}
                        type="monotone"
                        dataKey={h.id}
                        name={h.name}
                        stroke={colorOf(h.id)}
                        strokeWidth={h.id === focusedId ? 3 : 1.5}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                {avgMode !== 'off' && (
                  <Line
                    key="__avg"
                    type="monotone"
                    dataKey="__avg"
                    name="Average"
                    stroke="var(--color-ink)"
                    strokeWidth={3}
                    strokeDasharray="5 3"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Habit toggles */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {habits.map((h) => {
            const on = enabled.has(h.id)
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => toggle(h.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  on ? 'border-line-strong text-ink' : 'border-line text-faint'
                }`}
                style={on ? { boxShadow: `inset 0 -2px 0 ${colorOf(h.id)}` } : undefined}
                title={on ? 'Hide from chart' : 'Show on chart'}
              >
                {h.name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

'use client'

/**
 * MeditationPanel — the meditation logger + chart shown inside a habit's detail
 * popup (HabitDetailModal) when the habit is duration-tracked (the "Meditation"
 * row, see src/lib/meditation.ts).
 *
 * Top: a quick form to log a sitting — date (defaults to today, backdatable),
 * start time, and duration in minutes. Below: an interactive chart of minutes
 * meditated per bucket.
 *
 * The chart:
 *   • Bar or line — toggle.
 *   • Time scope (x) — drag the bottom/x-axis strip to widen or narrow the window.
 *     The bucket granularity is derived from the width, so zooming wide enough
 *     auto-switches Day → Week → Month. The Day/Week/Month buttons are presets.
 *   • Value scope (y) — drag the left/y-axis strip to zoom the value scale.
 *   • All three persist per-habit to AppSetting (key "meditationChart:<id>"), so
 *     reopening the popup restores exactly how you left it.
 *
 * All data flows through the `meditation` / `settings` tRPC routers (Prisma +
 * Event log).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { trpc } from '@/lib/trpc/client'
import { todayISO } from '@/lib/lifeHabits'
import {
  aggregate,
  summarize,
  formatMinutes,
  formatSpan,
  bucketForSpan,
  bucketOf,
  clamp,
  addDaysISO,
  BUCKET_LABEL,
  SPAN_PRESET,
  MIN_SPAN,
  MAX_SPAN,
  OFFSET_MIN,
  OFFSET_MAX,
  type MeditationBucket,
} from '@/lib/meditation'

/** "Jun 3" / "Jun" label for a bucket's start date, per granularity. */
function bucketLabel(dateStr: string, bucket: MeditationBucket): string {
  const d = new Date(`${dateStr}T00:00:00`)
  if (bucket === 'month') return d.toLocaleDateString(undefined, { month: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "Thu, 4 Jun" for the session list. */
function listDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Persisted chart preferences. */
interface ChartPrefs {
  spanDays: number
  offsetDays: number
  yMax: number | null
  type: 'bar' | 'line'
}

interface Props {
  habitId: string
}

export function MeditationPanel({ habitId }: Props) {
  const today = todayISO()
  const utils = trpc.useUtils()
  const listQuery = trpc.meditation.list.useQuery({ habitId })
  const sessions = useMemo(() => listQuery.data ?? [], [listQuery.data])

  // ── Chart view state (persisted) ──────────────────────────────────────────
  const PREFS_KEY = `meditationChart:${habitId}`
  const [spanDays, setSpanDays] = useState(SPAN_PRESET.day)
  const [offsetDays, setOffsetDays] = useState(0) // window end relative to today
  const [yMax, setYMax] = useState<number | null>(null)
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar')
  const [hydrated, setHydrated] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)

  const prefsQuery = trpc.settings.get.useQuery(
    { key: PREFS_KEY },
    { staleTime: Infinity, retry: false },
  )
  const setSetting = trpc.settings.set.useMutation()

  // Restore saved prefs once.
  useEffect(() => {
    if (hydrated || prefsQuery.isLoading) return
    if (prefsQuery.data) {
      try {
        const p = JSON.parse(prefsQuery.data) as Partial<ChartPrefs>
        if (typeof p.spanDays === 'number') setSpanDays(clamp(p.spanDays, MIN_SPAN, MAX_SPAN))
        if (typeof p.offsetDays === 'number') setOffsetDays(clamp(p.offsetDays, OFFSET_MIN, OFFSET_MAX))
        if (typeof p.yMax === 'number' || p.yMax === null) setYMax(p.yMax ?? null)
        if (p.type === 'bar' || p.type === 'line') setChartType(p.type)
      } catch {
        /* ignore malformed prefs */
      }
    }
    setHydrated(true)
  }, [hydrated, prefsQuery.isLoading, prefsQuery.data])

  // Persist a patch over the current prefs (and keep the query cache in sync so a
  // remount on reopen reads the new value, not the stale one).
  function persist(patch: Partial<ChartPrefs>) {
    const next: ChartPrefs = { spanDays, offsetDays, yMax, type: chartType, ...patch }
    const json = JSON.stringify(next)
    setSetting.mutate({ key: PREFS_KEY, value: json })
    utils.settings.get.setData({ key: PREFS_KEY }, json)
  }

  // ── Logger form state ───────────────────────────────────────────────────────
  const [date, setDate] = useState(today)
  const [startTime, setStartTime] = useState('07:00')
  const [duration, setDuration] = useState('20')

  const add = trpc.meditation.add.useMutation({
    onSuccess: () => {
      setDuration('20')
      void utils.meditation.list.invalidate({ habitId })
    },
  })
  const remove = trpc.meditation.remove.useMutation({
    onSuccess: () => void utils.meditation.list.invalidate({ habitId }),
  })

  // ── Derived chart data ──────────────────────────────────────────────────────
  // The visible window ends at `toDate` (today shifted by the pan offset) and is
  // `spanDays` wide. Buckets past today are seeded empty; their plotted value is
  // null so the line/bars stop at the current date and only whitespace follows.
  const bucket = bucketForSpan(spanDays)
  const toDate = addDaysISO(today, offsetDays)
  const fromDate = addDaysISO(toDate, -(spanDays - 1))
  const todayBucket = bucketOf(today, bucket)
  const bars = useMemo(
    () =>
      aggregate(
        sessions.map((s) => ({ date: s.date, durationMin: s.durationMin })),
        bucket,
        fromDate,
        toDate,
        today,
      ),
    [sessions, bucket, fromDate, toDate, today],
  )
  const stats = useMemo(() => summarize(bars), [bars])
  const chartData = useMemo(
    () =>
      bars.map((b) => ({
        ...b,
        label: bucketLabel(b.bucket, bucket),
        // Null past today so the series ends at the current date (no future line).
        value: b.bucket > todayBucket ? null : b.totalMin,
      })),
    [bars, bucket, todayBucket],
  )
  const dataMax = useMemo(
    () => Math.max(5, ...bars.filter((b) => b.bucket <= todayBucket).map((b) => b.totalMin)),
    [bars, todayBucket],
  )

  function logSession() {
    const min = Number(duration)
    if (!Number.isFinite(min) || min < 1) return
    add.mutate({ habitId, date, startTime, durationMin: Math.round(min) })
  }

  // ── Drag-to-zoom (x = time scope, y = value scope) ──────────────────────────
  // Exponential zoom so a single drag spans days→years; commit to AppSetting on
  // release. Live values are mirrored in refs so the pointerup commit is exact.
  const xDrag = useRef<{ x: number; start: number } | null>(null)
  const liveSpan = useRef(spanDays)
  const yDrag = useRef<{ y: number; start: number } | null>(null)
  const liveYMax = useRef<number | null>(yMax)

  function onXDown(e: ReactPointerEvent) {
    xDrag.current = { x: e.clientX, start: spanDays }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onXMove(e: ReactPointerEvent) {
    if (!xDrag.current) return
    const dx = e.clientX - xDrag.current.x
    // Drag right → zoom in (narrower window); drag left → zoom out (wider).
    const next = clamp(Math.round(xDrag.current.start * Math.pow(2, -dx / 250)), MIN_SPAN, MAX_SPAN)
    liveSpan.current = next
    setSpanDays(next)
  }
  function onXUp(e: ReactPointerEvent) {
    if (!xDrag.current) return
    xDrag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    persist({ spanDays: liveSpan.current })
  }

  function onYDown(e: ReactPointerEvent) {
    yDrag.current = { y: e.clientY, start: yMax ?? dataMax }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onYMove(e: ReactPointerEvent) {
    if (!yDrag.current) return
    const dy = e.clientY - yDrag.current.y
    // Drag down → zoom out (taller scale); drag up → zoom in (shorter scale).
    const next = clamp(Math.round(yDrag.current.start * Math.pow(2, dy / 250)), 5, 100000)
    liveYMax.current = next
    setYMax(next)
  }
  function onYUp(e: ReactPointerEvent) {
    if (!yDrag.current) return
    yDrag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    persist({ yMax: liveYMax.current })
  }

  // Pan the time window by dragging the chart body (TradingView-style). Pixels
  // map to days via the current span and the plot's pixel width.
  const panDrag = useRef<{ x: number; start: number; daysPerPx: number } | null>(null)
  const liveOffset = useRef(offsetDays)
  function onPanDown(e: ReactPointerEvent) {
    const plotPx = Math.max(50, (chartRef.current?.clientWidth ?? 320) - 44) // minus L margin + R axis
    panDrag.current = { x: e.clientX, start: offsetDays, daysPerPx: spanDays / plotPx }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPanMove(e: ReactPointerEvent) {
    if (!panDrag.current) return
    const dx = e.clientX - panDrag.current.x
    // Drag right → reveal earlier dates (offset decreases); drag left → later.
    const next = clamp(
      Math.round(panDrag.current.start - dx * panDrag.current.daysPerPx),
      OFFSET_MIN,
      OFFSET_MAX,
    )
    liveOffset.current = next
    setOffsetDays(next)
  }
  function onPanUp(e: ReactPointerEvent) {
    if (!panDrag.current) return
    panDrag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    persist({ offsetDays: liveOffset.current })
  }

  function applyPreset(b: MeditationBucket) {
    const s = SPAN_PRESET[b]
    setSpanDays(s)
    liveSpan.current = s
    persist({ spanDays: s })
  }
  function applyType(t: 'bar' | 'line') {
    setChartType(t)
    persist({ type: t })
  }
  function resetScope() {
    setSpanDays(SPAN_PRESET.day)
    setOffsetDays(0)
    setYMax(null)
    liveSpan.current = SPAN_PRESET.day
    liveOffset.current = 0
    liveYMax.current = null
    persist({ spanDays: SPAN_PRESET.day, offsetDays: 0, yMax: null })
  }

  const yDomain: [number, number | 'auto'] = [0, yMax ?? 'auto']
  const zoomed = yMax != null || spanDays !== SPAN_PRESET.day || offsetDays !== 0

  return (
    <div className="flex flex-col gap-4">
      {/* ── Logger form ──────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-line bg-base p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
          Log a sitting
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Date
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-emerald focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Start time
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-emerald focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Duration (min)
            <input
              type="number"
              min={1}
              max={1440}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') logSession() }}
              className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-emerald focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={logSession}
            disabled={add.isPending || !duration}
            className="rounded-lg bg-emerald px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Log
          </button>
        </div>
      </div>

      {/* ── Controls: presets · bar/line · reset · summary ───────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Day/Week/Month presets — active = the granularity the span resolves to. */}
          <div className="inline-flex rounded-lg bg-base p-0.5 text-xs">
            {(Object.keys(SPAN_PRESET) as MeditationBucket[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => applyPreset(b)}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  bucket === b ? 'bg-surface text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {BUCKET_LABEL[b]}
              </button>
            ))}
          </div>
          {/* Bar / line toggle */}
          <div className="inline-flex rounded-lg bg-base p-0.5 text-xs">
            {(['bar', 'line'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => applyType(t)}
                className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
                  chartType === t ? 'bg-surface text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="text-[11px] tabular-nums text-faint">{formatSpan(spanDays, bucket)}</span>
          {zoomed && (
            <button
              type="button"
              onClick={resetScope}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:border-emerald hover:text-ink"
              title="Reset zoom"
            >
              Reset
            </button>
          )}
        </div>
        <div className="flex gap-4 text-xs">
          <span className="text-muted">
            Total <span className="font-semibold text-ink">{formatMinutes(stats.totalMin)}</span>
          </span>
          <span className="text-muted">
            Avg session <span className="font-semibold text-ink">{stats.avgPerSession}m</span>
          </span>
        </div>
      </div>

      {/* ── Chart — drag the body to pan time, the edge strips to zoom ────── */}
      <div
        ref={chartRef}
        className="relative h-56 w-full select-none [&_*]:outline-none [&_svg]:outline-none"
      >
        {sessions.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-xs italic text-faint">No sittings logged yet.</span>
          </div>
        ) : (
          <>
            {/* Pan layer — grab the chart and drag left/right through dates. */}
            <div
              onPointerDown={onPanDown}
              onPointerMove={onPanMove}
              onPointerUp={onPanUp}
              className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
            >
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'bar' ? (
                <BarChart data={chartData} margin={{ top: 8, right: 0, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="var(--color-muted)" fontSize={10} minTickGap={16} />
                  <YAxis
                    orientation="right"
                    domain={yDomain}
                    allowDataOverflow={yMax != null}
                    stroke="var(--color-muted)"
                    fontSize={10}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--color-line)', opacity: 0.3 }}
                    contentStyle={{
                      background: 'var(--color-base)',
                      border: '1px solid var(--color-line)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value, _n, item) => {
                      const min = Number(value)
                      const n = Number(item?.payload?.sessions ?? 0)
                      return [`${formatMinutes(min)} · ${n} sitting${n === 1 ? '' : 's'}`, 'Meditated']
                    }}
                  />
                  <Bar dataKey="value" fill="var(--color-violet)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 8, right: 0, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="var(--color-muted)" fontSize={10} minTickGap={16} />
                  <YAxis
                    orientation="right"
                    domain={yDomain}
                    allowDataOverflow={yMax != null}
                    stroke="var(--color-muted)"
                    fontSize={10}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-base)',
                      border: '1px solid var(--color-line)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value, _n, item) => {
                      const min = Number(value)
                      const n = Number(item?.payload?.sessions ?? 0)
                      return [`${formatMinutes(min)} · ${n} sitting${n === 1 ? '' : 's'}`, 'Meditated']
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--color-violet)"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
            </div>

            {/* Y-axis drag strip (right side) — zoom the value scale. Sits over the
                right axis gutter, above the x-axis row. */}
            <div
              onPointerDown={onYDown}
              onPointerMove={onYMove}
              onPointerUp={onYUp}
              title="Drag up/down to zoom the value scale"
              className="absolute bottom-[30px] right-0 top-0 z-10 w-9 cursor-ns-resize touch-none"
            />
            {/* X-axis drag strip — widen/narrow the time window (auto-switches
                bucket). Aligned to the ~30px the XAxis reserves at the bottom and
                the plot's left margin / right axis gutter. */}
            <div
              onPointerDown={onXDown}
              onPointerMove={onXMove}
              onPointerUp={onXUp}
              title="Drag left/right to widen or narrow the time range"
              className="absolute bottom-0 left-2 right-9 z-10 h-[30px] cursor-ew-resize touch-none"
            />
          </>
        )}
      </div>

      {/* ── Recent sittings ──────────────────────────────────────────────── */}
      {sessions.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">Recent</div>
          <div className="max-h-40 overflow-y-auto pr-1">
            {sessions.slice(0, 50).map((s) => (
              <div
                key={s.id}
                className="group flex items-center justify-between border-b border-line/40 py-1.5 text-xs"
              >
                <span className="text-ink">{listDate(s.date)}</span>
                <span className="text-muted">{s.startTime}</span>
                <span className="font-medium text-ink">{formatMinutes(s.durationMin)}</span>
                <button
                  type="button"
                  onClick={() => remove.mutate({ id: s.id })}
                  className="text-faint opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                  aria-label="Delete sitting"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * LifeHabitTracker — "Habits that definitely improve my life".
 *
 * One row per habit; one box per calendar day, laid left→right on a horizontal
 * timeline you scroll through. The day-7 rule (src/lib/lifeHabits.ts): days 1–7
 * of a habit are ticked manually; from day 8 the box auto-fills and you only
 * un-tick a missed day. Only explicit clicks are stored (lifeHabit.setDay) —
 * everything else is derived, so nothing has to be back-filled overnight.
 *
 * The top bar shows today's date + a "Today" jump and arrow controls; drag the
 * date strip to scan a month ahead; the habit names stay pinned on the left
 * while the days scroll. Reorder habits by dragging a habit by its name. The box
 * itself is auto-height (BoxBoard), so it grows as habits are added. All data
 * flows through the `lifeHabit` tRPC router (Prisma + Event log).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  DndContext,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { trpc } from '@/lib/trpc/client'
import {
  todayISO,
  addDaysISO,
  dateRange,
  cellDone,
  defaultDone,
  isActiveDay,
  scoreStart,
  periodStart,
  periodEnd,
  consistencyScore,
  consistencyScoreSeries,
} from '@/lib/lifeHabits'
import { levelFor, LEVELS, summitStyle, type SummitStyle } from '@/lib/habitLevels'
import { useUiStore } from '@/stores/uiStore'
import { habitDocUrl } from '@/lib/habitDocs'
import { isMeditationHabit } from '@/lib/meditation'
import { LifeHabitScoreChart } from './LifeHabitScoreChart'
import { HabitDetailModal } from './HabitDetailModal'

/** Minimum number of day-columns to render, so the timeline reads as a grid
 *  even on a brand-new habit (extra columns are pre-start, shown as faint dots). */
const MIN_COLUMNS = 14
/** How far ahead the timeline can be scrolled/dragged — visible but locked. */
const FUTURE_DAYS = 30

/** Tailwind widths for the pinned name column, consistency column, and day box.
 *  The consistency column widens when the momentum sparkline is shown (see
 *  scoreWidth) so the dial/pips + name + sparkline never crowd. */
const NAME_W = 'w-44'
const DAY_W = 'w-11'
/**
 * Exact pixel width for the consistency column — measured, not fixed, so the
 * column is only as wide as its widest cell actually needs (no trailing gap).
 * Every cell (header + all rows) gets this one value, so the column stays aligned.
 *
 * The width = horizontal padding + the level visual (dial or the 7 pips) + the
 * gap(s) + the widest text line across all rows (the longer of each row's level
 * name and its raw-% number, measured with the real font) + the sparkline if on.
 */
let measureCanvas: HTMLCanvasElement | null = null
const SCORE_FONT = '600 11px Geist, system-ui, -apple-system, sans-serif'

function consistencyColumnWidth(
  habits: HabitItem[],
  today: string,
  style: 'dial' | 'pips',
  sparkline: boolean,
): number {
  const visual = style === 'pips' ? 60 : 34 // 7 pips (6px + 3px gap) vs the 34px dial
  const padX = 10 + 6 // pl-2.5 + pr-1.5
  const gaps = sparkline ? 20 : 10 // gap-2.5 between visual·text (·sparkline)
  const spark = sparkline ? 46 : 0
  const fixed = padX + visual + gaps + spark

  // Server / no-canvas fallback: reserve for the longest level name ("Consistent").
  if (typeof document === 'undefined') return fixed + 64

  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return fixed + 64
  ctx.font = SCORE_FONT

  const textOf = (h: HabitItem): number => {
    const explicit = new Map(h.days.map((d) => [d.date, d.done]))
    const score = consistencyScore(h.startDate, explicit, today, h.autoSince, h.cadenceDays)
    const lvl = levelFor(score)
    const sm = summitStyle(lvl)
    const nameW = ctx.measureText(lvl.name + (sm ? ` ${sm.star}` : '')).width
    const numW = ctx.measureText(score.toFixed(2)).width + 9 // trailing " %" (smaller)
    return Math.max(nameW, numW)
  }

  const maxText = habits.length
    ? Math.max(...habits.map(textOf))
    : ctx.measureText('Consistent').width
  return Math.ceil(fixed + maxText + 4) // small buffer for web-font metric drift
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  return { y, m, d, wd }
}

/** Compact label for an interval period's date range, e.g. "1–3 Jun" within one
 *  month, or "30 May–1 Jun" across a boundary. Single day → just "4 Jun". */
function periodRangeLabel(startISO: string, endISO: string): string {
  const a = parts(startISO)
  const b = parts(endISO)
  if (startISO === endISO) return `${a.d} ${MONTH[a.m - 1]}`
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTH[a.m - 1]}`
  return `${a.d} ${MONTH[a.m - 1]}–${b.d} ${MONTH[b.m - 1]}`
}

/** "Thursday, 4 Jun 2026" — the prominent today label. */
function longToday(iso: string): string {
  const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const { y, m, d, wd } = parts(iso)
  return `${FULL[wd]}, ${d} ${MONTH[m - 1]} ${y}`
}

/** Minimal shape a row needs (the query returns more fields; extras are ignored). */
interface HabitItem {
  id: string
  name: string
  startDate: string
  cadenceDays: number // 1 = daily grid; >1 = interval habit (one box per N-day period)
  autoSince: string | null // set → bottom "Established" (auto-tick) section
  peakScore: number // highest consistency score ever reached (the "best ever" badge)
  days: { date: string; done: boolean }[]
}

/** Droppable-zone ids for the three sections (so you can drop into an empty one). */
const ZONE_BUILDING = 'zone:building'
const ZONE_AUTO = 'zone:auto'
const ZONE_ARCHIVE = 'zone:archive'
const ZONE_IDS = new Set([ZONE_BUILDING, ZONE_AUTO, ZONE_ARCHIVE])

/**
 * Collision detection for the section list: prefer the habit row under the
 * pointer, and only fall back to a section zone when the pointer is over empty
 * space inside it (so dropping into an empty section still works). Without this,
 * the big section <div> can out-rank a row mid-list and break within-section
 * reordering.
 */
const sectionCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const resolved = hits.length ? hits : rectIntersection(args)
  const rowHit = resolved.find((h) => !ZONE_IDS.has(String(h.id)))
  return rowHit ? [rowHit] : resolved
}

/** A section's drop area — highlights while a habit is dragged over it. */
function DropZone({
  id,
  className = '',
  children,
}: {
  id: string
  className?: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${isOver ? 'ring-1 ring-inset ring-emerald/40' : ''}`}
    >
      {children}
    </div>
  )
}

export function LifeHabitTracker() {
  const today = todayISO()
  const scrollRef = useRef<HTMLDivElement>(null)
  const todayCellRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; left: number } | null>(null)
  const seedTried = useRef(false)
  const [adding, setAdding] = useState('')
  // Cadence for the habit being added: 1 = daily; >1 = an interval habit due once
  // every N days. Empty string while the user is mid-typing the number.
  const [addCadence, setAddCadence] = useState('1')
  // Start date for the habit being added (first active day/period). Defaults to
  // today; surfaced as a picker for interval habits so you can choose which
  // period is the first one or backfill from an earlier date.
  const [addStart, setAddStart] = useState(today)
  // Which habit's consistency chart is open (null = closed). Set by clicking a
  // row's consistency bar.
  const [chartFor, setChartFor] = useState<string | null>(null)
  // Which habit's detail popup is open (null = closed). Set by clicking a name.
  const [detailFor, setDetailFor] = useState<string | null>(null)

  // Consistency-column view prefs (persisted in uiStore): dial vs pips, and
  // whether to show the momentum sparkline alongside.
  const consistencyStyle = useUiStore((s) => s.habitConsistencyStyle)
  const sparkline = useUiStore((s) => s.habitSparkline)
  const setConsistencyStyle = useUiStore((s) => s.setHabitConsistencyStyle)
  const toggleSparkline = useUiStore((s) => s.toggleHabitSparkline)

  // Whether the collapsible "Archived" section is expanded. Default collapsed.
  const [archiveOpen, setArchiveOpen] = useState(false)

  const utils = trpc.useUtils()
  const listQuery = trpc.lifeHabit.list.useQuery()
  const habits = useMemo(() => listQuery.data ?? [], [listQuery.data])
  const archivedQuery = trpc.lifeHabit.listArchived.useQuery()
  const archivedHabits = useMemo(() => archivedQuery.data ?? [], [archivedQuery.data])

  // Exact consistency-column width, measured from the widest cell so the column
  // is only as wide as it needs to be (see consistencyColumnWidth).
  const scoreW = useMemo(
    () => consistencyColumnWidth(habits, today, consistencyStyle, sparkline),
    [habits, today, consistencyStyle, sparkline],
  )

  // Seed the eight starter habits the first time the tracker is opened while
  // empty. The server is also flag-guarded, so this never double-seeds.
  const seed = trpc.lifeHabit.seedStarter.useMutation({
    onSettled: () => void utils.lifeHabit.list.invalidate(),
  })
  useEffect(() => {
    if (seedTried.current) return
    if (listQuery.isSuccess && habits.length === 0) {
      seedTried.current = true
      seed.mutate({ startDate: today })
    }
  }, [listQuery.isSuccess, habits.length, seed, today])

  const setDay = trpc.lifeHabit.setDay.useMutation({
    onMutate: async (vars) => {
      await utils.lifeHabit.list.cancel()
      const prev = utils.lifeHabit.list.getData()
      utils.lifeHabit.list.setData(undefined, (old) =>
        old?.map((h) => {
          if (h.id !== vars.habitId) return h
          const days = h.days.some((d) => d.date === vars.date)
            ? h.days.map((d) => (d.date === vars.date ? { ...d, done: vars.done } : d))
            : [...h.days, { date: vars.date, done: vars.done }]
          return { ...h, days }
        }),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) utils.lifeHabit.list.setData(undefined, ctx.prev) },
    onSettled: () => void utils.lifeHabit.list.invalidate(),
  })
  const create = trpc.lifeHabit.create.useMutation({
    onSuccess: () => { setAdding(''); setAddCadence('1'); setAddStart(today); void utils.lifeHabit.list.invalidate() },
  })
  const rename = trpc.lifeHabit.rename.useMutation({
    onSettled: () => void utils.lifeHabit.list.invalidate(),
  })
  const remove = trpc.lifeHabit.remove.useMutation({
    onSettled: () => void utils.lifeHabit.list.invalidate(),
  })
  // Archive (soft-delete) or restore a habit. Both lists change, so invalidate
  // both queries.
  const setArchived = trpc.lifeHabit.setArchived.useMutation({
    onSuccess: () => {
      void utils.lifeHabit.list.invalidate()
      void utils.lifeHabit.listArchived.invalidate()
    },
  })
  // Permanently delete an archived habit (guarded by a confirm at the call site).
  const destroy = trpc.lifeHabit.destroy.useMutation({
    onSuccess: () => {
      void utils.lifeHabit.list.invalidate()
      void utils.lifeHabit.listArchived.invalidate()
    },
  })
  const reorder = trpc.lifeHabit.reorder.useMutation({
    onSettled: () => void utils.lifeHabit.list.invalidate(),
  })
  const moveToSection = trpc.lifeHabit.moveToSection.useMutation({
    onSettled: () => void utils.lifeHabit.list.invalidate(),
  })

  // The two sections: top = still "Building" (manual / 7-day rule); bottom =
  // "Established" (autoSince set → auto-ticks daily, untick a miss). Row order
  // within each is the global `position`, which `list` already sorts by.
  const building = useMemo(() => habits.filter((h) => !h.autoSince), [habits])
  const established = useMemo(() => habits.filter((h) => h.autoSince), [habits])

  // Drag a habit (by its name) up/down to reorder, OR across the divider into the
  // other section. 4px activation so a plain click / double-click to rename never
  // starts a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // Re-sort the cache by a new id order so a dragged row doesn't snap back before
  // the server round-trip lands.
  function optimisticOrder(combined: string[], movedId?: string, toAuto?: boolean) {
    utils.lifeHabit.list.setData(undefined, (old) =>
      old
        ? [...old]
            .map((h) =>
              movedId && h.id === movedId
                ? { ...h, autoSince: toAuto ? today : null }
                : h,
            )
            .sort((a, b) => combined.indexOf(a.id) - combined.indexOf(b.id))
        : old,
    )
  }

  // Which section does an overId point at? Archive zone or an archived row →
  // 'archive'; auto zone or an established row → 'auto'; building zone or a
  // building row → 'building'. null if it resolves to nothing droppable.
  function sectionOf(overId: string): 'building' | 'auto' | 'archive' | null {
    if (overId === ZONE_ARCHIVE) return 'archive'
    if (overId === ZONE_AUTO) return 'auto'
    if (overId === ZONE_BUILDING) return 'building'
    if (archivedHabits.some((h) => h.id === overId)) return 'archive'
    const overHabit = habits.find((h) => h.id === overId)
    if (!overHabit) return null
    return overHabit.autoSince ? 'auto' : 'building'
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const dest = sectionOf(overId)
    if (!dest) return

    const archivedActive = archivedHabits.find((h) => h.id === activeId)

    // ── Dragging an ARCHIVED habit ──
    if (archivedActive) {
      // Dropped back inside Archive (zone or another archived row) → no-op.
      if (dest === 'archive') return
      // Restore it, then place it into Building/Established at the drop point.
      const toAuto = dest === 'auto'
      setArchived.mutate({ id: activeId, archived: false })
      const dstBase = (toAuto ? established : building).map((h) => h.id)
      let insertAt = dstBase.length
      if (!ZONE_IDS.has(overId)) {
        const idx = dstBase.indexOf(overId)
        if (idx >= 0) insertAt = idx
      }
      const dstList = [...dstBase.slice(0, insertAt), activeId, ...dstBase.slice(insertAt)]
      const otherIds = (toAuto ? building : established).map((h) => h.id)
      const combined = toAuto ? [...otherIds, ...dstList] : [...dstList, ...otherIds]
      moveToSection.mutate({ id: activeId, auto: toAuto, since: today, orderedIds: combined })
      return
    }

    const activeHabit = habits.find((h) => h.id === activeId)
    if (!activeHabit) return
    const fromAuto = Boolean(activeHabit.autoSince)

    // ── Dropping an ACTIVE habit into Archive → soft-delete it ──
    if (dest === 'archive') {
      setArchived.mutate({ id: activeId, archived: true })
      return
    }

    // Which active section did it land in (building vs established)?
    const toAuto = dest === 'auto'

    const buildingIds = building.map((h) => h.id)
    const establishedIds = established.map((h) => h.id)

    if (fromAuto === toAuto) {
      // Reorder within one section.
      if (activeId === overId) return
      const list = toAuto ? establishedIds : buildingIds
      const oldI = list.indexOf(activeId)
      const newI = list.indexOf(overId)
      if (oldI < 0 || newI < 0) return
      const moved = arrayMove(list, oldI, newI)
      const combined = toAuto ? [...buildingIds, ...moved] : [...moved, ...establishedIds]
      optimisticOrder(combined)
      reorder.mutate({ orderedIds: combined })
      return
    }

    // Cross-section move: flip autoSince and reorder in one mutation.
    const srcList = (fromAuto ? establishedIds : buildingIds).filter((id) => id !== activeId)
    const dstBase = toAuto ? establishedIds : buildingIds
    let insertAt = dstBase.length
    if (overId !== ZONE_AUTO && overId !== ZONE_BUILDING) {
      const idx = dstBase.indexOf(overId)
      if (idx >= 0) insertAt = idx
    }
    const dstList = [...dstBase.slice(0, insertAt), activeId, ...dstBase.slice(insertAt)]
    const newBuilding = toAuto ? srcList : dstList
    const newEstablished = toAuto ? dstList : srcList
    const combined = [...newBuilding, ...newEstablished]
    optimisticOrder(combined, activeId, toAuto)
    moveToSection.mutate({ id: activeId, auto: toAuto, since: today, orderedIds: combined })
  }

  // The day axis: from the earliest habit start (or MIN_COLUMNS ago, whichever
  // is earlier) through one month into the future. Future days are visible but
  // locked; every day from a habit's start through today is tickable.
  const days = useMemo(() => {
    // Each habit effectively begins at the earlier of its startDate and its oldest
    // recorded mark (matches scoreStart), so back-dated ticks get their own columns.
    const starts = habits.map((h) =>
      h.days.reduce((min, d) => (d.date < min ? d.date : min), h.startDate),
    )
    const earliest = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : today
    const padded = addDaysISO(today, -(MIN_COLUMNS - 1))
    const left = earliest < padded ? earliest : padded
    return dateRange(left, addDaysISO(today, FUTURE_DAYS))
  }, [habits, today])

  // Today's tally for the bottom bar: how many active habits are ticked today
  // out of the total active today. Uses the same cellDone rule as the cells, so
  // a day-8+ habit counts as ticked unless it was explicitly un-ticked.
  const todayCount = useMemo(() => {
    let done = 0
    let total = 0
    for (const h of habits) {
      const cadence = h.cadenceDays ?? 1
      if (cadence > 1) {
        // Interval habit: count its CURRENT period (the box covering today). It's
        // "due now" once that period has reached the habit's first period, and
        // shows done for the whole period once ticked — so a weekly habit done on
        // Monday stays satisfied (not nagging) all week.
        const cps = periodStart(today, cadence)
        if (cps < periodStart(h.startDate, cadence)) continue
        total++
        const explicitPeriod = h.days.find((d) => d.date === cps)?.done
        if (cellDone(h.startDate, cps, explicitPeriod, h.autoSince, cadence)) done++
      } else {
        if (!isActiveDay(h.startDate, today)) continue
        total++
        const explicitToday = h.days.find((d) => d.date === today)?.done
        if (cellDone(h.startDate, today, explicitToday, h.autoSince)) done++
      }
    }
    return { done, total }
  }, [habits, today])

  // Bring "today" into view (centred, so upcoming days show to its right).
  // Runs once after first data.
  const scrolledOnce = useRef(false)
  useEffect(() => {
    if (scrolledOnce.current || !todayCellRef.current || habits.length === 0) return
    scrolledOnce.current = true
    todayCellRef.current.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [habits.length])

  function scrollToToday() {
    todayCellRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }
  function nudge(dir: -1 | 1) {
    scrollRef.current?.scrollBy({ left: dir * 44 * 7, behavior: 'smooth' })
  }

  // Drag the date header left/right to scan through the timeline (incl. the
  // month ahead). Pointer capture keeps the drag smooth past the cells.
  function onHeaderDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!scrollRef.current) return
    dragRef.current = { x: e.clientX, left: scrollRef.current.scrollLeft }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onHeaderMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !scrollRef.current) return
    scrollRef.current.scrollLeft = dragRef.current.left - (e.clientX - dragRef.current.x)
  }
  function onHeaderUp(e: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // The whole history is editable: any day from a habit's start through today is
  // tickable — only future days stay locked. A period is editable if it's the
  // current one or any earlier one back to the habit's first period (no future,
  // nothing before the habit existed). Daily habits are just cadence-1 periods.
  function isEditablePeriod(periodStartDate: string, cadence: number, effStart: string) {
    const cps = periodStart(today, cadence)
    const firstPS = periodStart(effStart, cadence)
    return periodStartDate >= firstPS && periodStartDate <= cps
  }
  function toggle(habitId: string, date: string, current: boolean) {
    const h = habits.find((hh) => hh.id === habitId)
    if (!h) return
    // Guard: never write the future or a day before the habit effectively began
    // (its startDate, or an even earlier back-dated mark); everything in between is
    // editable. Works for both daily and interval habits.
    const effStart = scoreStart(h.startDate, new Map(h.days.map((d) => [d.date, d.done])))
    if (!isEditablePeriod(date, h.cadenceDays ?? 1, effStart)) return
    setDay.mutate({ habitId, date, done: !current })
  }

  function addHabit() {
    const name = adding.trim()
    if (!name) return
    const cadence = Math.min(365, Math.max(1, Math.floor(Number(addCadence) || 1)))
    // Interval habits can start on a chosen date; daily habits start today.
    const startDate = cadence > 1 && addStart ? addStart : today
    create.mutate({ name, startDate, cadenceDays: cadence })
  }

  const renderRow = (h: HabitItem) => (
    <HabitRow
      key={h.id}
      habit={h}
      days={days}
      today={today}
      consistencyStyle={consistencyStyle}
      sparkline={sparkline}
      scoreW={scoreW}
      onToggle={toggle}
      onRename={(id, name) => rename.mutate({ id, name })}
      onRemove={(id) => setArchived.mutate({ id, archived: true })}
      onOpenChart={(id) => setChartFor(id)}
      onOpenDetail={(id) => setDetailFor(id)}
    />
  )

  return (
    <div className="flex w-full flex-col">
      {/* ── Top bar: heading (drag handle) + timeline + scroll controls ── */}
      <header className="mb-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1
            className="box-drag-handle cursor-grab select-none text-lg font-semibold uppercase tracking-wide text-ink active:cursor-grabbing"
            title="Drag to move the box"
          >
            Habits that definitely improve my life
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Consistency view: dial vs pips (segmented), + sparkline toggle.
                Pure display prefs, persisted in uiStore. */}
            <div className="inline-flex items-center rounded-md border border-line p-0.5" role="group" aria-label="Consistency display style">
              <button
                type="button"
                onClick={() => setConsistencyStyle('dial')}
                aria-pressed={consistencyStyle === 'dial'}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  consistencyStyle === 'dial' ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'
                }`}
                title="Show consistency as a level dial"
              >
                Dial
              </button>
              <button
                type="button"
                onClick={() => setConsistencyStyle('pips')}
                aria-pressed={consistencyStyle === 'pips'}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  consistencyStyle === 'pips' ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'
                }`}
                title="Show consistency as level pips (the ladder)"
              >
                Pips
              </button>
            </div>
            <button
              type="button"
              onClick={toggleSparkline}
              aria-pressed={sparkline}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                sparkline ? 'border-emerald text-ink' : 'border-line text-muted hover:border-emerald hover:text-ink'
              }`}
              title="Toggle the per-row momentum sparkline"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 17l5-6 4 4 5-8 4 5" />
              </svg>
              Trend
            </button>
            <span className="mr-1 text-xs text-muted">{longToday(today)}</span>
            <button
              type="button"
              onClick={() => nudge(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-muted hover:border-emerald hover:text-ink"
              aria-label="Scroll back"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={scrollToToday}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted hover:border-emerald hover:text-ink"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => nudge(1)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-muted hover:border-emerald hover:text-ink"
              aria-label="Scroll forward"
            >
              ›
            </button>
          </div>
        </div>
      </header>

      {/* ── Grid: sticky name column + horizontally-scrolling day columns ── */}
      <div className="relative">
        <div ref={scrollRef} className="overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* Date header row — drag it to scan the timeline. */}
            <div
              className="sticky top-0 z-20 flex cursor-grab select-none touch-none active:cursor-grabbing"
              onPointerDown={onHeaderDown}
              onPointerMove={onHeaderMove}
              onPointerUp={onHeaderUp}
              title="Drag to scan the timeline (a month ahead)"
            >
              <div className={`${NAME_W} sticky left-0 z-30 shrink-0 border-b border-line bg-surface`} />
              <div
                style={{ width: scoreW }}
                className="sticky left-44 z-30 flex shrink-0 items-end justify-start border-b border-r border-line bg-surface px-2 pb-1.5"
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                  Consistency
                </span>
              </div>
              {days.map((d) => {
                const p = parts(d)
                const isToday = d === today
                const isFuture = d > today
                const isMonthStart = p.d === 1
                return (
                  <div
                    key={d}
                    ref={isToday ? todayCellRef : undefined}
                    className={`${DAY_W} shrink-0 border-b border-line bg-surface px-0 pb-1.5 pt-1 text-center ${
                      isToday ? 'text-emerald' : isFuture ? 'text-faint/50' : 'text-faint'
                    }`}
                  >
                    <div className="text-[10px] leading-tight">{WEEKDAY[p.wd]}</div>
                    <div className={`text-xs leading-tight ${isToday ? 'font-bold' : 'font-medium text-muted'}`}>
                      {p.d}
                    </div>
                    {isMonthStart && (
                      <div className="text-[9px] uppercase tracking-wide text-emerald/70">{MONTH[p.m - 1]}</div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Two sections — drag a habit's name to reorder within a section, or
                across the divider to move it between them. Top = "Building" (the
                normal 7-day rule). Bottom = "Established": auto-ticks every day, so
                you only un-tick a day you missed. */}
            <DndContext sensors={sensors} collisionDetection={sectionCollision} onDragEnd={onDragEnd}>
              {/* ── Building (manual / 7-day rule) ── */}
              <DropZone id={ZONE_BUILDING}>
                <SortableContext items={building.map((h) => h.id)} strategy={verticalListSortingStrategy}>
                  {building.map((h) => renderRow(h))}
                </SortableContext>
                {building.length === 0 && (
                  <div className="px-2 py-6 text-center text-xs text-muted">
                    {listQuery.isLoading
                      ? 'Loading…'
                      : 'No building habits — add one below, or drag one up from Established.'}
                  </div>
                )}
              </DropZone>

              {/* ── Divider: the line + the tinted zone below are enough to set
                  the Established (auto-tick) section apart — no label needed ── */}
              <div className="mt-1 border-t-2 border-emerald/30" />

              {/* ── Established (auto-tick) ── */}
              <DropZone id={ZONE_AUTO} className="min-h-[2.75rem] bg-emerald/[0.03]">
                <SortableContext items={established.map((h) => h.id)} strategy={verticalListSortingStrategy}>
                  {established.map((h) => renderRow(h))}
                </SortableContext>
                {established.length === 0 && (
                  <div className="px-2 py-6 text-center text-xs text-muted">
                    Drag a habit here to auto-tick it every day.
                  </div>
                )}
              </DropZone>

              {/* ── Archived (collapsible) ── A soft-delete bin: drag any habit
                  here to archive it (excluded from every tally + the chart).
                  Expand to restore (drag back up, or the Restore button) or to
                  permanently delete. Always a drop target even while collapsed,
                  so you can archive without expanding first. */}
              <DropZone id={ZONE_ARCHIVE} className="mt-1 border-t border-line">
                <button
                  type="button"
                  onClick={() => setArchiveOpen((o) => !o)}
                  className="flex w-full items-center gap-1.5 px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted transition-colors hover:text-ink"
                  aria-expanded={archiveOpen}
                  title={archiveOpen ? 'Minimize archived habits' : 'Show archived habits'}
                >
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                    className={`shrink-0 transition-transform ${archiveOpen ? 'rotate-90' : ''}`}
                    aria-hidden
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  Archived
                  <span className="text-faint">({archivedHabits.length})</span>
                </button>
                {archiveOpen && (
                  <SortableContext items={archivedHabits.map((h) => h.id)} strategy={verticalListSortingStrategy}>
                    {archivedHabits.length === 0 ? (
                      <div className="px-2 pb-4 pt-1 text-center text-xs text-muted">
                        No archived habits. Drag a habit here to archive it.
                      </div>
                    ) : (
                      archivedHabits.map((h) => (
                        <ArchivedRow
                          key={h.id}
                          habit={h}
                          onRestore={(id) => setArchived.mutate({ id, archived: false })}
                          onDelete={(id, name) => {
                            if (window.confirm(`Permanently delete "${name}"? This cannot be undone.`)) {
                              destroy.mutate({ id })
                            }
                          }}
                        />
                      ))
                    )}
                  </SortableContext>
                )}
              </DropZone>
            </DndContext>
          </div>
        </div>
        {/* Right-edge fade — hints there's more timeline to scroll into. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent" />
      </div>

      {/* ── Add a habit ── */}
      <div className="mt-3 flex shrink-0 gap-2">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addHabit() }}
          placeholder="Add a habit…"
          className="flex-1 rounded-lg border border-ink/10 bg-base px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-emerald focus:outline-none"
        />
        {/* Cadence: how often the habit is due. 1 = daily; type N for "every N
            days" (3 = every 3 days, 7 = weekly, 14 = fortnightly). */}
        <div
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink/10 bg-base px-2.5 py-2 text-sm text-muted"
          title="How often this habit is due — 1 = every day, 7 = once a week, etc."
        >
          <span className="text-xs">every</span>
          <input
            value={addCadence}
            onChange={(e) => setAddCadence(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') addHabit() }}
            inputMode="numeric"
            aria-label="Repeat every N days"
            className="w-10 rounded border border-ink/10 bg-surface px-1.5 py-0.5 text-center text-sm tabular-nums text-ink focus:border-emerald focus:outline-none"
          />
          <span className="text-xs">{Number(addCadence) === 1 ? 'day' : 'days'}</span>
        </div>
        {/* Start date — only for interval habits: picks which period is the first
            one (and lets you backfill history from an earlier date). Daily habits
            always start today. */}
        {Number(addCadence) > 1 && (
          <div
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink/10 bg-base px-2.5 py-2 text-sm text-muted"
            title="First day this interval habit counts from"
          >
            <span className="text-xs">from</span>
            <input
              type="date"
              value={addStart}
              max={today}
              onChange={(e) => setAddStart(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addHabit() }}
              aria-label="Interval habit start date"
              className="rounded border border-ink/10 bg-surface px-1.5 py-0.5 text-sm tabular-nums text-ink focus:border-emerald focus:outline-none"
            />
          </div>
        )}
        <button
          type="button"
          onClick={addHabit}
          disabled={create.isPending || !adding.trim()}
          className="rounded-lg bg-emerald px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* ── Bottom bar: today's tally (ticked / total) ── */}
      <div className="mt-3 flex shrink-0 items-center justify-between rounded-lg border border-line bg-surface px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Ticked today</span>
        <div className="flex items-center gap-2.5">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-emerald transition-all duration-500 ease-out"
              style={{ width: `${todayCount.total ? (todayCount.done / todayCount.total) * 100 : 0}%` }}
            />
          </div>
          <span className="text-sm font-semibold tabular-nums text-ink">
            {todayCount.done}
            <span className="text-faint">/{todayCount.total}</span>
          </span>
        </div>
      </div>

      {/* Consistency-over-time chart (opened by clicking a row's consistency bar) */}
      {chartFor && (
        <LifeHabitScoreChart
          habits={habits}
          focusedId={chartFor}
          today={today}
          onClose={() => setChartFor(null)}
        />
      )}

      {/* Per-habit detail popup (opened by clicking a habit's name) */}
      {detailFor && (() => {
        const h = habits.find((x) => x.id === detailFor)
        return h ? (
          <HabitDetailModal habitId={h.id} name={h.name} notes={h.notes} peakScore={h.peakScore} today={today} onClose={() => setDetailFor(null)} />
        ) : null
      })()}
    </div>
  )
}

// ── One habit row (sortable; its name is the drag handle) ────────────────────

interface HabitRowProps {
  habit: HabitItem
  days: string[]
  today: string
  /** Consistency visual: 'dial' (ring) or 'pips' (ladder). */
  consistencyStyle: 'dial' | 'pips'
  /** Show the momentum sparkline beside the level visual. */
  sparkline: boolean
  /** Measured pixel width for the consistency column (matches the header). */
  scoreW: number
  onToggle: (habitId: string, date: string, current: boolean) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onOpenChart: (id: string) => void
  onOpenDetail: (id: string) => void
}

function HabitRow({ habit, days, today, consistencyStyle, sparkline, scoreW, onToggle, onRename, onRemove, onOpenChart, onOpenDetail }: HabitRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: habit.id,
  })
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(habit.name)
  const explicit = useMemo(() => new Map(habit.days.map((d) => [d.date, d.done])), [habit.days])
  // The day the row's boxes begin: the habit's startDate, or an even earlier
  // back-dated mark — same as the score, so the visible history matches the %.
  const effStart = useMemo(() => scoreStart(habit.startDate, explicit), [habit.startDate, explicit])
  const score = useMemo(
    () => consistencyScore(habit.startDate, explicit, today, habit.autoSince, habit.cadenceDays),
    [habit.startDate, explicit, today, habit.autoSince, habit.cadenceDays],
  )
  // The live level the score currently sits in (derived from the score, allowed
  // to drop). The all-time peak is still tracked in the data + detail modal; it's
  // just no longer drawn as a marker in this cell.
  const cur = useMemo(() => levelFor(score), [score])
  // The two summit tiers (Legend = gold, Mythical = blue) get special accent
  // visuals; every other rung renders in its own colour. `summit` is null below L6.
  const summit = useMemo(() => summitStyle(cur), [cur])

  // Recent consistency-score series for the optional momentum sparkline. Only
  // computed when the sparkline is on; the same EMA the chart uses, last ~3 wks.
  const sparkSeries = useMemo(() => {
    if (!sparkline) return []
    const from = addDaysISO(today, -20)
    return consistencyScoreSeries(habit.startDate, explicit, from, today, habit.autoSince, habit.cadenceDays).map((p) => p.score)
  }, [sparkline, habit.startDate, explicit, today, habit.autoSince, habit.cadenceDays])

  // Clicking the name opens this habit's detail popup. downAt records the
  // pointer-down position so a real drag-to-reorder (>4px) isn't mistaken for a
  // click. A habit with a guide or a special tool (e.g. meditation) shows a hint
  // icon, but every name is clickable.
  const hasExtras = Boolean(habitDocUrl(habit.name)) || isMeditationHabit(habit.name)
  const downAt = useRef<{ x: number; y: number } | null>(null)
  function openDetail(e: ReactMouseEvent) {
    const d = downAt.current
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return
    onOpenDetail(habit.id)
  }

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 30 : undefined,
    position: isDragging ? 'relative' : undefined,
  }

  function commit() {
    const n = text.trim()
    if (n && n !== habit.name) onRename(habit.id, n)
    setEditing(false)
  }

  return (
    <div ref={setNodeRef} style={style} className="group flex border-b border-line/40">
      {/* Sticky name cell — drag here to reorder; a linked name (emerald, with an
          ↗) opens its guide on a single click. The pencil (rename) and ✕ (remove)
          surface only while hovering this cell (group/name), not the whole row. */}
      <div
        onPointerDownCapture={(e) => { downAt.current = { x: e.clientX, y: e.clientY } }}
        className={`${NAME_W} group/name sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line/40 bg-surface pl-2 pr-1`}
      >
        {editing ? (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setText(habit.name); setEditing(false) }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full rounded border border-emerald bg-base px-1 py-0.5 text-xs text-ink focus:outline-none"
          />
        ) : (
          <>
            <span
              {...attributes}
              {...listeners}
              onClick={openDetail}
              title={`${habit.name} — click for details · drag to reorder`}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 py-1 text-xs text-ink hover:text-emerald active:cursor-grabbing"
            >
              <span className="line-clamp-2 leading-tight">{habit.name}</span>
              {hasExtras && (
                <svg
                  width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                  className="shrink-0 opacity-60" aria-hidden
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
              )}
            </span>
            <button
              type="button"
              onClick={() => { setText(habit.name); setEditing(true) }}
              onPointerDown={(e) => e.stopPropagation()}
              className="shrink-0 text-faint opacity-0 transition-opacity hover:text-emerald group-hover/name:opacity-100"
              aria-label={`Rename ${habit.name}`}
              title="Rename habit"
            >
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onRemove(habit.id)}
              onPointerDown={(e) => e.stopPropagation()}
              className="shrink-0 text-[11px] text-faint opacity-0 transition-opacity hover:text-amber group-hover/name:opacity-100"
              aria-label={`Archive ${habit.name}`}
              title="Archive habit"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Consistency cell — pinned between the name and the scrolling day boxes.
          The level + in-band progress is drawn as a DIAL (ring round the level
          digit) or PIPS (the level ladder, made literal) per the header toggle;
          beside it the level name + raw % (Legend keeps its gold decimals + ✦),
          and — when toggled on — a momentum sparkline of the recent score.
          Click opens the chart. */}
      <button
        type="button"
        onClick={() => onOpenChart(habit.id)}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: scoreW,
          ...(summit
            ? {
                background: `color-mix(in srgb, ${summit.accent} 6%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${summit.accent} 30%, transparent)`,
              }
            : undefined),
        }}
        className={`sticky left-44 z-10 flex shrink-0 cursor-pointer items-center gap-2.5 border-r border-line/40 py-0 pl-2.5 pr-1.5 text-left transition-colors hover:bg-surface-2 ${
          summit ? '' : 'bg-surface'
        }`}
        title={`Level ${cur.level} ${cur.name} · ${score.toFixed(2)}% — click for chart`}
        aria-label={`${habit.name} consistency ${score.toFixed(2)} percent, level ${cur.level} ${cur.name} — open chart`}
      >
        {consistencyStyle === 'pips' ? (
          <LevelPips cur={cur} summit={summit} />
        ) : (
          <LevelDial cur={cur} summit={summit} />
        )}

        {/* Level name (tier-coloured) over the raw % score. */}
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className="flex items-center gap-1 truncate text-[11px] font-semibold"
            style={{ color: summit ? summit.accent : cur.color }}
          >
            {cur.name}{summit ? ` ${summit.star}` : ''}
          </span>
          <span
            className="flex items-center gap-0.5 text-[11px] font-semibold tabular-nums"
            style={{ color: summit ? summit.accent : 'var(--color-ink)' }}
          >
            {summit ? (
              <>
                {Math.floor(score)}.
                <span style={{ textShadow: `0 0 8px ${summit.glow}` }}>
                  {score.toFixed(2).split('.')[1]}
                </span>
              </>
            ) : (
              score.toFixed(2)
            )}
            <span className="text-[9px] font-normal opacity-70">%</span>
          </span>
        </div>

        {sparkline && <MiniSparkline series={sparkSeries} summit={summit} />}
      </button>

      {/* Day cells — interval habits (cadence > 1) draw one checkbox spanning each
          calendar-aligned period instead of one per day; daily habits unchanged. */}
      {habit.cadenceDays > 1 ? (
        <IntervalCells habit={habit} days={days} today={today} explicit={explicit} onToggle={onToggle} />
      ) : days.map((d) => {
        const isToday = d === today
        const isFuture = d > today
        const active = isActiveDay(effStart, d)
        const done = cellDone(habit.startDate, d, explicit.get(d), habit.autoSince)
        // A miss = explicitly un-ticked during the auto era: day 8+ for a Building
        // habit, or any day from autoSince on for an Established one (defaultDone
        // is true exactly across that auto era).
        const missedAuto =
          !done && explicit.get(d) === false && defaultDone(habit.startDate, d, habit.autoSince)

        const check = (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )

        let cell
        if (isFuture) {
          // Visible on the timeline but locked until that day arrives.
          cell = (
            <span
              className="h-6 w-6 rounded-md border border-dashed border-line/50"
              title={`Unlocks on ${d}`}
              aria-label={`${habit.name} — ${d} (upcoming)`}
            />
          )
        } else if (active) {
          // Any day from the habit's start through today — fully tickable, so the
          // entire history is editable, not just the recent week.
          cell = (
            <button
              type="button"
              onClick={() => onToggle(habit.id, d, done)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-pressed={done}
              aria-label={`${habit.name} — ${d}`}
              title={d}
              className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                done
                  ? 'border-emerald bg-emerald text-white'
                  : missedAuto
                    ? 'border-amber/70 text-transparent hover:border-amber'
                    : 'border-line text-transparent hover:border-emerald'
              } ${isToday ? 'ring-1 ring-emerald/50' : ''}`}
            >
              {done ? check : <span aria-hidden>·</span>}
            </button>
          )
        } else {
          // Before this habit existed — a faint spacer that holds the column.
          cell = <span className="h-1 w-1 rounded-full bg-faint/30" aria-hidden />
        }

        return (
          <div
            key={d}
            className={`${DAY_W} flex h-11 shrink-0 items-center justify-center ${isToday ? 'bg-emerald/5' : ''}`}
          >
            {cell}
          </div>
        )
      })}
    </div>
  )
}

// ── One archived habit row (sortable; muted, read-only) ──────────────────────
// Rendered MUTED (reduced opacity, neutral tone — no red/green to convey state)
// and read-only: no day cells, no consistency. Just the name plus Restore /
// Delete actions. Drag it (anywhere on the row) back up into Building/Established
// to restore-and-place it; onDragEnd handles the cross-section move.

interface ArchivedRowProps {
  habit: HabitItem
  onRestore: (id: string) => void
  onDelete: (id: string, name: string) => void
}

function ArchivedRow({ habit, onRestore, onDelete }: ArchivedRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: habit.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 0.6,
    zIndex: isDragging ? 30 : undefined,
    position: isDragging ? 'relative' : undefined,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/arch flex items-center gap-1 border-b border-line/30 bg-surface px-2 py-1.5"
    >
      <span
        {...attributes}
        {...listeners}
        title={`${habit.name} — drag up to restore`}
        className="min-w-0 flex-1 cursor-grab truncate text-xs text-muted active:cursor-grabbing"
      >
        {habit.name}
      </span>
      <button
        type="button"
        onClick={() => onRestore(habit.id)}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:border-emerald hover:text-ink"
        aria-label={`Restore ${habit.name}`}
        title="Restore habit"
      >
        Restore
      </button>
      <button
        type="button"
        onClick={() => onDelete(habit.id, habit.name)}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] font-medium text-faint transition-colors hover:border-amber hover:text-amber"
        aria-label={`Permanently delete ${habit.name}`}
        title="Delete permanently"
      >
        Delete
      </button>
    </div>
  )
}

// ── Interval-habit period cells ──────────────────────────────────────────────
// One checkbox per calendar-aligned period (cadence > 1), laid over the same
// daily grid so the boxes still line up under the date header. Each box spans its
// period's columns; ticking it stores the mark on the period's START date (the
// anchor the score + default logic read). Done = emerald; a missed auto-period =
// amber (never red — keeps it colour-weakness-safe).

const DAY_W_PX = 44 // matches DAY_W ('w-11' = 2.75rem)

function IntervalCells({
  habit,
  days,
  today,
  explicit,
  onToggle,
}: {
  habit: HabitItem
  days: string[]
  today: string
  explicit: Map<string, boolean>
  onToggle: (habitId: string, date: string, current: boolean) => void
}) {
  const c = habit.cadenceDays
  const currentPS = periodStart(today, c)
  // Start boxes from the same effective start the score uses (startDate, or an
  // earlier back-dated mark), so back-dated periods render and stay editable.
  const firstPS = periodStart(scoreStart(habit.startDate, explicit), c)

  // Walk the daily axis and group it into period boxes, emitting one box at the
  // leftmost rendered day of each period. A box spans only the columns present in
  // `days`, so the leading period (axis starting mid-period) is a partial box —
  // its width still matches those columns, keeping every row aligned.
  const boxes: { ps: string; span: number }[] = []
  for (let i = 0; i < days.length; i++) {
    const ps = periodStart(days[i], c)
    if (i > 0 && periodStart(days[i - 1], c) === ps) continue
    let span = 1
    while (i + span < days.length && periodStart(days[i + span], c) === ps) span++
    boxes.push({ ps, span })
  }

  const check = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )

  return (
    <>
      {boxes.map(({ ps, span }) => {
        const width = span * DAY_W_PX
        const active = ps >= firstPS
        const isCurrent = ps === currentPS
        const isFuture = ps > currentPS
        const done = cellDone(habit.startDate, ps, explicit.get(ps), habit.autoSince, c)
        const missedAuto =
          !done && explicit.get(ps) === false && defaultDone(habit.startDate, ps, habit.autoSince, c)
        const label = periodRangeLabel(ps, periodEnd(ps, c))

        let box
        if (!active) {
          // Period before the habit began — a faint spacer that holds the column.
          box = <span className="h-1 w-1 rounded-full bg-faint/30" aria-hidden />
        } else if (isFuture) {
          box = (
            <span
              className="flex h-8 flex-col items-center justify-center rounded-md border border-dashed border-line/50 px-2"
              style={{ width: width - 6 }}
              title={`Upcoming period · ${label}`}
              aria-label={`${habit.name} — ${label} (upcoming)`}
            >
              <span className="text-[9px] leading-none text-faint">{label}</span>
            </span>
          )
        } else {
          // Any period from the habit's start through the current one — fully
          // tickable, so the whole history is editable, not just the last period.
          box = (
            <button
              type="button"
              onClick={() => onToggle(habit.id, ps, done)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-pressed={done}
              aria-label={`${habit.name} — ${label}`}
              title={`${label}${done ? ' — done' : ''}`}
              style={{ width: width - 6 }}
              className={`flex h-8 flex-col items-center justify-center gap-0.5 rounded-md border transition-colors ${
                done
                  ? 'border-emerald bg-emerald text-white'
                  : missedAuto
                    ? 'border-amber/70 text-amber hover:border-amber'
                    : 'border-line text-muted hover:border-emerald'
              } ${isCurrent ? 'ring-1 ring-emerald/50' : ''}`}
            >
              <span className={`text-[9px] leading-none ${done ? 'text-white/70' : 'opacity-70'}`}>{label}</span>
              {done ? check : <span className="text-xs leading-none" aria-hidden>·</span>}
            </button>
          )
        }

        return (
          <div
            key={ps}
            className={`flex h-11 shrink-0 items-center justify-center ${isCurrent ? 'bg-emerald/5' : ''}`}
            style={{ width }}
          >
            {box}
          </div>
        )
      })}
    </>
  )
}

// ── Consistency visuals (dial / pips / sparkline) ────────────────────────────

type LevelView = ReturnType<typeof levelFor>

/**
 * LevelDial — the level digit centred in a ring that fills `cur.progress` of the
 * way toward the next level, in the tier's colour. The summit tiers (Legend gold,
 * Mythical blue) get an accent ring + glow.
 */
function LevelDial({ cur, summit }: { cur: LevelView; summit: SummitStyle | null }) {
  const SZ = 34
  const R = 13
  const C = 2 * Math.PI * R
  const dash = (frac: number) => `${(Math.max(0, Math.min(1, frac)) * C).toFixed(1)} ${C.toFixed(1)}`
  const col = summit ? summit.accent : cur.color
  return (
    <span
      className="relative shrink-0"
      style={{ width: SZ, height: SZ, filter: summit ? `drop-shadow(0 0 4px ${summit.glow})` : undefined }}
      aria-hidden
    >
      <svg width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`}>
        <circle cx={SZ / 2} cy={SZ / 2} r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth={3.5} />
        <circle
          cx={SZ / 2}
          cy={SZ / 2}
          r={R}
          fill="none"
          stroke={col}
          strokeWidth={3.5}
          strokeDasharray={dash(cur.progress)}
          strokeLinecap="round"
          transform={`rotate(-90 ${SZ / 2} ${SZ / 2})`}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[12px] font-extrabold leading-none"
        style={{ color: summit ? summit.accent : 'var(--color-ink)' }}
      >
        {cur.level}
      </span>
    </span>
  )
}

/**
 * LevelPips — the level ladder made literal: eight little segments (L0→L7).
 * Levels already reached are filled solid in their tier colour; the current
 * level's pip is filled by `cur.progress`; future pips stay dim. The summit tier
 * the score currently sits in (Legend or Mythical) shimmers in its accent.
 */
function LevelPips({ cur, summit }: { cur: LevelView; summit: SummitStyle | null }) {
  return (
    <span className="flex shrink-0 items-end gap-[3px]" aria-hidden>
      {LEVELS.map((lv, i) => {
        const reached = i < cur.level
        const isCur = i === cur.level
        const fill = isCur ? cur.progress * 100 : reached ? 100 : 0
        // Shimmer only the pip of the summit tier the score is currently in.
        const shimmer = summit && isCur ? summit.fillClass : ''
        return (
          <span
            key={lv.level}
            title={`Level ${lv.level} ${lv.name}`}
            className="relative overflow-hidden rounded-[3px]"
            style={{ width: 6, height: 22, background: 'var(--color-surface-2)' }}
          >
            <span
              className={`absolute inset-x-0 bottom-0 ${shimmer}`}
              style={{ height: `${fill}%`, background: shimmer ? undefined : lv.color }}
            />
          </span>
        )
      })}
    </span>
  )
}

/**
 * MiniSparkline — a compact line of the recent consistency score, so a row's
 * momentum (rising / sliding) reads at a glance. The slope carries the meaning
 * (no red/green up-down coding — colour-vision-safe); the line uses the habits
 * accent (gold for Legend, blue for Mythical). Needs ≥2 points, else a faint dash.
 */
function MiniSparkline({ series, summit }: { series: number[]; summit: SummitStyle | null }) {
  const W = 46
  const H = 24
  const PAD = 2
  const pts = series.slice(-14)
  const col = summit ? summit.accent : 'var(--color-emerald)'
  if (pts.length < 2) {
    return (
      <span className="shrink-0 text-center text-[9px] text-faint" style={{ width: W }} aria-hidden>
        —
      </span>
    )
  }
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const span = hi - lo || 1
  const x = (i: number) => (i / (pts.length - 1)) * (W - PAD * 2) + PAD
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2)
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const lastX = x(pts.length - 1)
  const lastY = y(pts[pts.length - 1])
  return (
    <svg className="shrink-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={d} fill="none" stroke={col} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.2} fill={col} />
    </svg>
  )
}

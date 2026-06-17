'use client'

/**
 * DayPlanner — the Schedule tab's day-view planner, ported from the warm-paper
 * "gentle climb" HTML. A vertical time axis (06:30–21:30) you drag task blocks
 * onto: blocks are as tall as they are long, snap to 5 min, and auto-nudge so
 * they never overlap. A box on the right holds unscheduled tasks; a "Finished
 * today" list collects done ones. Add tasks inline, pull tasks/goals in from
 * Pursuits (the picker overlay), and open any block to edit it or enter Focus
 * mode (the app's existing Pomodoro overlay).
 *
 * Design is fully self-contained: a `dp-`-prefixed <style> block with the HTML's
 * own warm-paper palette and serif fonts — it does NOT use the app's theme
 * tokens, so it looks like the source design regardless of the app theme.
 *
 * State lives in the DB via the `dayPlanner` tRPC router (one PlannerBlock per
 * task/pause for the day). Drag is done imperatively (a body-level ghost + a
 * drop-guide line mutated directly) so the React tree doesn't re-render mid-drag;
 * on drop we call the mutation and the query refetches.
 */

import { useEffect, useRef, useState } from 'react'
import type { inferRouterOutputs } from '@trpc/server'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@/server/routers/_app'
import { openFocusMode } from '@/stores/uiStore'
import { PursuitsPickerOverlay } from './PursuitsPickerOverlay'

type Block = inferRouterOutputs<AppRouter>['dayPlanner']['today'][number]
type Commitment = inferRouterOutputs<AppRouter>['commitment']['list'][number]
type Energy = 'high' | 'med' | 'low' | 'fun'

// Axis + scale.
const AX_START = 390 // 06:30
const AX_END = 1290 // 21:30
const PXPM = 1.4 // pixels per minute
const SNAP = 5 // minutes

const pad = (n: number) => (n < 10 ? '0' : '') + n
const fmt = (min: number) => {
  const m = Math.round(min)
  return pad(Math.floor(m / 60)) + ':' + pad(((m % 60) + 60) % 60)
}
const snap = (m: number) => Math.round(m / SNAP) * SNAP
const nowMin = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

// ── Day keys ─────────────────────────────────────────────────────────────────
/** Local calendar date as "YYYY-MM-DD" (matches the router's convention). */
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Shift a "YYYY-MM-DD" key by n days (n may be negative). */
const addDaysISO = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
/** Human-friendly weekday + date for the header, e.g. "Sunday · 7 June 2026". */
const formatDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const weekday = dt.toLocaleDateString(undefined, { weekday: 'long' })
  const date = dt.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  return { weekday, date }
}

const ENERGY_LABEL: Record<Energy, string> = {
  high: '🔋 high',
  med: 'steady',
  low: '🪫 low',
  fun: '✨ fun',
}

/** CSS modifier class for a block — fixed-purpose kinds win, else energy. */
const blockClass = (b: { kind: string; energy: string }): string =>
  b.kind === 'pause'
    ? 'pause'
    : b.kind === 'meal'
      ? 'meal'
      : b.kind === 'break'
        ? 'break'
        : b.kind === 'read'
          ? 'read'
          : b.kind === 'meditation'
            ? 'meditation'
            : b.kind === 'commitment'
              ? 'commitment'
              : b.energy

/** The little chip label shown on a placed block. */
const chipLabel = (b: { kind: string; energy: string }): string =>
  b.kind === 'pause'
    ? '⏸ pause'
    : b.kind === 'meal'
      ? '🍽 meal'
      : b.kind === 'break'
        ? '☕ break'
        : b.kind === 'read'
          ? '📖 read'
          : b.kind === 'meditation'
            ? '🧘 meditation'
            : b.kind === 'commitment'
              ? '🔁 commitment'
              : (ENERGY_LABEL[b.energy as Energy] ?? b.energy)

/** Leading icon for a kind in the task box (empty for plain tasks). */
const kindIcon = (kind: string): string =>
  kind === 'pause'
    ? '⏸ '
    : kind === 'meal'
      ? '🍽 '
      : kind === 'break'
        ? '☕ '
        : kind === 'read'
          ? '📖 '
          : kind === 'meditation'
            ? '🧘 '
            : kind === 'commitment'
              ? '🔁 '
              : ''

// ── Recurring commitments ─────────────────────────────────────────────────────
/** Weekday labels, JS order (Sun=0). Display order is Mon-first via WD_ORDER. */
const WD_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Mon-first ordering of JS weekday numbers, for pickers + summaries. */
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]

const parseWeekdays = (csv: string): number[] =>
  csv
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)

/** Short date like "8 Jun" for a "YYYY-MM-DD" key (empty string → ""). */
const shortDate = (iso: string): string => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** One-line summary of a commitment, e.g. "Mo We Fr · 07:00 · 45m · biweekly". */
const summarizeCommit = (c: Commitment): string => {
  const set = new Set(parseWeekdays(c.weekdays))
  const days = WD_ORDER.filter((n) => set.has(n))
    .map((n) => WD_SHORT[n])
    .join(' ')
  // Only show "from <date>" while the start date is still in the future — once
  // it's passed it's just noise.
  const fromPart = c.startDate && c.startDate > todayISO() ? ` · from ${shortDate(c.startDate)}` : ''
  return `${days || '—'} · ${fmt(c.startMin)} · ${c.durationMin}m${c.frequency === 'biweekly' ? ' · biweekly' : ''}${fromPart}`
}

/** Overlap nudge: push a block down until [start, start+dur] clears all others. */
function resolveStart(durationMin: number, start: number, placed: Block[], selfId: string): number {
  const dur = Math.max(durationMin, 5)
  const others = placed
    .filter((o) => o.id !== selfId && o.startMin != null)
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0))
  let s = start
  let guard = 0
  let changed = true
  while (changed && guard < 60) {
    changed = false
    guard++
    for (const o of others) {
      const oe = (o.startMin ?? 0) + Math.max(o.durationMin, 5)
      if (s < oe && s + dur > (o.startMin ?? 0)) {
        s = oe
        changed = true
      }
    }
  }
  return s
}

interface DragState {
  id: string
  el: HTMLElement
  /** Where the drag started: 'cal' (placed), 'box', 'nested' (inside a work
   *  block), or 'palette' (a template card → creates a new block on drop). */
  from: 'cal' | 'box' | 'nested' | 'palette'
  palette?: string // the palette element kind when from==='palette'
  sx: number
  sy: number
  ox: number
  oy: number
  w: number
  moved: boolean
  ghost: HTMLElement | null
  pid: number
}

/** Resizing a placed block by dragging its bottom edge (changes duration). */
interface ResizeState {
  id: string
  el: HTMLElement
  startMin: number
  startDur: number
  minDur: number // work blocks can't shrink below the sum of their tasks
  maxDur: number // capped so it can't grow past the next block below
  sy: number
  pid: number
  moved: boolean
  curDur: number
}

export function DayPlanner() {
  const utils = trpc.useUtils()

  // Which day is on screen. Defaults to today; the arrows page through past
  // (stored) and future (plannable) days. Every block is scoped to this date.
  const [selectedDate, setSelectedDate] = useState(() => todayISO())
  const isToday = selectedDate === todayISO()
  const { weekday, date: dateLabel } = formatDay(selectedDate)

  const { data: blocks = [] } = trpc.dayPlanner.today.useQuery({ date: selectedDate })
  // Completed focus sessions for this day → a read-only history layer on the axis.
  const { data: sessions = [] } = trpc.pomodoro.completedForDate.useQuery({ date: selectedDate })

  const [now, setNow] = useState(() => nowMin())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [commitmentsOpen, setCommitmentsOpen] = useState(false)

  // Recurring commitments — the templates (for the box summary) + a mutation to
  // lay out the ones that fall on the viewed day.
  const { data: commitments = [] } = trpc.commitment.list.useQuery()
  const materializeM = trpc.commitment.materialize.useMutation({
    onSuccess: (r) => {
      if (r.created > 0) void utils.dayPlanner.today.invalidate()
    },
  })

  // New-task controls.
  const [newName, setNewName] = useState('')
  const [newDur, setNewDur] = useState(20)
  const [newEnergy, setNewEnergy] = useState<Energy>('med')

  const rootRef = useRef<HTMLDivElement>(null)
  const calAreaRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const hoverGuideRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  // Live blocks for the pointer handlers (refs don't go stale between renders).
  const blocksRef = useRef<Block[]>(blocks)
  blocksRef.current = blocks

  const invalidate = () => void utils.dayPlanner.today.invalidate()
  const addTaskM = trpc.dayPlanner.addTask.useMutation({ onSettled: invalidate })
  const addPauseM = trpc.dayPlanner.addPause.useMutation({ onSettled: invalidate })
  const placeM = trpc.dayPlanner.place.useMutation({ onSettled: invalidate })
  const moveM = trpc.dayPlanner.move.useMutation({ onSettled: invalidate })
  const unplaceM = trpc.dayPlanner.unplace.useMutation({ onSettled: invalidate })
  const updateM = trpc.dayPlanner.update.useMutation({ onSettled: invalidate })
  const addWorkM = trpc.dayPlanner.addWork.useMutation({ onSettled: invalidate })
  const addElementM = trpc.dayPlanner.addElement.useMutation({ onSettled: invalidate })
  const nestM = trpc.dayPlanner.nest.useMutation({ onSettled: invalidate })
  const unnestM = trpc.dayPlanner.unnest.useMutation({ onSettled: invalidate })
  const rescheduleM = trpc.dayPlanner.reschedule.useMutation({ onSettled: invalidate })
  const rescheduleBoxM = trpc.dayPlanner.rescheduleBox.useMutation({ onSettled: invalidate })

  // Refresh the now-line each minute.
  useEffect(() => {
    const t = setInterval(() => setNow(nowMin()), 60000)
    return () => clearInterval(t)
  }, [])

  // Whenever the viewed day (or the set of commitments) changes, lay out any
  // recurring commitments that fall on it. Idempotent + past-safe server-side,
  // so this is cheap to fire on every open and only ever adds missing blocks.
  useEffect(() => {
    materializeM.mutate({ date: selectedDate })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, commitments])

  // Top-level placed blocks (on the axis): standalone tasks/pauses + work blocks.
  // Nested tasks (parentId set) are rendered *inside* their work block instead.
  const placed = blocks.filter((b) => b.placed && b.parentId == null)
  const boxed = blocks.filter((b) => !b.placed && b.parentId == null && b.status !== 'done')
  const finished = blocks
    .filter((b) => b.status === 'done' && b.parentId == null)
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0))

  // Tasks nested inside each work block, in chronological (position) order.
  const childrenByParent = new Map<string, Block[]>()
  for (const b of blocks) {
    if (b.parentId) {
      const arr = childrenByParent.get(b.parentId) ?? []
      arr.push(b)
      childrenByParent.set(b.parentId, arr)
    }
  }
  for (const arr of childrenByParent.values()) arr.sort((a, b) => a.position - b.position)
  const childDurSum = (id: string) =>
    (childrenByParent.get(id) ?? []).reduce((s, c) => s + c.durationMin, 0)

  // ── Layout height ─────────────────────────────────────────────────────────
  let maxEnd = AX_END
  for (const t of placed) maxEnd = Math.max(maxEnd, (t.startMin ?? 0) + t.durationMin)
  for (const s of sessions) maxEnd = Math.max(maxEnd, s.startMin + s.durationMin)
  const areaHeight = (Math.max(AX_END, maxEnd) - AX_START) * PXPM + 10

  // ── Axis lines ────────────────────────────────────────────────────────────
  const lines: React.ReactNode[] = []
  const endH = Math.ceil((AX_START + (areaHeight - 10) / PXPM) / 60)
  for (let h = Math.floor(AX_START / 60); h <= endH; h++) {
    const y = (h * 60 - AX_START) * PXPM
    if (y < 0) continue
    lines.push(<div key={`hl${h}`} className="dp-hourline" style={{ top: y }} />)
    lines.push(
      <div key={`hlb${h}`} className="dp-hourlabel" style={{ top: y }}>
        {pad(h)}:00
      </div>,
    )
    lines.push(<div key={`half${h}`} className="dp-halfline" style={{ top: y + 30 * PXPM }} />)
  }
  const nowVisible = now >= AX_START && now <= AX_START + (areaHeight - 10) / PXPM

  // ── Drag handlers (imperative — no React state changes mid-drag) ───────────
  function onPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement
    if (target.closest('button,input,select,textarea,a,[contenteditable]')) return

    // Resize handle (bottom edge of a placed block) — drag to change duration.
    const rzEl = target.closest('[data-resize-id]') as HTMLElement | null
    if (rzEl) {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const id = rzEl.dataset.resizeId!
      const block = blocksRef.current.find((b) => b.id === id)
      const blockEl = rzEl.closest('[data-block-id]') as HTMLElement | null
      if (!block || !block.placed || block.startMin == null || !blockEl) return
      // Cap the new length so it can't grow past the next top-level block below.
      const below = blocksRef.current
        .filter(
          (b) =>
            b.placed && b.parentId == null && b.id !== id && (b.startMin ?? 0) > (block.startMin ?? 0),
        )
        .map((b) => b.startMin ?? 0)
      const maxDur = below.length ? Math.max(5, Math.min(...below) - block.startMin) : 100000
      // A work block can't shrink below the total length of the tasks it holds.
      const minDur = block.kind === 'work' ? Math.max(5, childDurSum(id)) : 5
      resizeRef.current = {
        id,
        el: blockEl,
        startMin: block.startMin,
        startDur: block.durationMin,
        minDur,
        maxDur,
        sy: e.clientY,
        pid: e.pointerId,
        moved: false,
        curDur: block.durationMin,
      }
      try {
        rootRef.current?.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      e.preventDefault()
      return
    }

    // Palette card (e.g. "Work block") — dragging it onto the axis creates a
    // new block there. It isn't a real block yet, so it has no data-block-id.
    const palEl = target.closest('[data-palette]') as HTMLElement | null
    if (palEl) {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const rect = palEl.getBoundingClientRect()
      dragRef.current = {
        id: '__palette__',
        el: palEl,
        from: 'palette',
        palette: palEl.dataset.palette!,
        sx: e.clientX,
        sy: e.clientY,
        ox: e.clientX - rect.left,
        oy: e.clientY - rect.top,
        w: rect.width,
        moved: false,
        ghost: null,
        pid: e.pointerId,
      }
      return
    }

    const el = target.closest('[data-block-id]') as HTMLElement | null
    if (!el) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      id: el.dataset.blockId!,
      el,
      from: (el.dataset.from as DragState['from']) ?? 'box',
      sx: e.clientX,
      sy: e.clientY,
      ox: e.clientX - rect.left,
      oy: e.clientY - rect.top,
      w: rect.width,
      moved: false,
      ghost: null,
      pid: e.pointerId,
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // Resize in progress — grow/shrink the block's height live.
    const rz = resizeRef.current
    if (rz) {
      e.preventDefault()
      const dy = e.clientY - rz.sy
      if (!rz.moved && Math.abs(dy) < 4) return
      rz.moved = true
      let dur = snap(rz.startDur + dy / PXPM)
      if (dur < rz.minDur) dur = rz.minDur
      if (dur > rz.maxDur) dur = rz.maxDur
      rz.curDur = dur
      rz.el.style.height = Math.max(dur * PXPM, 20) + 'px'
      const timeEl = rz.el.querySelector('.dp-b-time') as HTMLElement | null
      if (timeEl) timeEl.textContent = `${fmt(rz.startMin)}–${fmt(rz.startMin + dur)} · ${dur}m`
      return
    }

    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.sx
    const dy = e.clientY - drag.sy
    if (!drag.moved) {
      if (Math.sqrt(dx * dx + dy * dy) < 5) return
      drag.moved = true
      document.body.classList.add('dp-is-dragging')
      drag.el.style.opacity = '0.4'
      const g = drag.el.cloneNode(true) as HTMLElement
      g.style.position = 'fixed'
      g.style.zIndex = '80'
      g.style.width = drag.w + 'px'
      g.style.pointerEvents = 'none'
      g.style.opacity = '0.9'
      g.style.boxShadow = '0 12px 30px rgba(0,0,0,.22)'
      g.style.left = '0'
      g.style.top = '0'
      g.style.margin = '0'
      document.body.appendChild(g)
      drag.ghost = g
      try {
        rootRef.current?.setPointerCapture(drag.pid)
      } catch {
        /* ignore */
      }
    }
    e.preventDefault()
    if (drag.ghost) {
      drag.ghost.style.transform = `translate(${e.clientX - drag.ox}px,${e.clientY - drag.oy}px)`
    }
    // Drop-guide line when over the calendar.
    const cal = calAreaRef.current
    const guide = guideRef.current
    if (!cal || !guide) return
    const cr = cal.getBoundingClientRect()
    const overCal =
      e.clientX >= cr.left - 10 &&
      e.clientX <= cr.right + 10 &&
      e.clientY >= cr.top - 10 &&
      e.clientY <= cr.bottom + 40
    if (overCal) {
      const topY = e.clientY - drag.oy - cr.top
      let startM = snap(AX_START + topY / PXPM)
      if (startM < AX_START) startM = AX_START
      guide.style.display = 'block'
      guide.style.top = (startM - AX_START) * PXPM + 'px'
      guide.setAttribute('data-t', fmt(startM))
    } else {
      guide.style.display = 'none'
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    // Finish a resize: commit the new duration (or revert if nothing changed).
    const rz = resizeRef.current
    if (rz) {
      resizeRef.current = null
      try {
        rootRef.current?.releasePointerCapture(rz.pid)
      } catch {
        /* ignore */
      }
      if (rz.moved && rz.curDur !== rz.startDur) {
        updateM.mutate({ id: rz.id, durationMin: rz.curDur })
      } else {
        invalidate() // snap the inline height back to the real value
      }
      return
    }

    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    document.body.classList.remove('dp-is-dragging')
    drag.el.style.opacity = ''
    if (drag.ghost) drag.ghost.remove()
    if (guideRef.current) guideRef.current.style.display = 'none'

    if (!drag.moved) {
      if (drag.from !== 'palette') setDetailId(drag.id)
      return
    }
    const cal = calAreaRef.current
    const box = boxRef.current
    if (!cal || !box) return
    const cr = cal.getBoundingClientRect()
    const br = box.getBoundingClientRect()
    const overCal =
      e.clientX >= cr.left - 10 &&
      e.clientX <= cr.right + 10 &&
      e.clientY >= cr.top - 10 &&
      e.clientY <= cr.bottom + 40
    const overBox =
      e.clientX >= br.left - 10 &&
      e.clientX <= br.right + 10 &&
      e.clientY >= br.top - 10 &&
      e.clientY <= br.bottom + 10

    const startAt = () => {
      const topY = e.clientY - drag.oy - cr.top
      let s = snap(AX_START + topY / PXPM)
      if (s < AX_START) s = AX_START
      return s
    }
    const placedTop = blocksRef.current.filter((b) => b.placed && b.parentId == null)

    // Which work block (if any) sits under the pointer — a nest drop target.
    let wbId: string | null = null
    const root = rootRef.current
    if (root) {
      for (const n of Array.from(root.querySelectorAll('[data-worktarget]'))) {
        const r = (n as HTMLElement).getBoundingClientRect()
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          wbId = (n as HTMLElement).dataset.worktarget!
          break
        }
      }
    }

    // A palette card dropped on the axis → create a new block there. Palette
    // blocks always land on the axis at the drop time (never nest into a work
    // block), so a drop in free time can't silently vanish just because the
    // pointer grazed a work block below it — the overlap nudge keeps it clear.
    if (drag.from === 'palette') {
      if (overCal && drag.palette) {
        if (drag.palette === 'work') {
          const resolved = resolveStart(60, startAt(), placedTop, '')
          addWorkM.mutate({ startMin: resolved, durationMin: 60, date: selectedDate })
        } else {
          // Encoded as "kind:duration", e.g. "meal:60", "read:30".
          const [kind, durStr] = drag.palette.split(':')
          const durationMin = parseInt(durStr, 10) || 30
          const resolved = resolveStart(durationMin, startAt(), placedTop, '')
          addElementM.mutate({
            kind: kind as 'meal' | 'break' | 'read' | 'meditation',
            durationMin,
            startMin: resolved,
            date: selectedDate,
          })
        }
      }
      return
    }

    const block = blocksRef.current.find((b) => b.id === drag.id)
    if (!block) return

    // Dropped onto a work block → nest the task inside it (work blocks can't nest
    // into one another). Dropping back on its own parent is a no-op.
    if (block.kind !== 'work' && wbId && wbId !== block.id) {
      if (wbId !== block.parentId) nestM.mutate({ id: block.id, parentId: wbId })
      else invalidate()
      return
    }

    if (overCal) {
      const resolved = resolveStart(block.durationMin, startAt(), placedTop, block.id)
      if (drag.from === 'nested') {
        // Pull a nested task out of its work block onto the axis as a standalone.
        unnestM.mutate(
          { id: block.id },
          { onSuccess: () => placeM.mutate({ id: block.id, startMin: resolved }) },
        )
      } else if (drag.from === 'cal') {
        moveM.mutate({ id: block.id, startMin: resolved })
      } else {
        placeM.mutate({ id: block.id, startMin: resolved })
      }
    } else if (overBox) {
      if (drag.from === 'nested') unnestM.mutate({ id: block.id })
      else if (drag.from === 'cal') unplaceM.mutate({ id: block.id })
    }
  }

  // ── Hover guide over free timeline space (imperative DOM, no React re-render) ─
  // Shows a blue 2px line + "＋ HH:MM" badge snapped to the nearest 5 min.
  // Hidden when cursor is over a block or leaves the cal area, and suppressed
  // entirely while a drag or resize is in progress so it doesn't fight the
  // existing drop-guide.
  function onCalMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const hg = hoverGuideRef.current
    const cal = calAreaRef.current
    if (!hg || !cal) return
    // Don't show hover guide while dragging/resizing — the drag guide takes over.
    if (dragRef.current || resizeRef.current) {
      hg.style.display = 'none'
      return
    }
    const target = e.target as HTMLElement
    // Hide when cursor is over a placed block or the resize handle.
    if (target.closest('[data-block-id],[data-resize-id]')) {
      hg.style.display = 'none'
      return
    }
    const cr = cal.getBoundingClientRect()
    const topY = e.clientY - cr.top
    const m = snap(AX_START + topY / PXPM)
    hg.style.display = 'block'
    hg.style.top = Math.max(0, (m - AX_START) * PXPM) + 'px'
    hg.setAttribute('data-t', '＋ ' + fmt(m))
  }

  function onCalMouseLeave() {
    if (hoverGuideRef.current) hoverGuideRef.current.style.display = 'none'
  }

  function addTask() {
    const title = newName.trim()
    if (!title || addTaskM.isPending) return
    addTaskM.mutate({ title, durationMin: Math.max(5, newDur || 20), energy: newEnergy, date: selectedDate })
    setNewName('')
  }

  const detailBlock = detailId ? blocks.find((b) => b.id === detailId) : null

  return (
    <div className="dp-root">
      <style>{DP_CSS}</style>

      {/* Day navigation: ‹ prev · weekday + date (drag handle) · next › */}
      <div className="dp-daynav">
        <button
          type="button"
          className="dp-navbtn"
          onClick={() => setSelectedDate((d) => addDaysISO(d, -1))}
          aria-label="Previous day"
          title="Previous day"
        >
          ‹
        </button>
        <h2 className="box-drag-handle dp-h2" title="Drag to move · drag any edge to resize">
          <span className="dp-day-weekday">{weekday}</span>
          <span className="dp-day-date">{dateLabel}</span>
        </h2>
        <button
          type="button"
          className="dp-navbtn"
          onClick={() => setSelectedDate((d) => addDaysISO(d, 1))}
          aria-label="Next day"
          title="Next day"
        >
          ›
        </button>
        {!isToday && (
          <button
            type="button"
            className="dp-btn dp-today-jump"
            onClick={() => setSelectedDate(todayISO())}
            title="Jump back to today"
          >
            Today
          </button>
        )}
      </div>
      {/* Controls */}
      <div className="dp-controls">
        <input
          className="dp-name-in"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTask()
          }}
          placeholder="new task… (e.g. reply to Sport Atelier email)"
        />
        <span className="dp-dur-wrap">
          <input
            type="number"
            min={5}
            value={newDur}
            onChange={(e) => setNewDur(parseInt(e.target.value, 10) || 0)}
            className="dp-dur-in"
          />{' '}
          min
        </span>
        <select
          value={newEnergy}
          onChange={(e) => setNewEnergy(e.target.value as Energy)}
          className="dp-select"
        >
          <option value="high">🔋 high focus</option>
          <option value="med">steady</option>
          <option value="low">🪫 low</option>
          <option value="fun">✨ fun</option>
        </select>
        <button className="dp-btn dp-primary" onClick={addTask}>
          + Add task
        </button>
        <button className="dp-btn" onClick={() => addPauseM.mutate({ durationMin: 15, date: selectedDate })}>
          + Pause
        </button>
        <button className="dp-btn dp-from" onClick={() => setPickerOpen(true)}>
          ＋ From Pursuits
        </button>
      </div>

      {/* Planner */}
      <div
        className="dp-planner"
        ref={rootRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="dp-cal-wrap">
          <div
            className="dp-cal-area"
            ref={calAreaRef}
            style={{ height: areaHeight }}
            onMouseMove={onCalMouseMove}
            onMouseLeave={onCalMouseLeave}
          >
            {lines}
            {isToday && nowVisible && (
              <div className="dp-nowline" style={{ top: (now - AX_START) * PXPM }} />
            )}
            {placed.length === 0 && (
              <div className="dp-cal-empty">
                Your day is empty.
                <br />
                Drag a task from the right onto a time →
              </div>
            )}
            {placed.map((t) => {
              const top = ((t.startMin ?? 0) - AX_START) * PXPM
              const start = t.startMin ?? 0

              // ── Work block: a resizable container holding sequential tasks ──
              if (t.kind === 'work') {
                const kids = childrenByParent.get(t.id) ?? []
                const span = Math.max(t.durationMin, childDurSum(t.id), 5)
                const wh = Math.max(span * PXPM, 30)
                let cum = 0
                return (
                  <div
                    key={t.id}
                    data-block-id={t.id}
                    data-from="cal"
                    data-worktarget={t.id}
                    className="dp-work"
                    style={{ top, height: wh }}
                  >
                    <span className="dp-work-tag">
                      <span className="dp-work-title">▦ {t.title}</span>
                    </span>
                    {kids.length === 0 && <div className="dp-work-empty">drag tasks here</div>}
                    {kids.map((c) => {
                      const cTop = cum * PXPM
                      const cH = Math.max(c.durationMin * PXPM, 18)
                      const cStart = start + cum
                      cum += c.durationMin
                      return (
                        <div
                          key={c.id}
                          data-block-id={c.id}
                          data-from="nested"
                          className={'dp-child ' + blockClass(c) + (c.status === 'done' ? ' done' : '')}
                          style={{ top: cTop, height: cH }}
                        >
                          <span className="dp-b-time">{fmt(cStart)}</span>
                          <span className="dp-b-name">{c.title}</span>
                          {c.status === 'done' && <span className="dp-b-run">✓</span>}
                          {(c.landmark || c.task?.notes) && <span className="dp-b-pin">📍</span>}
                        </div>
                      )
                    })}
                    <div className="dp-resize" data-resize-id={t.id} title="Drag to change length" />
                  </div>
                )
              }

              const h = Math.max(t.durationMin * PXPM, 20)
              const energyCls = blockClass(t)
              const chipCls = energyCls
              const chipLbl = chipLabel(t)
              return (
                <div
                  key={t.id}
                  data-block-id={t.id}
                  data-from="cal"
                  className={
                    'dp-block ' + energyCls + (t.status === 'done' ? ' done' : '')
                  }
                  style={{ top, height: h }}
                >
                  <span className="dp-b-time">
                    {fmt(t.startMin ?? 0)}–{fmt((t.startMin ?? 0) + t.durationMin)} · {t.durationMin}m
                  </span>
                  <span className="dp-b-name">{t.title}</span>
                  <span className={'dp-chip ' + chipCls}>{chipLbl}</span>
                  {t.status === 'done' && <span className="dp-b-run">✓ done</span>}
                  {(t.landmark || t.task?.notes) && <span className="dp-b-pin">📍</span>}
                  <div className="dp-resize" data-resize-id={t.id} title="Drag to change length" />
                </div>
              )
            })}
            {/* Read-only focus-session history (completed Pomodoros). Transparent
                dashed rings drawn over the axis; pointer-events:none so they
                never interfere with dragging the planner blocks beneath them. */}
            {sessions.map((s) => {
              const top = (s.startMin - AX_START) * PXPM
              const h = Math.max(s.durationMin * PXPM, 16)
              return (
                <div
                  key={s.id}
                  className="dp-session"
                  style={{ top, height: h }}
                  title={`${fmt(s.startMin)}–${fmt(s.startMin + s.durationMin)} · focus session`}
                >
                  <span className="dp-session-tag">
                    ✓ {s.title ?? 'Focus'} · {s.durationMin}m
                  </span>
                </div>
              )
            })}
            <div ref={guideRef} className="dp-dropguide" style={{ display: 'none' }} />
            <div ref={hoverGuideRef} className="dp-hoverguide" style={{ display: 'none' }} />
          </div>
        </div>

        <div className="dp-rightcol">
          <div className="dp-taskbox">
            <div className="dp-box-head">
              <h3>Tasks — drag onto the day →</h3>
              {boxed.length > 0 && (
                <button
                  type="button"
                  className="dp-pushall"
                  title="Move every task in this box to tomorrow"
                  disabled={rescheduleBoxM.isPending}
                  onClick={() =>
                    rescheduleBoxM.mutate({
                      fromDate: selectedDate,
                      toDate: addDaysISO(selectedDate, 1),
                    })
                  }
                >
                  → Tomorrow
                </button>
              )}
            </div>
            <div className="dp-box" ref={boxRef}>
              {boxed.length === 0 ? (
                <div className="dp-box-empty">
                  All placed 🎉 — drag any block back here to un-schedule it.
                </div>
              ) : (
                boxed.map((t) => {
                  const sub = t.kind === 'task' ? t.energy : t.kind
                  return (
                    <div
                      key={t.id}
                      data-block-id={t.id}
                      data-from="box"
                      className={'dp-boxcard ' + blockClass(t)}
                    >
                      <div className="dp-bc-top">
                        <span className="dp-bc-name">
                          {kindIcon(t.kind)}
                          {t.title}
                        </span>
                      </div>
                      <div className="dp-bc-sub">
                        {t.durationMin} min · {sub}
                      </div>
                      <div className="dp-bc-push">
                        <button
                          type="button"
                          className="dp-bc-pushbtn"
                          title="Push this task to tomorrow"
                          onClick={() =>
                            rescheduleM.mutate({ id: t.id, date: addDaysISO(selectedDate, 1) })
                          }
                        >
                          → tomorrow
                        </button>
                        <label className="dp-bc-datewrap" title="Move this task to a specific day">
                          <span className="dp-bc-datebtn">📅 date</span>
                          <input
                            type="date"
                            className="dp-bc-date"
                            min={todayISO()}
                            value=""
                            onChange={(e) => {
                              if (e.target.value)
                                rescheduleM.mutate({ id: t.id, date: e.target.value })
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="dp-taskbox" style={{ marginTop: '1rem' }}>
            <h3>✓ Finished today</h3>
            <div>
              {finished.length === 0 ? (
                <div className="dp-box-empty">Finish a task and it lands here. 🎉</div>
              ) : (
                finished.map((t) => (
                  <div key={t.id} className={'dp-fincard ' + (t.energy as Energy)}>
                    <div className="dp-bc-top">
                      <span className="dp-bc-name">✓ {t.title}</span>
                    </div>
                    <div className="dp-fc-sub">
                      {t.placed ? fmt(t.startMin ?? 0) + ' · ' : ''}
                      {t.durationMin} min
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Element palette — drag a template onto the time axis to create it. */}
          <div className="dp-taskbox" style={{ marginTop: '1rem' }}>
            <h3>Blocks — drag onto the day →</h3>
            <div className="dp-palette">
              <div className="dp-palcard work" data-palette="work" title="Drag onto the time axis">
                <span className="dp-pal-name">▦ Work block</span>
                <span className="dp-pal-sub">a container — drop tasks inside it</span>
              </div>
              <div className="dp-palcard meal" data-palette="meal:60" title="Drag onto the time axis">
                <span className="dp-pal-name">🍽 Large meal</span>
                <span className="dp-pal-sub">1 hour</span>
              </div>
              <div className="dp-palcard meal" data-palette="meal:15" title="Drag onto the time axis">
                <span className="dp-pal-name">🍽 Small meal</span>
                <span className="dp-pal-sub">15 min</span>
              </div>
              <div className="dp-palcard break" data-palette="break:60" title="Drag onto the time axis">
                <span className="dp-pal-name">☕ Large break</span>
                <span className="dp-pal-sub">1 hour</span>
              </div>
              <div className="dp-palcard break" data-palette="break:15" title="Drag onto the time axis">
                <span className="dp-pal-name">☕ Small break</span>
                <span className="dp-pal-sub">15 min</span>
              </div>
              <div className="dp-palcard read" data-palette="read:30" title="Drag onto the time axis">
                <span className="dp-pal-name">📖 Read block</span>
                <span className="dp-pal-sub">30 min</span>
              </div>
              <div
                className="dp-palcard meditation"
                data-palette="meditation:15"
                title="Drag onto the time axis"
              >
                <span className="dp-pal-name">🧘 Meditation</span>
                <span className="dp-pal-sub">15 min</span>
              </div>
            </div>
          </div>

          {/* Recurring commitments — fixed obligations that auto-schedule
              themselves onto matching days. Click to manage the templates. */}
          <div className="dp-taskbox" style={{ marginTop: '1rem' }}>
            <h3>Recurring</h3>
            <button
              type="button"
              className="dp-commit-open"
              onClick={() => setCommitmentsOpen(true)}
            >
              <span className="dp-commit-open-title">🔁 Manage commitments</span>
              <span className="dp-commit-open-sub">
                {commitments.length === 0
                  ? 'weekly / biweekly — auto-scheduled'
                  : `${commitments.length} set — click to edit`}
              </span>
            </button>
            {commitments.length > 0 && (
              <div className="dp-commit-list">
                {commitments.map((c) => (
                  <div
                    key={c.id}
                    className={'dp-commit-mini' + (c.active ? '' : ' off')}
                  >
                    <span className="dp-commit-mini-name">{c.title}</span>
                    <span className="dp-commit-mini-sub">{summarizeCommit(c)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {detailBlock && (
        <BlockDetail
          key={detailBlock.id}
          block={detailBlock}
          placed={placed}
          minDur={detailBlock.kind === 'work' ? Math.max(5, childDurSum(detailBlock.id)) : 5}
          onClose={() => setDetailId(null)}
        />
      )}

      {pickerOpen && (
        <PursuitsPickerOverlay date={selectedDate} onClose={() => setPickerOpen(false)} />
      )}

      {commitmentsOpen && (
        <CommitmentsOverlay
          commitments={commitments}
          onClose={() => setCommitmentsOpen(false)}
        />
      )}
    </div>
  )
}

// ── Detail modal ─────────────────────────────────────────────────────────────
// A keyed child so local edit state resets when a different block opens.
function BlockDetail({
  block,
  placed,
  minDur,
  onClose,
}: {
  block: Block
  placed: Block[]
  minDur: number
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const invalidate = () => void utils.dayPlanner.today.invalidate()
  const updateM = trpc.dayPlanner.update.useMutation({ onSettled: invalidate })
  const moveM = trpc.dayPlanner.move.useMutation({ onSettled: invalidate })
  const setDoneM = trpc.dayPlanner.setDone.useMutation({ onSettled: invalidate })
  const unplaceM = trpc.dayPlanner.unplace.useMutation({ onSettled: invalidate })
  const removeM = trpc.dayPlanner.remove.useMutation({ onSettled: invalidate })
  // Editing the context box of a task block writes to the task's own notes, so
  // it stays in sync with Pursuits / Focus — not just this planner block.
  const taskUpdateM = trpc.task.update.useMutation({
    onSettled: () => {
      void utils.dayPlanner.today.invalidate()
      void utils.task.invalidate()
    },
  })

  const [title, setTitle] = useState(block.title)
  const [dur, setDur] = useState(block.durationMin)
  const [energy, setEnergy] = useState<Energy>(block.energy as Energy)
  // The "Context" box edits the linked task's notes when there is a task; pauses
  // and goal-only blocks (no taskId) fall back to the block's own landmark note.
  const [note, setNote] = useState(block.taskId ? (block.task?.notes ?? '') : (block.landmark ?? ''))

  const isPause = block.kind === 'pause'
  const isWork = block.kind === 'work'
  // Fixed-purpose marker blocks: no task, no energy, no focus/done.
  const isBasic = ['pause', 'meal', 'break', 'read', 'meditation', 'commitment'].includes(block.kind)
  const isDone = block.status === 'done'

  function commitTitle() {
    const v = title.trim()
    if (v && v !== block.title) updateM.mutate({ id: block.id, title: v })
  }
  function commitDur(value: number) {
    const d = Math.max(minDur, value || minDur)
    setDur(d)
    updateM.mutate({ id: block.id, durationMin: d })
    // Re-resolve overlaps if the block is on the axis.
    if (block.placed && block.startMin != null) {
      const resolved = resolveStart(d, block.startMin, placed, block.id)
      if (resolved !== block.startMin) moveM.mutate({ id: block.id, startMin: resolved })
    }
  }
  function commitEnergy(value: Energy) {
    setEnergy(value)
    updateM.mutate({ id: block.id, energy: value })
  }
  function commitNote() {
    if (block.taskId) {
      if (note !== (block.task?.notes ?? '')) {
        taskUpdateM.mutate({ id: block.taskId, notes: note.trim() || null })
      }
    } else if (note !== (block.landmark ?? '')) {
      updateM.mutate({ id: block.id, landmark: note.trim() || null })
    }
  }

  return (
    <div
      className="dp-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <style>{DP_CSS}</style>
      <div className="dp-modal">
        <button className="dp-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <input
          className="dp-modal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          spellCheck={false}
        />
        <div className="dp-modal-when">
          {block.placed && block.startMin != null
            ? `${fmt(block.startMin)}–${fmt(block.startMin + block.durationMin)}`
            : 'in the task box'}
        </div>

        <div className="dp-d-grid">
          <label>Duration</label>
          <span>
            <input
              type="number"
              min={5}
              value={dur}
              onChange={(e) => setDur(parseInt(e.target.value, 10) || 0)}
              onBlur={(e) => commitDur(parseInt(e.target.value, 10) || 0)}
              className="dp-dur-in"
            />{' '}
            min
          </span>
          {!isWork && !isBasic && (
            <>
              <label>Energy</label>
              <span>
                <select
                  value={energy}
                  onChange={(e) => commitEnergy(e.target.value as Energy)}
                  className="dp-select"
                  disabled={isPause}
                >
                  <option value="high">🔋 high focus</option>
                  <option value="med">steady</option>
                  <option value="low">🪫 low</option>
                  <option value="fun">✨ fun</option>
                </select>
              </span>
            </>
          )}
        </div>

        {/* Actions: done/reopen for any single block (tasks, pauses, meals,
            breaks, reads, meditations, commitments) — not work containers.
            Focus mode runs on task blocks (the task) or goal blocks (the goal). */}
        {!isWork && (
          <div className="dp-modal-actions">
            {isDone ? (
              <button
                className="dp-btn"
                onClick={() => setDoneM.mutate({ id: block.id, done: false })}
              >
                ↺ reopen
              </button>
            ) : (
              <button
                className="dp-btn dp-primary"
                onClick={() => {
                  setDoneM.mutate({ id: block.id, done: true })
                }}
              >
                ✓ done
              </button>
            )}
            {block.taskId && (
              <button
                className="dp-btn dp-focus"
                onClick={() => {
                  openFocusMode(block.taskId!)
                  onClose()
                }}
              >
                ▶ Focus mode
              </button>
            )}
            {/* Goal blocks focus the goal directly (time rolls up the hierarchy). */}
            {!block.taskId && block.goalId && (
              <button
                className="dp-btn dp-focus"
                onClick={() => {
                  openFocusMode({ kind: 'goal', id: block.goalId! })
                  onClose()
                }}
              >
                ▶ Focus mode
              </button>
            )}
          </div>
        )}

        {!isWork && (
          <div className="dp-landmark-box">
            <label>📝 Context — notes for this task</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={commitNote}
              placeholder="Anything that helps you pick this up: links, the next step, where you left off…"
            />
          </div>
        )}

        {/* Subtasks — only for real task blocks (they edit the underlying Task,
            shared with Pursuits). Each subtask can be checked off and focused. */}
        {block.taskId && <SubtaskList taskId={block.taskId} onClose={onClose} />}

        <div className="dp-modal-foot">
          {block.placed ? (
            <button
              className="dp-btn"
              onClick={() => {
                unplaceM.mutate({ id: block.id })
                onClose()
              }}
            >
              ↩ back to task box
            </button>
          ) : (
            <span />
          )}
          <button
            className="dp-btn dp-danger"
            onClick={() => {
              removeM.mutate({ id: block.id })
              onClose()
            }}
          >
            delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Subtask checklist (inside the detail modal, for real task blocks) ─────────
// Reads/writes the underlying Task's subtasks, so they're the same ones Pursuits
// and Focus mode show. Each row can be checked off or opened in Focus mode.
function SubtaskList({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: subs = [] } = trpc.task.subtasks.useQuery({ parentId: taskId })
  const invalidate = () => {
    void utils.task.subtasks.invalidate({ parentId: taskId })
    void utils.task.invalidate()
  }
  const createM = trpc.task.create.useMutation({ onSettled: invalidate })
  const completeM = trpc.task.complete.useMutation({ onSettled: invalidate })
  const uncompleteM = trpc.task.uncomplete.useMutation({ onSettled: invalidate })

  const [name, setName] = useState('')
  function add() {
    const title = name.trim()
    if (!title || createM.isPending) return
    createM.mutate({ title, parentTaskId: taskId })
    setName('')
  }

  return (
    <div className="dp-subtasks">
      <label>✓ Subtasks</label>
      {subs.length === 0 ? (
        <div className="dp-sub-empty">No subtasks yet — break this into smaller steps.</div>
      ) : (
        subs.map((s) => {
          const done = s.status === 'done'
          return (
            <div key={s.id} className="dp-sub-row">
              <button
                type="button"
                className="dp-sub-check"
                onClick={() =>
                  done ? uncompleteM.mutate({ id: s.id }) : completeM.mutate({ id: s.id })
                }
                aria-label={done ? 'Mark not done' : 'Mark done'}
              >
                {done ? '☑' : '☐'}
              </button>
              <span className={'dp-sub-title' + (done ? ' done' : '')}>{s.title}</span>
              <button
                type="button"
                className="dp-sub-focus"
                title="Focus mode on this subtask"
                onClick={() => {
                  openFocusMode(s.id)
                  onClose()
                }}
              >
                ▶ focus
              </button>
            </div>
          )
        })
      )}
      <div className="dp-sub-add">
        <input
          className="dp-name-in"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder="add a subtask…"
        />
        <button type="button" className="dp-btn" onClick={add}>
          + add
        </button>
      </div>
    </div>
  )
}

// ── Recurring commitments manager (overlay) ──────────────────────────────────
// Create / edit / pause / delete the recurring templates. New & edited templates
// auto-schedule onto matching future days; days already laid out stay as they
// are (per-day edits stick). Closes on backdrop click or ×.
const minToTime = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
const timeToMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function CommitmentsOverlay({
  commitments,
  onClose,
}: {
  commitments: Commitment[]
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const invalidate = () => {
    void utils.commitment.list.invalidate()
    void utils.dayPlanner.today.invalidate()
  }
  const createM = trpc.commitment.create.useMutation({ onSettled: invalidate })
  const updateM = trpc.commitment.update.useMutation({ onSettled: invalidate })
  const removeM = trpc.commitment.remove.useMutation({ onSettled: invalidate })

  // The form doubles as add (editId === null) and edit (editId set).
  const [editId, setEditId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('09:00')
  const [dur, setDur] = useState(30)
  const [freq, setFreq] = useState<'weekly' | 'biweekly'>('weekly')
  const [days, setDays] = useState<Set<number>>(new Set())
  // First day this commitment may schedule. "" = no limit (starts right away).
  const [startDate, setStartDate] = useState('')

  function resetForm() {
    setEditId(null)
    setTitle('')
    setTime('09:00')
    setDur(30)
    setFreq('weekly')
    setDays(new Set())
    setStartDate('')
  }

  function loadForEdit(c: Commitment) {
    setEditId(c.id)
    setTitle(c.title)
    setTime(minToTime(c.startMin))
    setDur(c.durationMin)
    setFreq(c.frequency === 'biweekly' ? 'biweekly' : 'weekly')
    setDays(new Set(parseWeekdays(c.weekdays)))
    setStartDate(c.startDate ?? '')
  }

  function toggleDay(n: number) {
    setDays((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  const canSave = title.trim().length > 0 && days.size > 0 && dur >= 5
  function save() {
    if (!canSave || createM.isPending || updateM.isPending) return
    const payload = {
      title: title.trim(),
      startMin: timeToMin(time),
      durationMin: dur,
      frequency: freq,
      weekdays: [...days],
      startDate,
    }
    if (editId) updateM.mutate({ id: editId, ...payload })
    else createM.mutate(payload)
    resetForm()
  }

  return (
    <div
      className="dp-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <style>{DP_CSS}</style>
      <div className="dp-modal">
        <button className="dp-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dp-modal-title" style={{ cursor: 'default' }}>
          🔁 Recurring commitments
        </div>
        <div className="dp-modal-when">
          Fixed obligations that schedule themselves onto matching days.
        </div>

        {/* Existing commitments */}
        {commitments.length === 0 ? (
          <div className="dp-sub-empty" style={{ margin: '.9rem 0' }}>
            None yet — add one below and it&apos;ll appear on every matching day.
          </div>
        ) : (
          <div className="dp-commit-rows">
            {commitments.map((c) => (
              <div key={c.id} className={'dp-commit-row' + (c.active ? '' : ' off')}>
                <div className="dp-commit-row-main">
                  <span className="dp-commit-row-name">{c.title}</span>
                  <span className="dp-commit-row-sub">{summarizeCommit(c)}</span>
                </div>
                <div className="dp-commit-row-acts">
                  <button
                    type="button"
                    className="dp-commit-iconbtn"
                    title={c.active ? 'Pause (stop auto-scheduling)' : 'Resume'}
                    onClick={() => updateM.mutate({ id: c.id, active: !c.active })}
                  >
                    {c.active ? '⏸' : '▶'}
                  </button>
                  <button
                    type="button"
                    className="dp-commit-iconbtn"
                    title="Edit"
                    onClick={() => loadForEdit(c)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="dp-commit-iconbtn danger"
                    title="Delete commitment"
                    onClick={() => {
                      if (editId === c.id) resetForm()
                      removeM.mutate({ id: c.id })
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add / edit form */}
        <div className="dp-commit-form">
          <div className="dp-commit-form-head">{editId ? 'Edit commitment' : 'New commitment'}</div>
          <input
            className="dp-name-in"
            style={{ width: '100%' }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Gym, Team standup, Language class…"
            spellCheck={false}
          />

          <div className="dp-commit-days">
            {WD_ORDER.map((n) => (
              <button
                key={n}
                type="button"
                className={'dp-commit-day' + (days.has(n) ? ' on' : '')}
                title={WD_LONG[n]}
                onClick={() => toggleDay(n)}
              >
                {WD_SHORT[n]}
              </button>
            ))}
          </div>

          <div className="dp-commit-grid">
            <label>Time</label>
            <input
              type="time"
              className="dp-dur-in"
              style={{ width: 'auto' }}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <label>Length</label>
            <span>
              <input
                type="number"
                min={5}
                step={5}
                className="dp-dur-in"
                value={dur}
                onChange={(e) => setDur(parseInt(e.target.value, 10) || 0)}
              />{' '}
              min
            </span>
            <label>Repeats</label>
            <select
              className="dp-select"
              value={freq}
              onChange={(e) => setFreq(e.target.value as 'weekly' | 'biweekly')}
            >
              <option value="weekly">every week</option>
              <option value="biweekly">every other week</option>
            </select>
            <label>Starts</label>
            <span className="dp-commit-start">
              <input
                type="date"
                className="dp-dur-in"
                style={{ width: 'auto' }}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              {startDate ? (
                <button type="button" className="dp-commit-clear" onClick={() => setStartDate('')}>
                  clear
                </button>
              ) : (
                <span className="dp-commit-hint">now</span>
              )}
            </span>
          </div>

          <div className="dp-commit-form-foot">
            {editId && (
              <button type="button" className="dp-btn" onClick={resetForm}>
                cancel
              </button>
            )}
            <button
              type="button"
              className="dp-btn dp-primary"
              disabled={!canSave}
              onClick={save}
            >
              {editId ? 'Save changes' : '+ Add commitment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Self-contained styles (warm-paper palette from the HTML source) ───────────
const DP_CSS = `
.dp-root{
  --paper:#FBF9F5; --paper-2:#F4F0E8; --paper-3:#EFEADF; --paper-deep:#E8E2D5;
  --card:#FFFFFF;
  --ink:#2B2723; --ink-soft:#5C554C; --ink-faint:#8A8175;
  --rule:#E7E0D5; --halfrule:#efe7d8;
  --accent:#B5762A; --accent-soft:#F3E7D3; --accent-strong:#9c6322;
  --slate:#44607A; --slate-soft:#E4EAF1;
  --amber:#B8861A; --amber-soft:#F8EDCD;
  --orange:#BE5F1E; --orange-soft:#F8E2CF;
  --teal:#2E7268; --teal-soft:#DBEAE6; --teal-strong:#255c54;
  --meal:#B86B2E; --meal-soft:#F7E5D0;
  --break:#5B7B4F; --break-soft:#E4EBDC;
  --read:#5A5B8C; --read-soft:#E6E5F1;
  --medit:#8A5B86; --medit-soft:#F0E6EF;
  --commit:#A8456A; --commit-soft:#F8E2EA;
  --chip-high-ink:#8a6410; --chip-med-ink:#8a5a18;
  --on-accent:#fff; --on-teal:#fff;
  --carve:inset 0 2px 5px rgba(43,39,35,.12),inset 0 -1px 0 rgba(255,255,255,.55);
  --serif:'Iowan Old Style','Palatino Linotype','Palatino','Georgia',serif;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;
  --mono:'SF Mono','Menlo','Consolas','Liberation Mono',monospace;
  background:var(--paper); color:var(--ink); font-family:var(--sans);
  height:100%; overflow:auto; padding:1.1rem 1.2rem 1.6rem; border-radius:12px;
}
.dp-root *{box-sizing:border-box;}
body.dp-is-dragging{cursor:grabbing;user-select:none;}
.dp-daynav{display:flex;align-items:center;gap:.5rem;margin:0 0 .5rem;}
.dp-h2{font-family:var(--serif);font-weight:600;line-height:1.15;margin:0;color:var(--ink);cursor:grab;user-select:none;display:flex;flex-direction:column;}
.dp-h2:active{cursor:grabbing;}
.dp-day-weekday{font-size:1.4rem;}
.dp-day-date{font-family:var(--mono);font-size:.78rem;font-weight:500;color:var(--ink-faint);letter-spacing:.01em;}
.dp-navbtn{font-family:var(--serif);font-size:1.5rem;line-height:1;cursor:pointer;border:1px solid var(--rule);background:var(--card);color:var(--ink-soft);border-radius:999px;width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;padding:0 0 .15rem;transition:.13s;flex:none;}
.dp-navbtn:hover{border-color:var(--accent);color:var(--accent);}
.dp-today-jump{margin-left:.35rem;font-size:.8rem;padding:.3rem .7rem;}

.dp-root input,.dp-root select,.dp-root textarea{font-family:var(--sans);font-size:.92rem;color:var(--ink);background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:.4rem .55rem;}
.dp-root input:focus,.dp-root select:focus,.dp-root textarea:focus{outline:none;border-color:var(--accent);}
.dp-name-in{flex:1;min-width:140px;}
.dp-dur-wrap{display:flex;align-items:center;gap:.25rem;font-size:.8rem;color:var(--ink-faint);}
.dp-dur-in{width:64px;}

.dp-btn{font-family:var(--sans);font-size:.88rem;font-weight:600;cursor:pointer;border-radius:999px;border:1px solid var(--rule);background:var(--card);color:var(--ink);padding:.42rem .85rem;transition:.13s;}
.dp-btn:hover{border-color:var(--accent);color:var(--accent);}
.dp-primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);}
.dp-primary:hover{background:var(--accent-strong);color:var(--on-accent);}
.dp-focus{background:var(--teal);border-color:var(--teal);color:var(--on-teal);}
.dp-focus:hover{background:var(--teal-strong);color:var(--on-teal);}
.dp-from{margin-left:auto;}
.dp-danger{color:var(--orange);} .dp-danger:hover{border-color:var(--orange);color:var(--orange);}

.dp-controls{background:var(--paper-2);border:1px solid var(--rule);border-radius:12px;padding:1rem 1.1rem;margin-bottom:1rem;display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;}

.dp-planner{display:grid;grid-template-columns:1fr 260px;gap:1rem;align-items:start;touch-action:none;}
@media (max-width:680px){.dp-planner{grid-template-columns:1fr;}}
.dp-cal-wrap{position:relative;border:1px solid var(--rule);border-radius:12px;background:var(--paper-2);}
.dp-cal-area{position:relative;}
.dp-hourline{position:absolute;left:54px;right:0;border-top:1px solid var(--rule);}
.dp-halfline{position:absolute;left:54px;right:0;border-top:1px dashed var(--halfrule);}
.dp-hourlabel{position:absolute;left:8px;transform:translateY(-50%);font-family:var(--mono);font-size:.72rem;color:var(--ink-faint);}
.dp-nowline{position:absolute;left:54px;right:0;border-top:2px solid var(--orange);z-index:3;}
.dp-nowline::before{content:"now";position:absolute;left:-2px;top:-8px;background:var(--orange);color:#fff;font-size:.6rem;font-weight:700;padding:0 .25rem;border-radius:3px;}
.dp-cal-empty{position:absolute;left:54px;right:6px;top:40%;text-align:center;color:var(--ink-faint);font-style:italic;font-size:.9rem;pointer-events:none;}

/* ── Placed blocks — Carved-in style (box style #2) ─────────────────────────── */
/* Per-kind accent + fill tokens — same pattern as the mockup's --ac / --soft. */
.dp-block{--b-ac:var(--accent);--b-soft:var(--accent-soft);}
.dp-block.high{--b-ac:var(--amber);--b-soft:var(--amber-soft);}
.dp-block.low{--b-ac:var(--slate);--b-soft:var(--slate-soft);}
.dp-block.fun{--b-ac:var(--teal);--b-soft:var(--teal-soft);}
.dp-block.pause{--b-ac:var(--ink-faint);--b-soft:var(--paper-3);}
.dp-block.meal{--b-ac:var(--meal);--b-soft:var(--meal-soft);}
.dp-block.break{--b-ac:var(--break);--b-soft:var(--break-soft);}
.dp-block.read{--b-ac:var(--read);--b-soft:var(--read-soft);}
.dp-block.meditation{--b-ac:var(--medit);--b-soft:var(--medit-soft);}
.dp-block.commitment{--b-ac:var(--commit);--b-soft:var(--commit-soft);}
/* Carved-in base geometry */
.dp-block{position:absolute;left:58px;right:7px;border-radius:7px;padding:.2rem .5rem;overflow:hidden;cursor:grab;
  background:color-mix(in srgb,var(--b-soft) 72%,var(--paper-deep));
  border:0.5px solid color-mix(in srgb,var(--b-ac) 16%,transparent);
  border-left:1px solid var(--b-ac);
  box-shadow:var(--carve);
  font-size:.84rem;line-height:1.2;display:flex;flex-direction:row;align-items:center;gap:.45rem;
  transition:border-color .12s,box-shadow .12s;}
.dp-block:active{cursor:grabbing;}
/* Hover: border sharpens to full accent colour + subtle brightness lift */
.dp-block:hover{border-color:var(--b-ac);}
.dp-b-time{font-family:var(--mono);font-size:.7rem;color:var(--ink-soft);flex:none;white-space:nowrap;}
.dp-b-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;}
.dp-b-pin{flex:none;}
.dp-b-run{font-family:var(--mono);font-weight:700;font-size:.72rem;color:var(--teal);}
.dp-block.done{opacity:.55;}
.dp-block.done .dp-b-name{text-decoration:line-through;}
.dp-resize{position:absolute;left:0;right:0;bottom:0;height:9px;cursor:ns-resize;z-index:2;}
.dp-resize::after{content:"";position:absolute;left:50%;bottom:2px;transform:translateX(-50%);width:24px;height:2px;border-radius:2px;background:var(--ink-faint);opacity:.3;}
.dp-block:hover .dp-resize::after,.dp-child:hover .dp-resize::after{opacity:.6;}

/* Work block — a container on the axis; tasks nest inside it as time slots. */
.dp-work{position:absolute;left:58px;right:7px;border-radius:10px;border:1.5px dashed var(--accent);background:var(--paper-3);cursor:grab;overflow:hidden;}
.dp-work:active{cursor:grabbing;}
.dp-work-tag{position:absolute;top:3px;right:6px;display:flex;align-items:center;gap:.4rem;background:var(--card);border:1px solid var(--rule);border-radius:7px;padding:.06rem .38rem;z-index:2;pointer-events:none;max-width:calc(100% - 12px);overflow:hidden;}
.dp-work-title{font-weight:700;font-size:.74rem;color:var(--accent-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dp-work-empty{position:absolute;left:8px;right:8px;top:50%;transform:translateY(-50%);text-align:center;color:var(--ink-faint);font-style:italic;font-size:.78rem;pointer-events:none;}
/* ── Nested child blocks (inside a work container) — same carved-in treatment ── */
.dp-child{--b-ac:var(--accent);--b-soft:var(--accent-soft);}
.dp-child.high{--b-ac:var(--amber);--b-soft:var(--amber-soft);}
.dp-child.low{--b-ac:var(--slate);--b-soft:var(--slate-soft);}
.dp-child.fun{--b-ac:var(--teal);--b-soft:var(--teal-soft);}
.dp-child.pause{--b-ac:var(--ink-faint);--b-soft:var(--paper-3);}
.dp-child.meal{--b-ac:var(--meal);--b-soft:var(--meal-soft);}
.dp-child.break{--b-ac:var(--break);--b-soft:var(--break-soft);}
.dp-child.read{--b-ac:var(--read);--b-soft:var(--read-soft);}
.dp-child.meditation{--b-ac:var(--medit);--b-soft:var(--medit-soft);}
.dp-child.commitment{--b-ac:var(--commit);--b-soft:var(--commit-soft);}
.dp-child{position:absolute;left:6px;right:6px;border-radius:7px;
  background:color-mix(in srgb,var(--b-soft) 72%,var(--paper-deep));
  border:0.5px solid color-mix(in srgb,var(--b-ac) 16%,transparent);
  border-left:1px solid var(--b-ac);
  box-shadow:var(--carve);
  padding:.1rem .45rem;font-size:.78rem;line-height:1.2;display:flex;align-items:center;gap:.4rem;overflow:hidden;cursor:grab;
  transition:border-color .12s;}
.dp-child:active{cursor:grabbing;}
.dp-child:hover{border-color:var(--b-ac);}
.dp-child .dp-b-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;}
.dp-child.done{opacity:.55;}
.dp-child.done .dp-b-name{text-decoration:line-through;}

/* Palette — draggable element templates (Work block, …). */
.dp-palette{display:grid;gap:.45rem;}
.dp-palcard{border:1.5px dashed var(--accent);border-radius:9px;background:var(--accent-soft);padding:.5rem .6rem;cursor:grab;display:flex;flex-direction:column;}
.dp-palcard:active{cursor:grabbing;}
.dp-pal-name{font-weight:700;font-size:.9rem;color:var(--accent-strong);}
.dp-pal-sub{font-size:.72rem;color:var(--ink-faint);margin-top:.1rem;}
.dp-palcard.meal{border-color:var(--meal);background:var(--meal-soft);}
.dp-palcard.meal .dp-pal-name{color:var(--meal);}
.dp-palcard.break{border-color:var(--break);background:var(--break-soft);}
.dp-palcard.break .dp-pal-name{color:var(--break);}
.dp-palcard.read{border-color:var(--read);background:var(--read-soft);}
.dp-palcard.read .dp-pal-name{color:var(--read);}
.dp-palcard.meditation{border-color:var(--medit);background:var(--medit-soft);}
.dp-palcard.meditation .dp-pal-name{color:var(--medit);}

/* Completed focus-session markers — a translucent history layer over the axis. */
.dp-session{position:absolute;left:58px;right:7px;border-radius:8px;border:1.5px dashed var(--teal);background:transparent;pointer-events:none;z-index:4;overflow:hidden;}
.dp-session-tag{position:absolute;top:2px;right:6px;font-family:var(--mono);font-size:.62rem;font-weight:700;color:var(--teal);background:var(--teal-soft);border-radius:5px;padding:.03rem .32rem;max-width:calc(100% - 12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

.dp-dropguide{position:absolute;left:54px;right:0;height:0;border-top:2px dashed var(--accent);z-index:5;pointer-events:none;}
.dp-dropguide::before{content:attr(data-t);position:absolute;left:-50px;top:-9px;font-family:var(--mono);font-size:.7rem;color:var(--accent);font-weight:700;}

/* Hover guide — shown over free timeline space on mousemove (not during drag). */
.dp-hoverguide{position:absolute;left:54px;right:0;height:2px;border-radius:2px;background:var(--slate);opacity:.65;z-index:5;pointer-events:none;}
.dp-hoverguide::before{content:attr(data-t);position:absolute;left:6px;top:-22px;background:var(--slate);color:#fff;font-family:var(--mono);font-size:.65rem;font-weight:700;border-radius:6px;padding:.12rem .42rem;white-space:nowrap;}

.dp-taskbox{border:1px solid var(--rule);border-radius:12px;background:var(--card);padding:.7rem;}
.dp-taskbox h3{margin:.1rem 0 .5rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);}
.dp-box{display:grid;gap:.45rem;min-height:30px;}
.dp-box-empty{color:var(--ink-faint);font-size:.82rem;font-style:italic;padding:.3rem;}
.dp-boxcard{border:1px solid var(--rule);border-radius:9px;background:var(--paper-2);padding:.5rem .6rem;cursor:grab;border-left:4px solid var(--accent);}
.dp-boxcard:active{cursor:grabbing;}
.dp-boxcard.high{border-left-color:var(--amber);}
.dp-boxcard.med{border-left-color:var(--accent);}
.dp-boxcard.low{border-left-color:var(--slate);}
.dp-boxcard.fun{border-left-color:var(--teal);}
.dp-boxcard.pause{border-left-color:var(--ink-faint);border-left-style:dashed;}
.dp-boxcard.meal{border-left-color:var(--meal);}
.dp-boxcard.break{border-left-color:var(--break);}
.dp-boxcard.read{border-left-color:var(--read);}
.dp-boxcard.meditation{border-left-color:var(--medit);}
.dp-boxcard.commitment{border-left-color:var(--commit);}
.dp-bc-top{display:flex;align-items:center;gap:.4rem;}
.dp-bc-name{font-weight:700;font-size:.9rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dp-bc-sub{font-size:.74rem;color:var(--ink-faint);margin-top:.15rem;}
/* Box header row: the "Tasks" heading + the bulk "→ Tomorrow" push button. */
.dp-box-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;}
.dp-box-head h3{margin:.1rem 0 .5rem;}
.dp-pushall{flex:none;font-family:var(--sans);font-size:.72rem;font-weight:700;cursor:pointer;border-radius:999px;border:1px solid var(--rule);background:var(--card);color:var(--ink-soft);padding:.22rem .55rem;transition:.13s;}
.dp-pushall:hover{border-color:var(--accent);color:var(--accent);}
.dp-pushall:disabled{opacity:.45;cursor:not-allowed;}
/* Per-card push controls: "→ tomorrow" + a calendar chip that opens a date picker. */
.dp-bc-push{display:flex;align-items:center;gap:.4rem;margin-top:.4rem;flex-wrap:wrap;}
.dp-bc-pushbtn{font-family:var(--sans);font-size:.7rem;font-weight:600;cursor:pointer;border-radius:999px;border:1px solid var(--rule);background:var(--card);color:var(--ink-soft);padding:.18rem .5rem;transition:.13s;}
.dp-bc-pushbtn:hover{border-color:var(--accent);color:var(--accent);}
.dp-bc-datewrap{position:relative;display:inline-flex;cursor:pointer;}
.dp-bc-datebtn{font-size:.7rem;font-weight:600;color:var(--ink-soft);border:1px solid var(--rule);background:var(--card);border-radius:999px;padding:.18rem .5rem;transition:.13s;pointer-events:none;}
.dp-bc-datewrap:hover .dp-bc-datebtn{border-color:var(--accent);color:var(--accent);}
.dp-bc-date{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;padding:0;border:none;}
.dp-fincard{border:1px solid var(--rule);border-left:4px solid var(--teal);border-radius:9px;background:var(--teal-soft);padding:.45rem .6rem;margin-bottom:.45rem;}
.dp-fc-sub{font-size:.74rem;color:var(--ink-soft);margin-top:.1rem;}

.dp-chip{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;border-radius:999px;padding:.08rem .42rem;flex:none;}
.dp-chip.high{background:var(--amber-soft);color:var(--chip-high-ink);}
.dp-chip.med{background:var(--accent-soft);color:var(--chip-med-ink);}
.dp-chip.low{background:var(--slate-soft);color:var(--slate);}
.dp-chip.fun{background:var(--teal-soft);color:var(--teal);}
.dp-chip.pause{background:var(--paper-3);color:var(--ink-faint);}
.dp-chip.meal{background:var(--meal-soft);color:var(--meal);}
.dp-chip.break{background:var(--break-soft);color:var(--break);}
.dp-chip.read{background:var(--read-soft);color:var(--read);}
.dp-chip.meditation{background:var(--medit-soft);color:var(--medit);}
.dp-chip.commitment{background:var(--commit-soft);color:var(--commit);}

.dp-overlay{position:fixed;inset:0;background:rgba(43,39,35,.5);display:flex;align-items:center;justify-content:center;padding:1.2rem;z-index:50;font-family:var(--sans);}
.dp-modal{background:var(--paper);border-radius:16px;max-width:540px;width:100%;max-height:88vh;overflow:auto;padding:1.5rem;box-shadow:0 24px 70px rgba(0,0,0,.3);color:var(--ink);}
.dp-close{float:right;border:none;background:none;font-size:1.4rem;cursor:pointer;color:var(--ink-faint);}
.dp-modal-title{font-family:var(--serif);font-size:1.3rem;font-weight:600;width:calc(100% - 2rem);border:1px solid transparent;border-radius:8px;padding:.2rem .4rem;background:transparent;}
.dp-modal-title:hover{border-color:var(--rule);}
.dp-modal-when{color:var(--ink-faint);font-family:var(--mono);font-size:.85rem;margin:.2rem 0 .2rem .4rem;}
.dp-d-grid{display:grid;grid-template-columns:auto 1fr;gap:.6rem 1rem;align-items:center;margin:.9rem 0;font-size:.9rem;}
.dp-d-grid label{color:var(--ink-faint);font-weight:600;}
.dp-modal-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin:.4rem 0;}
.dp-landmark-box{background:var(--amber-soft);border:1px solid var(--amber);border-radius:10px;padding:.7rem .8rem;margin:.9rem 0;}
.dp-landmark-box label{display:block;font-weight:700;font-size:.82rem;color:var(--chip-high-ink);margin-bottom:.3rem;}
.dp-landmark-box textarea{width:100%;min-height:48px;resize:vertical;}
.dp-modal-foot{display:flex;gap:.5rem;flex-wrap:wrap;justify-content:space-between;margin-top:.6rem;}

/* Subtask checklist in the detail modal. */
.dp-subtasks{border:1px solid var(--rule);border-radius:10px;background:var(--card);padding:.7rem .8rem;margin:.9rem 0;}
.dp-subtasks>label{display:block;font-weight:700;font-size:.82rem;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5rem;}
.dp-sub-empty{color:var(--ink-faint);font-size:.82rem;font-style:italic;margin-bottom:.5rem;}
.dp-sub-row{display:flex;align-items:center;gap:.5rem;padding:.18rem 0;}
.dp-sub-check{flex:none;border:none;background:none;cursor:pointer;font-size:1.05rem;line-height:1;color:var(--accent);padding:0;}
.dp-sub-title{flex:1;min-width:0;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dp-sub-title.done{text-decoration:line-through;color:var(--ink-faint);}
.dp-sub-focus{flex:none;font-family:var(--sans);font-size:.74rem;font-weight:600;cursor:pointer;border-radius:999px;border:1px solid var(--rule);background:var(--card);color:var(--teal);padding:.18rem .55rem;opacity:0;transition:.13s;}
.dp-sub-row:hover .dp-sub-focus{opacity:1;}
.dp-sub-focus:hover{border-color:var(--teal);background:var(--teal-soft);}
.dp-sub-add{display:flex;gap:.45rem;align-items:center;margin-top:.55rem;}
.dp-sub-add .dp-name-in{flex:1;}

/* Recurring commitments — the right-column box + its manager overlay. */
.dp-commit-open{width:100%;text-align:left;display:flex;flex-direction:column;gap:.12rem;cursor:pointer;border:1.5px dashed var(--commit);background:var(--commit-soft);border-radius:9px;padding:.55rem .65rem;transition:.13s;}
.dp-commit-open:hover{border-color:var(--commit);filter:brightness(.99);}
.dp-commit-open-title{font-weight:700;font-size:.9rem;color:var(--commit);}
.dp-commit-open-sub{font-size:.72rem;color:var(--ink-faint);}
.dp-commit-list{display:grid;gap:.35rem;margin-top:.5rem;}
.dp-commit-mini{border:1px solid var(--rule);border-left:4px solid var(--commit);border-radius:8px;background:var(--paper-2);padding:.35rem .5rem;}
.dp-commit-mini.off{opacity:.5;}
.dp-commit-mini-name{display:block;font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dp-commit-mini-sub{display:block;font-family:var(--mono);font-size:.68rem;color:var(--ink-faint);margin-top:.05rem;}

.dp-commit-rows{display:grid;gap:.45rem;margin:.9rem 0;}
.dp-commit-row{display:flex;align-items:center;gap:.5rem;border:1px solid var(--rule);border-left:4px solid var(--commit);border-radius:9px;background:var(--card);padding:.45rem .6rem;}
.dp-commit-row.off{opacity:.55;}
.dp-commit-row-main{flex:1;min-width:0;}
.dp-commit-row-name{display:block;font-weight:700;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dp-commit-row-sub{display:block;font-family:var(--mono);font-size:.72rem;color:var(--ink-faint);margin-top:.1rem;}
.dp-commit-row-acts{display:flex;gap:.2rem;flex:none;}
.dp-commit-iconbtn{border:1px solid var(--rule);background:var(--card);color:var(--ink-soft);border-radius:7px;width:1.9rem;height:1.9rem;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:.92rem;transition:.13s;}
.dp-commit-iconbtn:hover{border-color:var(--accent);color:var(--accent);}
.dp-commit-iconbtn.danger:hover{border-color:var(--orange);color:var(--orange);}

.dp-commit-form{border:1px solid var(--rule);border-radius:12px;background:var(--paper-2);padding:.9rem 1rem;margin-top:.9rem;display:flex;flex-direction:column;gap:.65rem;}
.dp-commit-form-head{font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint);}
.dp-commit-days{display:flex;gap:.3rem;flex-wrap:wrap;}
.dp-commit-day{flex:1;min-width:2.2rem;border:1px solid var(--rule);background:var(--card);color:var(--ink-soft);border-radius:8px;padding:.4rem 0;cursor:pointer;font-weight:700;font-size:.8rem;transition:.13s;}
.dp-commit-day:hover{border-color:var(--commit);color:var(--commit);}
.dp-commit-day.on{background:var(--commit);border-color:var(--commit);color:#fff;}
.dp-commit-grid{display:grid;grid-template-columns:auto 1fr;gap:.55rem .9rem;align-items:center;font-size:.9rem;}
.dp-commit-grid label{color:var(--ink-faint);font-weight:600;}
.dp-commit-form-foot{display:flex;gap:.5rem;justify-content:flex-end;}
.dp-commit-start{display:flex;align-items:center;gap:.5rem;}
.dp-commit-hint{font-size:.78rem;color:var(--ink-faint);font-style:italic;}
.dp-commit-clear{border:none;background:none;cursor:pointer;font-size:.76rem;color:var(--ink-faint);text-decoration:underline;padding:0;}
.dp-commit-clear:hover{color:var(--accent);}
.dp-btn:disabled{opacity:.45;cursor:not-allowed;}

/* ── Dark mode — only under the paper themes (per request). The module is
   self-contained, so we just re-point its palette to warm-tinted dark neutrals
   (clean charcoals, not muddy browns) and brighter accents for state. The
   modal + picker inherit these vars through the DOM, so they go dark too. */
html[data-mode="dark"][data-theme="paper-notebook"] .dp-root,
html[data-mode="dark"][data-theme="paper-bujo"] .dp-root,
html[data-mode="dark"][data-theme="paper-manuscript"] .dp-root,
html[data-mode="dark"][data-theme="almanac"] .dp-root{
  --paper:#1E1C1A; --paper-2:#262320; --paper-3:#2E2A25; --paper-deep:#181512;
  --card:#23211E;
  --ink:#ECE7DE; --ink-soft:#BCB4A7; --ink-faint:#928A7C;
  --carve:inset 0 2px 6px rgba(0,0,0,.45),inset 0 -1px 0 rgba(255,255,255,.04);
  --rule:#3A352E; --halfrule:#332F29;
  --accent:#D2954A; --accent-soft:#3A2D1B; --accent-strong:#E0A35A;
  --slate:#8AA8C6; --slate-soft:#243039;
  --amber:#D8A93E; --amber-soft:#3A3117;
  --orange:#E08A4A; --orange-soft:#3C2417;
  --teal:#54A99B; --teal-soft:#1D302C; --teal-strong:#66BAAC;
  --meal:#D98E4E; --meal-soft:#3A2A1A;
  --break:#8FB07E; --break-soft:#26301F;
  --read:#9A9BD0; --read-soft:#23222E;
  --medit:#C49AC0; --medit-soft:#2E2330;
  --commit:#D98FAC; --commit-soft:#33232B;
  --chip-high-ink:#E0B65A; --chip-med-ink:#DDA158;
  --on-accent:#211E19; --on-teal:#16221F;
}
`

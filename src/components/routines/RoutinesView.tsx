'use client'

/**
 * RoutinesView — the Routines tab.
 *
 * Lets you keep several named routines, each an ordered list of steps. Every
 * step has a duration (minutes) and may be pinned to a fixed clock time. From
 * those, each routine renders as a vertical timeline: a left gutter shows when
 * every step starts (and the routine's finish time at the bottom), with a live
 * "now" line drawn across the current moment. A "Copy" button exports the whole
 * routine as clean, readable text for pasting into WhatsApp etc.
 *
 * All data goes through the `routine` tRPC router (Prisma + Event log).
 */

import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { trpc } from '@/lib/trpc/client'
import { SortableList } from '@/components/shared/SortableList'

// ── Minimal shapes (only the fields the UI reads) ────────────────────────────

interface SubItem {
  id: string
  text: string
  position: number
}
interface Item {
  id: string
  text: string
  durationMin: number
  fixedTime: string | null
  position: number
  subItems: SubItem[]
}
interface Condition {
  id: string
  text: string
  position: number
}
interface Routine {
  id: string
  name: string
  // null = an unscheduled "do whenever" routine (timeline shows elapsed time).
  startTime: string | null
  items: Item[]
  // Non-timeline criteria (e.g. "no phone during"). Never shown on the timeline;
  // surface as extra checkboxes when the routine is attached to a habit.
  conditions: Condition[]
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function fmtClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function fmtDuration(min: number): string {
  if (min <= 0) return '0m'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}
/** Elapsed-time label (minutes since the routine's start): 0 → "0:00", 75 → "1:15". */
function fmtElapsed(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
/** A timeline mark: a wall-clock time normally, or elapsed time for a "whenever" routine. */
function fmtMark(min: number, elapsed: boolean): string {
  return elapsed ? fmtElapsed(min) : fmtClock(min)
}

interface Row {
  item: Item
  startMin: number
  endMin: number
}

/** Walk the items, flowing each from the previous end unless it's time-pinned.
 *  When `startTime` is null the routine is unscheduled: the timeline runs in
 *  elapsed minutes from 0 and per-item fixed clock times are ignored. */
function computeTimeline(startTime: string | null, items: Item[]): Row[] {
  const elapsed = startTime === null
  let cursor = elapsed ? 0 : toMin(startTime)
  return items.map((item) => {
    const startMin = !elapsed && item.fixedTime ? toMin(item.fixedTime) : cursor
    const endMin = startMin + (item.durationMin || 0)
    cursor = endMin
    return { item, startMin, endMin }
  })
}

// Timeline geometry — row height grows with duration, within bounds.
const PX_PER_MIN = 1.3
const MIN_ROW_H = 48
const MAX_ROW_H = 160
function rowHeight(durationMin: number): number {
  return Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, (durationMin || 0) * PX_PER_MIN))
}

/** Pixel offset (from the top of the body) where the "now" line should sit.
 *  Returns null when "now" is outside the routine's window (before it starts
 *  or after it ends) — in those cases no line is drawn. */
function nowOffset(rows: Row[], nowMin: number): number | null {
  if (rows.length === 0) return null
  if (nowMin < rows[0].startMin) return null // routine hasn't started yet
  let top = 0
  for (const r of rows) {
    const h = rowHeight(r.item.durationMin)
    if (nowMin < r.startMin) return top // in a gap between two steps
    if (nowMin < r.endMin) {
      const span = r.endMin - r.startMin
      const frac = span > 0 ? (nowMin - r.startMin) / span : 0
      return top + frac * h
    }
    top += h
  }
  return null // routine already finished
}

/** Current wall-clock time in minutes (with seconds), refreshed every 30s. */
function useNowMinutes(): number {
  const compute = () => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  }
  const [now, setNow] = useState(compute)
  useEffect(() => {
    const id = setInterval(() => setNow(compute()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Build the WhatsApp-friendly plain-text export for one routine. */
function formatForClipboard(routine: Routine, rows: Row[]): string {
  const elapsed = routine.startTime === null
  const lines: string[] = [`*${routine.name}*`, '']
  for (const r of rows) {
    const when =
      r.item.durationMin > 0
        ? `${fmtMark(r.startMin, elapsed)}–${fmtMark(r.endMin, elapsed)}`
        : fmtMark(r.startMin, elapsed)
    lines.push(`${when}  ${r.item.text}`)
  }
  if (rows.length > 0) {
    const total = rows[rows.length - 1].endMin - rows[0].startMin
    lines.push('', `Total: ${fmtDuration(total)}`)
  }
  return lines.join('\n')
}

// ── Top-level view ───────────────────────────────────────────────────────────

export function RoutinesView() {
  const [newName, setNewName] = useState('')
  const [newStart, setNewStart] = useState('')
  const utils = trpc.useUtils()
  const routinesQuery = trpc.routine.list.useQuery()
  const routines = routinesQuery.data ?? []

  const createRoutine = trpc.routine.create.useMutation({
    onSuccess: () => { setNewName(''); setNewStart(''); void utils.routine.list.invalidate() },
  })
  const reorderRoutines = trpc.routine.reorder.useMutation({
    onSettled: () => void utils.routine.list.invalidate(),
  })

  function addRoutine() {
    const n = newName.trim()
    if (!n) return
    // Leave the time blank → an unscheduled "do whenever" routine.
    createRoutine.mutate({ name: n, startTime: newStart || undefined })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1
        className="box-drag-handle cursor-grab active:cursor-grabbing select-none inline-block text-lg font-semibold text-ink uppercase tracking-wide mb-1"
        title="Drag to move · drag any edge to resize"
      >
        Routines
      </h1>
      <p className="text-muted text-xs mb-4">
        Build ordered routines with timings — then copy one to share it.
      </p>

      {/* New-routine box */}
      <div className="flex gap-2 mb-6">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addRoutine() }}
          placeholder="New routine name (e.g. Morning routine)…"
          className="flex-1 bg-base border border-ink/10 rounded-lg px-3 py-2
            text-sm text-ink placeholder:text-muted
            focus:outline-none focus:border-emerald"
        />
        <label className="flex items-center gap-1 text-xs text-muted shrink-0">
          starts
          <input
            type="time"
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRoutine() }}
            title="Leave blank for a 'do whenever' routine"
            className="bg-base border border-ink/10 rounded-lg px-2 py-2 text-sm text-ink
              focus:outline-none focus:border-emerald"
          />
          <span className="text-ink/30">(optional)</span>
        </label>
        <button
          type="button"
          onClick={addRoutine}
          disabled={createRoutine.isPending || !newName.trim()}
          className="text-sm px-4 py-2 rounded-lg bg-emerald text-white font-semibold
            hover:opacity-90 transition disabled:opacity-50"
        >
          Add routine
        </button>
      </div>

      {routines.length === 0 ? (
        <p className="text-muted text-sm py-6 text-center">
          No routines yet — create your first one above.
        </p>
      ) : (
        <SortableList
          ids={routines.map((r) => r.id)}
          onReorder={(orderedIds) => reorderRoutines.mutate({ orderedIds })}
          className="flex flex-col gap-6"
        >
          {routines.map((r) => (
            <RoutineCard key={r.id} routine={r} />
          ))}
        </SortableList>
      )}
    </div>
  )
}

// ── One routine ──────────────────────────────────────────────────────────────

function RoutineCard({ routine }: { routine: Routine }) {
  const utils = trpc.useUtils()
  const invalidate = () => void utils.routine.list.invalidate()

  const updateRoutine = trpc.routine.update.useMutation({ onSettled: invalidate })
  const setStartTime = trpc.routine.setStartTime.useMutation({ onSettled: invalidate })
  const setUnscheduled = trpc.routine.setUnscheduled.useMutation({ onSettled: invalidate })
  const removeRoutine = trpc.routine.remove.useMutation({ onSettled: invalidate })
  const addItem = trpc.routine.addItem.useMutation({ onSettled: invalidate })
  const reorderItems = trpc.routine.reorderItems.useMutation({ onSettled: invalidate })
  const addCondition = trpc.routine.addCondition.useMutation({ onSettled: invalidate })

  // A null startTime = an unscheduled "do whenever" routine: the timeline shows
  // elapsed time and the "starts" field is hidden.
  const elapsed = routine.startTime === null

  // The routine's TRUE start = the first step's start (its pinned time, else
  // the stored routine start). The "starts" field shows + edits this, so it
  // always matches the timeline even if routine.startTime drifts.
  const firstItem = routine.items[0]
  const effectiveStart = firstItem ? (firstItem.fixedTime ?? routine.startTime) : routine.startTime

  const [name, setName] = useState(routine.name)
  const [start, setStart] = useState(effectiveStart ?? '')
  const [copied, setCopied] = useState(false)
  const [adding, setAdding] = useState(false)
  // Routines open minimized by default — the tab shows a tidy list of titles you
  // expand on demand, rather than every full timeline at once.
  const [collapsed, setCollapsed] = useState(true)
  const [condText, setCondText] = useState('')

  // Keep the field in sync when the data changes (e.g. after a shift). Doesn't
  // fire mid-typing since effectiveStart only changes once a commit lands.
  useEffect(() => { setStart(effectiveStart ?? '') }, [effectiveStart])

  function commitStart() {
    if (start && start !== effectiveStart) setStartTime.mutate({ id: routine.id, startTime: start })
    else setStart(effectiveStart ?? '')
  }

  // Sortable wiring for the whole card (reorder routines).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: routine.id })
  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  const nowMin = useNowMinutes()
  const rows = computeTimeline(routine.startTime, routine.items)
  const lastEnd = rows.length ? rows[rows.length - 1].endMin : 0
  // A "whenever" routine isn't anchored to the wall clock, so there's no now-line.
  const offset = elapsed ? null : nowOffset(rows, nowMin)

  function commitName() {
    const n = name.trim()
    if (n && n !== routine.name) updateRoutine.mutate({ id: routine.id, name: n })
    else setName(routine.name)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatForClipboard(routine, rows))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked — nothing else to do.
    }
  }

  return (
    <div ref={setNodeRef} style={sortableStyle} className="rounded-xl border border-ink/10 bg-surface overflow-hidden">
      {/* Header — also the drag handle: grab anywhere on it (except the
          inputs) and drag to reorder routines. A plain click still works. */}
      <div
        {...attributes}
        {...listeners}
        className="flex items-center gap-2 px-4 py-3 border-b border-ink/10
          cursor-grab active:cursor-grabbing"
      >
        {/* Collapse / expand the whole routine */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="shrink-0 w-4 text-muted hover:text-ink transition-colors"
          aria-label={collapsed ? 'Expand routine' : 'Collapse routine'}
          title={collapsed ? 'Expand' : 'Minimize'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <input
          value={name}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { setName(routine.name); e.currentTarget.blur() }
          }}
          className="flex-1 bg-transparent text-base font-semibold text-ink cursor-text
            focus:outline-none focus:border-b focus:border-emerald"
        />
        {elapsed ? (
          <div className="flex items-center gap-1.5 text-xs text-muted shrink-0">
            <span className="italic">whenever</span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setStartTime.mutate({ id: routine.id, startTime: '06:00' })}
              className="underline decoration-dotted hover:text-emerald transition-colors"
              title="Give this routine a start time (switch to a scheduled routine)"
            >
              set time
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-1 text-xs text-muted shrink-0">
            starts
            <input
              type="time"
              value={start}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setStart(e.target.value)}
              onBlur={commitStart}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') { setStart(effectiveStart ?? ''); e.currentTarget.blur() }
              }}
              className="bg-base border border-ink/10 rounded px-1.5 py-0.5 text-xs text-ink cursor-text
                focus:outline-none focus:border-emerald"
            />
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setUnscheduled.mutate({ id: routine.id })}
              className="hover:text-ink transition-colors"
              title="Drop the start time (switch to a 'do whenever' routine)"
            >
              ✕
            </button>
          </label>
        )}
        <button
          type="button"
          onClick={copy}
          className="text-xs px-2.5 py-1 rounded border border-ink/30 text-muted
            hover:text-ink hover:border-ink/50 transition-all shrink-0"
          title="Copy this routine as text"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={() => { if (confirm(`Delete "${routine.name}"?`)) removeRoutine.mutate({ id: routine.id }) }}
          className="text-xs text-muted hover:text-red transition-colors shrink-0"
          aria-label="Delete routine"
          title="Delete routine"
        >
          ✕
        </button>
      </div>

      {/* Collapsed summary (when minimized) */}
      {collapsed && (
        <div className="px-4 py-2 text-xs text-muted">
          {rows.length} {rows.length === 1 ? 'step' : 'steps'}
          {rows.length > 0 && <span> · {fmtMark(rows[0].startMin, elapsed)}–{fmtMark(lastEnd, elapsed)}</span>}
          {routine.conditions.length > 0 && <span> · {routine.conditions.length} condition{routine.conditions.length === 1 ? '' : 's'}</span>}
        </div>
      )}

      {!collapsed && (
        <>
          {/* Timeline body */}
          <div className="relative px-3 py-2">
            {rows.length === 0 && !adding && (
              <p className="text-muted text-xs py-3 px-1">No steps yet — add one below.</p>
            )}

            <SortableList
              ids={rows.map((r) => r.item.id)}
              onReorder={(orderedIds) => reorderItems.mutate({ routineId: routine.id, orderedIds })}
            >
              {rows.map((r) => (
                <RoutineItemRow key={r.item.id} row={r} height={rowHeight(r.item.durationMin)} elapsed={elapsed} />
              ))}
            </SortableList>

            {/* Routine finish time */}
            {rows.length > 0 && (
              <div className="flex items-center">
                <div className="w-14 shrink-0 text-right pr-2">
                  <span className="text-[11px] tabular-nums text-muted font-medium">{fmtMark(lastEnd, elapsed)}</span>
                </div>
                <div className="flex-1 border-l border-ink/15 pl-3 py-1">
                  <span className="text-[11px] text-muted italic">finish</span>
                </div>
              </div>
            )}

            {/* Live "now" line — drawn across the current moment. The text label
                ("now HH:MM") carries the meaning, so it reads regardless of colour. */}
            {offset !== null && (
              <div
                className="absolute left-0 right-0 flex items-center pointer-events-none z-10"
                style={{ top: offset }}
              >
                <span
                  className="ml-1 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded text-white tabular-nums shrink-0"
                  style={{ background: 'var(--color-amber)' }}
                >
                  now {fmtClock(nowMin)}
                </span>
                <div className="flex-1 h-px -translate-y-1/2" style={{ background: 'var(--color-amber)' }} />
              </div>
            )}
          </div>

          {/* Add-step */}
          <div className="px-3 pb-3">
            {adding ? (
              <AddItemForm
                onCancel={() => setAdding(false)}
                onAdd={(payload) => addItem.mutate({ routineId: routine.id, ...payload })}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="text-xs px-2.5 py-1 rounded border border-ink/20 text-muted
                  hover:text-ink hover:border-ink/40 transition-all"
              >
                + Add step
              </button>
            )}
          </div>

          {/* Conditions — non-timeline criteria (e.g. "no phone during"). They
              never appear on the timeline above; when this routine is attached to
              a habit they become extra checkboxes in the habit's daily checklist. */}
          <div className="px-3 pb-3 border-t border-ink/10 pt-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted mb-1.5">
              Conditions
            </div>
            {routine.conditions.length > 0 && (
              <div className="flex flex-col gap-1 mb-2">
                {routine.conditions.map((c) => (
                  <ConditionRow key={c.id} condition={c} />
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const t = condText.trim()
                if (!t) return
                addCondition.mutate({ routineId: routine.id, text: t })
                setCondText('')
              }}
              className="flex items-center gap-2"
            >
              <span
                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-ink/10 text-muted"
                title="Conditions have no time — they're not on the timeline"
              >
                no-time
              </span>
              <input
                value={condText}
                onChange={(e) => setCondText(e.target.value)}
                placeholder="Add a condition (e.g. no phone during)…"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-faint
                  border-b border-ink/15 focus:border-emerald focus:outline-none py-0.5"
              />
              {condText.trim() && (
                <button
                  type="submit"
                  disabled={addCondition.isPending}
                  className="text-xs px-2 py-0.5 rounded border border-emerald text-emerald
                    hover:bg-emerald/10 disabled:opacity-50"
                >
                  Add
                </button>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  )
}

// ── One condition (display + inline edit) ────────────────────────────────────

function ConditionRow({ condition }: { condition: Condition }) {
  const utils = trpc.useUtils()
  const invalidate = () => void utils.routine.list.invalidate()
  const updateCondition = trpc.routine.updateCondition.useMutation({ onSettled: invalidate })
  const removeCondition = trpc.routine.removeCondition.useMutation({ onSettled: invalidate })

  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(condition.text)

  function commit() {
    const t = text.trim()
    if (t && t !== condition.text) updateCondition.mutate({ id: condition.id, text: t })
    else setText(condition.text)
    setEditing(false)
  }

  return (
    <div className="group flex items-center gap-2 text-sm">
      <span className="text-muted text-[11px] shrink-0">◇</span>
      {editing ? (
        <input
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { setText(condition.text); setEditing(false) }
          }}
          className="flex-1 bg-transparent text-ink border-b border-emerald focus:outline-none py-0.5"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-1 text-left text-ink cursor-text"
          title="Click to edit"
        >
          {condition.text}
        </button>
      )}
      <button
        type="button"
        onClick={() => removeCondition.mutate({ id: condition.id })}
        className="shrink-0 text-faint opacity-0 group-hover:opacity-100 hover:text-ink transition-opacity"
        aria-label="Remove condition"
        title="Remove"
      >
        ✕
      </button>
    </div>
  )
}

// ── One step (display + inline edit) ─────────────────────────────────────────

function RoutineItemRow({ row, height, elapsed }: { row: Row; height: number; elapsed: boolean }) {
  const utils = trpc.useUtils()
  const invalidate = () => void utils.routine.list.invalidate()
  const updateItem = trpc.routine.updateItem.useMutation({ onSettled: invalidate })
  const removeItem = trpc.routine.removeItem.useMutation({ onSettled: invalidate })
  const addSubItem = trpc.routine.addSubItem.useMutation({ onSettled: invalidate })

  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [subText, setSubText] = useState('')
  const [text, setText] = useState(row.item.text)
  const [duration, setDuration] = useState(String(row.item.durationMin))
  const [fixed, setFixed] = useState(row.item.fixedTime ?? '')

  const subItems = row.item.subItems ?? []

  // Sortable wiring for this step (reorder steps within the routine).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.item.id })
  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    minHeight: height,
  }

  function addSub() {
    const t = subText.trim()
    if (!t) return
    addSubItem.mutate({ itemId: row.item.id, text: t })
    setSubText('')
  }

  function save() {
    const t = text.trim()
    if (!t) return
    updateItem.mutate({
      id: row.item.id,
      text: t,
      durationMin: Math.max(0, parseInt(duration, 10) || 0),
      fixedTime: fixed ? fixed : null,
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <div ref={setNodeRef} style={sortableStyle} className="flex items-start">
        <div className="w-14 shrink-0" />
        <div className="flex-1 border-l border-ink/15 pl-3 py-2">
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
              placeholder="Step…"
              className="bg-base border border-ink/10 rounded px-2 py-1 text-sm text-ink
                focus:outline-none focus:border-emerald"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1 text-xs text-muted">
                takes
                <input
                  type="number"
                  min={0}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-16 bg-base border border-ink/10 rounded px-1.5 py-0.5 text-xs text-ink
                    focus:outline-none focus:border-emerald"
                />
                min
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                at
                <input
                  type="time"
                  value={fixed}
                  onChange={(e) => setFixed(e.target.value)}
                  className="bg-base border border-ink/10 rounded px-1.5 py-0.5 text-xs text-ink
                    focus:outline-none focus:border-emerald"
                />
                {fixed && (
                  <button type="button" onClick={() => setFixed('')} className="text-muted hover:text-ink" title="Clear fixed time">✕</button>
                )}
              </label>
              <div className="flex gap-1 ml-auto">
                <button type="button" onClick={save} className="text-xs px-2 py-1 rounded bg-emerald text-white font-semibold">Save</button>
                <button type="button" onClick={() => setEditing(false)} className="text-xs px-2 py-1 rounded border border-ink/20 text-muted hover:text-ink">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      {...attributes}
      {...listeners}
      className="flex items-stretch group cursor-grab active:cursor-grabbing"
    >
      {/* Gutter: start time + a dot on the timeline rule */}
      <div className="w-14 shrink-0 text-right pr-2 pt-1.5">
        <span className="text-[11px] tabular-nums text-ink font-medium">{fmtMark(row.startMin, elapsed)}</span>
      </div>
      <div className="relative flex-1 border-l border-ink/15 pl-3 py-1.5">
        {/* timeline dot */}
        <span
          className="absolute -left-[5px] top-2.5 w-2.5 h-2.5 rounded-full border-2 border-surface"
          style={{ background: row.item.fixedTime && !elapsed ? 'var(--color-amber)' : 'var(--color-emerald)' }}
        />
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex-1 min-w-0 text-left cursor-pointer"
            title="Click to expand its list"
          >
            <div className="text-sm text-ink break-words flex items-center gap-1.5">
              <span className="text-muted text-[10px] shrink-0 w-2">{expanded ? '▾' : '▸'}</span>
              <span>{row.item.text}</span>
              {subItems.length > 0 && (
                <span className="text-[10px] text-muted font-medium">({subItems.length})</span>
              )}
            </div>
            <div className="text-[11px] text-muted mt-0.5 pl-3.5">
              {row.item.fixedTime && !elapsed && <span className="mr-2">at {row.item.fixedTime}</span>}
              {row.item.durationMin > 0 && <span>{fmtDuration(row.item.durationMin)}</span>}
              {row.item.durationMin > 0 && <span className="text-ink/30"> · ends {fmtMark(row.endMin, elapsed)}</span>}
            </div>
          </button>
          {/* hover controls */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-muted hover:text-ink px-1" title="Edit">✎</button>
            <button type="button" onClick={() => removeItem.mutate({ id: row.item.id })} className="text-xs text-muted hover:text-red px-1" title="Remove">✕</button>
          </div>
        </div>

        {/* Nested sub-list — e.g. the ingredients of this step. Stop pointer
            events here from starting a drag, so you can type/select freely. */}
        {expanded && (
          <div
            className="mt-1.5 mb-1 pl-3.5 flex flex-col gap-0.5 cursor-auto"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {subItems.map((sub) => (
              <SubItemRow key={sub.id} sub={sub} />
            ))}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-muted text-[10px] shrink-0 select-none">+</span>
              <input
                value={subText}
                onChange={(e) => setSubText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSub() }}
                placeholder="Add to this list…"
                className="flex-1 bg-base border border-ink/10 rounded px-2 py-0.5 text-xs text-ink
                  placeholder:text-muted focus:outline-none focus:border-emerald"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── One sub-item (nested detail line — display + inline edit) ────────────────

function SubItemRow({ sub }: { sub: SubItem }) {
  const utils = trpc.useUtils()
  const invalidate = () => void utils.routine.list.invalidate()
  const updateSubItem = trpc.routine.updateSubItem.useMutation({ onSettled: invalidate })
  const removeSubItem = trpc.routine.removeSubItem.useMutation({ onSettled: invalidate })

  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(sub.text)

  function save() {
    const t = text.trim()
    if (t && t !== sub.text) updateSubItem.mutate({ id: sub.id, text: t })
    else setText(sub.text)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted text-[10px] shrink-0 select-none">–</span>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setText(sub.text); setEditing(false) }
          }}
          className="flex-1 bg-base border border-ink/10 rounded px-2 py-0.5 text-xs text-ink
            focus:outline-none focus:border-emerald"
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 group/sub">
      <span className="text-muted text-[10px] shrink-0 select-none">–</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex-1 text-left text-xs text-ink break-words cursor-text hover:text-emerald transition-colors"
        title="Click to edit"
      >
        {sub.text}
      </button>
      <button
        type="button"
        onClick={() => removeSubItem.mutate({ id: sub.id })}
        className="opacity-0 group-hover/sub:opacity-100 text-[10px] text-muted hover:text-red transition-all shrink-0"
        title="Remove"
      >
        ✕
      </button>
    </div>
  )
}

// ── Add-step form ────────────────────────────────────────────────────────────

function AddItemForm({
  onAdd,
  onCancel,
}: {
  onAdd: (payload: { text: string; durationMin: number; fixedTime: string | null }) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [duration, setDuration] = useState('')
  const [fixed, setFixed] = useState('')

  function submit() {
    const t = text.trim()
    if (!t) return
    onAdd({
      text: t,
      durationMin: Math.max(0, parseInt(duration, 10) || 0),
      fixedTime: fixed ? fixed : null,
    })
    setText('')
    setDuration('')
    setFixed('')
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-base/50 p-2">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Step (e.g. Meditate)…"
        className="bg-base border border-ink/10 rounded px-2 py-1 text-sm text-ink
          focus:outline-none focus:border-emerald"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1 text-xs text-muted">
          takes
          <input
            type="number"
            min={0}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="0"
            className="w-16 bg-base border border-ink/10 rounded px-1.5 py-0.5 text-xs text-ink
              focus:outline-none focus:border-emerald"
          />
          min
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          at
          <input
            type="time"
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
            className="bg-base border border-ink/10 rounded px-1.5 py-0.5 text-xs text-ink
              focus:outline-none focus:border-emerald"
          />
          <span className="text-ink/30">(optional)</span>
        </label>
        <div className="flex gap-1 ml-auto">
          <button type="button" onClick={submit} disabled={!text.trim()} className="text-xs px-2 py-1 rounded bg-emerald text-white font-semibold disabled:opacity-50">Add</button>
          <button type="button" onClick={onCancel} className="text-xs px-2 py-1 rounded border border-ink/20 text-muted hover:text-ink">Cancel</button>
        </div>
      </div>
    </div>
  )
}

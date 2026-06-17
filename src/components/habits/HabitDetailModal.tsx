'use client'

/**
 * HabitDetailModal — the popup opened by clicking a habit's name in the
 * LifeHabitTracker. A per-habit place to surface "extras":
 *
 *   • If the habit has a distilled guide (src/lib/habitDocs.ts) → a link/button
 *     to open it (previously the name opened it directly; now it lives here).
 *   • If the habit is duration-tracked (src/lib/meditation.ts, e.g. "Meditation")
 *     → the <MeditationPanel> logger + chart.
 *   • Otherwise → a hint that this habit has no extras yet.
 *
 * Closes on Escape or backdrop click. Reused for any habit, so future per-habit
 * tools slot in here.
 */

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { habitDocUrl } from '@/lib/habitDocs'
import { isMeditationHabit } from '@/lib/meditation'
import { LEVELS, levelFor, summitStyle } from '@/lib/habitLevels'
import { addDaysISO } from '@/lib/lifeHabits'
import { MeditationPanel } from './MeditationPanel'

// Mirror the grid's editable window (LifeHabitTracker EDIT_BACK_DAYS): the
// routine checklist can be filled for today + the past 7 days.
const CHECKLIST_BACK_DAYS = 7

interface Props {
  habitId: string
  name: string
  notes?: string | null
  peakScore?: number
  today: string // caller's local "YYYY-MM-DD" — anchors the checklist day selector
  onClose: () => void
}

export function HabitDetailModal({ habitId, name, notes, peakScore = 0, today, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Notes: view by default; toggle to an inline editor. Empty notes start in
  // edit mode so the textarea is ready to type into.
  const utils = trpc.useUtils()
  const [editingNotes, setEditingNotes] = useState(false)
  const [draft, setDraft] = useState(notes ?? '')
  const setNotes = trpc.lifeHabit.setNotes.useMutation({
    onSuccess: () => {
      void utils.lifeHabit.list.invalidate()
      setEditingNotes(false)
    },
  })

  const docUrl = habitDocUrl(name)
  const meditation = isMeditationHabit(name)

  // The all-time best level reached (permanent badge — survives drops). Every
  // rung up to and including it is "unlocked"; shown as a row of level medals.
  const peak = levelFor(peakScore)
  const peakSummit = summitStyle(peak)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-2xl rounded-xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold text-ink">{name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-muted hover:border-emerald hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Best ever — the permanent peak level + the medals unlocked so far. */}
        <div className="mb-4 rounded-lg border border-line bg-base p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">Best ever</span>
            <span
              className="text-sm font-semibold tabular-nums"
              style={{ color: peakSummit ? peakSummit.accent : peak.color }}
            >
              Level {peak.level} · {peak.name} · {peakScore.toFixed(2)}%
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {LEVELS.map((l) => {
              const unlocked = l.level <= peak.level
              const sm = summitStyle(l)
              return (
                <span
                  key={l.level}
                  title={`Level ${l.level} · ${l.name}${unlocked ? ' — unlocked' : ' — locked'}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold leading-none ${
                    unlocked
                      ? sm
                        ? `${sm.fillClass} text-black`
                        : 'text-black'
                      : 'border border-line text-faint/50'
                  }`}
                  style={
                    unlocked
                      ? sm
                        ? { boxShadow: `0 0 6px ${sm.glow}` }
                        : { background: l.color }
                      : undefined
                  }
                >
                  {l.level}
                </span>
              )
            })}
          </div>
        </div>

        {/* Notes — free-text reminder/checklist, editable inline */}
        <div className="mb-4">
          {editingNotes ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                autoFocus
                placeholder="Write a reminder or checklist for this habit…"
                className="w-full resize-y rounded-lg border border-line bg-base p-3 text-sm leading-relaxed text-ink outline-none focus:border-emerald"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setDraft(notes ?? ''); setEditingNotes(false) }}
                  disabled={setNotes.isPending}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:border-emerald hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setNotes.mutate({ id: habitId, notes: draft })}
                  disabled={setNotes.isPending}
                  className="rounded-md border border-emerald bg-emerald px-3 py-1.5 text-sm font-semibold text-base disabled:opacity-70"
                >
                  {setNotes.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : notes ? (
            <div className="group relative rounded-lg border border-line bg-base p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{notes}</p>
              <button
                type="button"
                onClick={() => { setDraft(notes); setEditingNotes(true) }}
                className="mt-2 text-xs text-muted hover:text-emerald"
              >
                Edit notes
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setDraft(''); setEditingNotes(true) }}
              className="text-sm text-muted hover:text-emerald"
            >
              + Add notes
            </button>
          )}
        </div>

        {/* Guide link */}
        {docUrl && (
          <a
            href={docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-4 inline-flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-2 text-sm text-emerald transition-colors hover:border-emerald"
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden
            >
              <path d="M14 4h6v6" />
              <path d="M20 4l-9 9" />
              <path d="M19 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
            Open guide
          </a>
        )}

        {/* Routine checklist — attach a routine; ticking all boxes auto-ticks the day */}
        <RoutineChecklistSection habitId={habitId} today={today} />

        {/* Meditation logger + chart */}
        {meditation && <MeditationPanel habitId={habitId} />}
      </div>
    </div>
  )
}

// ── Routine checklist ────────────────────────────────────────────────────────
//
// A habit can attach several routines. Each renders as its own per-day checklist
// (steps + conditions); the habit auto-ticks for that day when ANY one routine is
// fully checked (OR logic) — e.g. "Evening Flow" attaches both "Sleep Routine
// Solo" and "Sleep Routine Social", and completing either one ticks the habit.
// Un-checking so that no routine is complete un-ticks it (two-way). The day
// selector covers today + the past 7 days, matching the grid's editable window.

function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today'
  if (iso === addDaysISO(today, -1)) return 'Yesterday'
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
}

function RoutineChecklistSection({ habitId, today }: { habitId: string; today: string }) {
  const utils = trpc.useUtils()
  const [date, setDate] = useState(today)
  const [pick, setPick] = useState('')
  const [dayMenuOpen, setDayMenuOpen] = useState(false)

  const checklistQ = trpc.lifeHabit.checklist.useQuery({ habitId, date })
  const routines = checklistQ.data ?? []
  const attached = routines.length > 0
  // The full routine list feeds the attach picker (excluding already-attached).
  const routinesQ = trpc.routine.list.useQuery(undefined, { enabled: checklistQ.isSuccess })

  const invalidate = () => {
    void utils.lifeHabit.checklist.invalidate()
    void utils.lifeHabit.list.invalidate()
  }
  const add = trpc.lifeHabit.addRoutine.useMutation({ onSuccess: invalidate })
  const remove = trpc.lifeHabit.removeRoutine.useMutation({ onSuccess: invalidate })
  const setItem = trpc.lifeHabit.setChecklistItem.useMutation({ onSuccess: invalidate })

  const days = Array.from({ length: CHECKLIST_BACK_DAYS + 1 }, (_, i) => addDaysISO(today, -i))

  const attachedIds = new Set(routines.map((r) => r.routineId))
  const available = (routinesQ.data ?? []).filter((r) => !attachedIds.has(r.id))
  const anyComplete = routines.some((r) => r.complete)

  const picker = available.length > 0 && (
    <div className="flex items-center gap-2">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-emerald"
      >
        <option value="">{attached ? 'Attach another routine…' : 'Choose a routine…'}</option>
        {available.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!pick || add.isPending}
        onClick={() => { add.mutate({ habitId, routineId: pick, date }); setPick('') }}
        className="rounded-md border border-emerald bg-emerald px-3 py-1.5 text-sm font-semibold text-base disabled:opacity-50"
      >
        Attach
      </button>
    </div>
  )

  return (
    <div className="mt-4 rounded-lg border border-line bg-base p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Routine checklist</span>
        {attached && (
          <span className="text-xs tabular-nums text-muted">{anyComplete ? 'habit ticked ✓' : ''}</span>
        )}
      </div>

      {checklistQ.isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !attached ? (
        // Nothing attached → intro + picker.
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            Attach a routine and its steps become a daily checklist here. Tick them all and this habit
            auto-ticks for the day. Attach more than one and any single completed routine ticks it.
          </p>
          {routinesQ.data && routinesQ.data.length > 0 ? (
            picker
          ) : (
            <p className="text-sm text-faint">No routines yet — create one in the Routines tab first.</p>
          )}
        </div>
      ) : (
        // One or more routines attached → shared day selector + a card per routine.
        <div className="flex flex-col gap-3">
          {routines.length > 1 && (
            <p className="text-xs text-muted">
              Any one completed routine ticks this habit{anyComplete ? '' : ' — none complete yet'}.
            </p>
          )}

          {/* Day selector — collapsible: a trigger showing the chosen day; click
              to reveal today + the past 7 days, picking one closes the menu. */}
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setDayMenuOpen((v) => !v)}
              className="flex w-fit items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink hover:border-emerald"
            >
              <span className="text-faint">Day:</span>
              <span className="font-medium">{dayLabel(date, today)}</span>
              <span className="text-faint">{dayMenuOpen ? '▾' : '▸'}</span>
            </button>
            {dayMenuOpen && (
              <div className="flex flex-wrap gap-1">
                {days.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setDate(d); setDayMenuOpen(false) }}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      d === date
                        ? 'border-emerald bg-emerald/15 text-ink'
                        : 'border-line text-muted hover:border-emerald hover:text-ink'
                    }`}
                  >
                    {dayLabel(d, today)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {routines.map((cl) => {
            const total = cl.steps.length + cl.conditions.length
            const doneCount =
              cl.steps.filter((s) => s.done).length + cl.conditions.filter((c) => c.done).length
            return (
              <div
                key={cl.routineId}
                className={`flex flex-col gap-3 rounded-lg border p-3 ${
                  cl.complete ? 'border-emerald/60 bg-emerald/[0.04]' : 'border-line'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-ink">
                    {cl.routineName}{cl.complete ? ' ✓' : ''}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs tabular-nums text-muted">{doneCount} / {total} done</span>
                    <button
                      type="button"
                      onClick={() => remove.mutate({ habitId, routineId: cl.routineId, date })}
                      disabled={remove.isPending}
                      className="text-xs text-muted hover:text-emerald"
                    >
                      Detach
                    </button>
                  </div>
                </div>

                {total === 0 ? (
                  <p className="text-sm text-faint">This routine has no steps or conditions yet.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {cl.steps.length > 0 && (
                      <ChecklistGroup
                        title="Steps"
                        rows={cl.steps}
                        pending={setItem.isPending}
                        onToggle={(sourceId, done) =>
                          setItem.mutate({ habitId, date, sourceId, sourceKind: 'step', done })
                        }
                      />
                    )}
                    {cl.conditions.length > 0 && (
                      <ChecklistGroup
                        title="Conditions"
                        rows={cl.conditions}
                        pending={setItem.isPending}
                        onToggle={(sourceId, done) =>
                          setItem.mutate({ habitId, date, sourceId, sourceKind: 'condition', done })
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {picker}
        </div>
      )}
    </div>
  )
}

function ChecklistGroup({
  title,
  rows,
  pending,
  onToggle,
}: {
  title: string
  rows: { id: string; text: string; done: boolean; time?: string }[]
  pending: boolean
  onToggle: (sourceId: string, done: boolean) => void
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled={pending}
            onClick={() => onToggle(r.id, !r.done)}
            className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-surface disabled:opacity-60"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold leading-none ${
                r.done ? 'border-emerald bg-emerald text-base' : 'border-line text-transparent'
              }`}
            >
              ✓
            </span>
            {r.time !== undefined && (
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted">{r.time}</span>
            )}
            <span className={r.done ? 'text-muted line-through' : 'text-ink'}>{r.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

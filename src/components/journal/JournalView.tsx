'use client'

/**
 * JournalView — the Journal tab. Sub-tabs are driven by JournalType rows
 * (dynamic — user can create, rename, archive journals at runtime).
 *
 * Each sub-tab is laid out as THREE arrangeable boxes on a shared BoxBoard
 * (Write · Questionnaire · Recent entries).
 *
 * The boxes are LOCKED by default (fully usable — type, scroll, select), and the
 * "Arrange" toggle unlocks drag (grab a box's title) + resize (drag any edge),
 * exactly like the app's other boxes. Each sub-tab keeps its own saved layout
 * (AppSetting keys `journal-<slug>-boardLayout`).
 *
 * All entries go through the `journal` tRPC router (Prisma DiaryEntry,
 * `kind` = slug string, + Event log).
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { Layout } from 'react-grid-layout'
import { trpc } from '@/lib/trpc/client'
import { BoxBoard, BOX_DRAG_HANDLE } from '@/components/shared/BoxBoard'

/** localStorage key for the last-open sub-tab slug (survives tab switches). */
const MODE_KEY = 'journal-mode'

/** Draft key scoped to a slug (survives tab switches & reloads). */
function draftKey(slug: string) {
  return `journal-draft-${slug}`
}

/** The eight slider metrics, in display order. Keys match DiaryEntry fields. */
const METRICS = [
  { key: 'mood', label: 'Mood' },
  { key: 'energy', label: 'Energy' },
  { key: 'focus', label: 'Focus' },
  { key: 'stress', label: 'Stress' },
  { key: 'sleepQuality', label: 'Sleep quality' },
  { key: 'motivation', label: 'Motivation' },
  { key: 'hope', label: 'Hope' },
  { key: 'physicalHealth', label: 'Physical health' },
  { key: 'productivity', label: 'Productivity' },
] as const

type MetricKey = (typeof METRICS)[number]['key']

const DEFAULT_RATINGS: Record<MetricKey, number> = {
  mood: 0,
  energy: 0,
  focus: 0,
  stress: 0,
  sleepQuality: 0,
  motivation: 0,
  hope: 0,
  physicalHealth: 0,
  productivity: 0,
}

/** Which sliders the user has actually touched this entry. Untouched ones are
 *  shown dimmed and are NOT recorded (saved as null) — so the questionnaire is
 *  fully optional. */
const DEFAULT_TOUCHED: Record<MetricKey, boolean> = {
  mood: false,
  energy: false,
  focus: false,
  stress: false,
  sleepQuality: false,
  motivation: false,
  hope: false,
  physicalHealth: false,
  productivity: false,
}

// Default 3-box layouts (12-col grid, 40px rows). Same pane keys in both modes,
// but each sub-tab persists under its own storageKey so the layouts stay separate.
const NORMAL_LAYOUT: Layout = [
  { i: 'writer', x: 0, y: 0, w: 7, h: 8, minW: 3, minH: 4 },
  { i: 'side', x: 7, y: 0, w: 5, h: 13, minW: 3, minH: 4 },
  { i: 'recent', x: 0, y: 8, w: 7, h: 8, minW: 3, minH: 4 },
]

// Picks the renderer for the active sub-tab. Journals use the normal
// (questionnaire) layout.
function SubTab({ slug, arranging }: { slug: string; arranging: boolean }) {
  return <NormalJournal key={slug} slug={slug} arranging={arranging} />
}

export function JournalView() {
  const [activeSlug, setActiveSlug] = useState('journal')
  const [arranging, setArranging] = useState(false)
  // Inline-rename / new-journal state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')

  const utils = trpc.useUtils()
  const typesQuery = trpc.journal.listTypes.useQuery()
  const types = typesQuery.data ?? []

  const createTypeMutation = trpc.journal.createType.useMutation({
    onSuccess: (jt) => {
      void utils.journal.listTypes.invalidate()
      setActiveSlug(jt.slug)
      setAddingNew(false)
      setNewName('')
    },
  })
  const renameTypeMutation = trpc.journal.renameType.useMutation({
    onSuccess: () => {
      void utils.journal.listTypes.invalidate()
      setRenamingId(null)
      setRenameValue('')
    },
  })
  const archiveTypeMutation = trpc.journal.archiveType.useMutation({
    onSuccess: () => {
      void utils.journal.listTypes.invalidate()
      // If the archived type was active, fall back to first remaining type.
      setActiveSlug((prev) => {
        const remaining = (typesQuery.data ?? []).filter((t) => t.id !== archiveTypeMutation.variables?.id)
        if (remaining.some((t) => t.slug === prev)) return prev
        return remaining[0]?.slug ?? 'journal'
      })
    },
  })

  // Restore the last-open sub-tab once on mount.
  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_KEY)
    if (saved) setActiveSlug(saved)
  }, [])

  // Once types load, ensure activeSlug is valid (e.g. after archive).
  useEffect(() => {
    if (types.length > 0 && !types.some((t) => t.slug === activeSlug)) {
      setActiveSlug(types[0]!.slug)
    }
  }, [types, activeSlug])

  function changeSlug(slug: string) {
    setActiveSlug(slug)
    window.localStorage.setItem(MODE_KEY, slug)
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameValue(currentName)
  }

  function commitRename() {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    renameTypeMutation.mutate({ id: renamingId, name: renameValue.trim() })
  }

  function submitNewJournal() {
    if (!newName.trim() || createTypeMutation.isPending) return
    createTypeMutation.mutate({ name: newName.trim() })
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold uppercase tracking-wide text-ink">Journal</h1>

        {/* Dynamic sub-tab buttons from JournalType rows */}
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-base p-0.5 text-xs">
          {types.map((t) => (
            <div key={t.id} className="group relative flex items-center">
              {renamingId === t.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  className="rounded-md border border-emerald bg-surface px-2 py-1 text-xs text-ink outline-none"
                  style={{ width: `${Math.max(renameValue.length, 6)}ch` }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => changeSlug(t.slug)}
                  onDoubleClick={() => startRename(t.id, t.name)}
                  title="Double-click to rename"
                  className={`rounded-md px-3 py-1 transition-colors ${
                    activeSlug === t.slug
                      ? 'bg-surface font-semibold text-ink'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {t.name}
                </button>
              )}
              {/* Archive (delete) button — shown on hover */}
              {renamingId !== t.id && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Archive journal "${t.name}"? Existing entries are kept.`)) {
                      archiveTypeMutation.mutate({ id: t.id })
                    }
                  }}
                  title="Archive this journal"
                  className="ml-0.5 hidden rounded px-1 py-0.5 text-[10px] text-muted hover:text-red group-hover:inline-block"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          {/* Add-new inline input */}
          {addingNew ? (
            <div className="flex items-center gap-1 px-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => { if (!newName.trim()) setAddingNew(false) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNewJournal()
                  if (e.key === 'Escape') { setAddingNew(false); setNewName('') }
                }}
                placeholder="Name…"
                className="rounded-md border border-emerald bg-surface px-2 py-1 text-xs text-ink outline-none"
                style={{ width: '8ch' }}
              />
              <button
                type="button"
                onClick={submitNewJournal}
                disabled={!newName.trim() || createTypeMutation.isPending}
                className="rounded-md px-2 py-1 text-[10px] text-emerald hover:text-ink disabled:opacity-50"
              >
                {createTypeMutation.isPending ? '…' : '✓'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingNew(true)}
              title="Add a new journal"
              className="rounded-md px-2 py-1 text-muted hover:text-ink"
            >
              +
            </button>
          )}
        </div>

        {/* Arrange toggle — unlocks drag + resize of the three boxes. */}
        <button
          type="button"
          onClick={() => setArranging((v) => !v)}
          title="Move + resize the boxes; turn off to lock them"
          className={`ml-auto rounded-lg border px-3 py-1 text-xs transition-colors ${
            arranging
              ? 'border-emerald bg-emerald/15 font-semibold text-emerald'
              : 'border-line text-muted hover:text-ink'
          }`}
        >
          {arranging ? '✓ Arranging' : 'Arrange'}
        </button>
      </div>

      {/* Render the correct sub-tab based on the active slug */}
      <SubTab slug={activeSlug} arranging={arranging} />
    </div>
  )
}

// ── Normal journal (Write · Questionnaire · Recent) ──────────────────────────

function NormalJournal({ slug, arranging }: { slug: string; arranging: boolean }) {
  const [text, setText] = useState('')
  const [ratings, setRatings] = useState<Record<MetricKey, number>>(DEFAULT_RATINGS)
  const [touched, setTouched] = useState<Record<MetricKey, boolean>>(DEFAULT_TOUCHED)
  const [sleepHours, setSleepHours] = useState('')
  const [showCount, setShowCount] = useState(5)

  const utils = trpc.useUtils()
  const entriesQuery = trpc.journal.list.useQuery({ kind: slug, limit: showCount })
  const entries = entriesQuery.data ?? []

  const SLUG_DRAFT_KEY = draftKey(slug)

  // Restore any unsaved draft once on mount (survives tab switches/reloads).
  useEffect(() => {
    const raw = window.localStorage.getItem(SLUG_DRAFT_KEY)
    if (!raw) return
    try {
      const d = JSON.parse(raw) as {
        text?: string
        ratings?: Record<MetricKey, number>
        touched?: Record<MetricKey, boolean>
        sleepHours?: string
      }
      if (typeof d.text === 'string') setText(d.text)
      if (d.ratings) setRatings({ ...DEFAULT_RATINGS, ...d.ratings })
      if (d.touched) setTouched({ ...DEFAULT_TOUCHED, ...d.touched })
      if (typeof d.sleepHours === 'string') setSleepHours(d.sleepHours)
    } catch {
      window.localStorage.removeItem(SLUG_DRAFT_KEY)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Mirror the full draft to localStorage so nothing is lost on tab switch. */
  function persistDraft(next: {
    text?: string
    ratings?: Record<MetricKey, number>
    touched?: Record<MetricKey, boolean>
    sleepHours?: string
  }) {
    const draft = {
      text: next.text ?? text,
      ratings: next.ratings ?? ratings,
      touched: next.touched ?? touched,
      sleepHours: next.sleepHours ?? sleepHours,
    }
    const isEmpty =
      !draft.text.trim() &&
      !draft.sleepHours.trim() &&
      !Object.values(draft.touched).some(Boolean)
    if (isEmpty) window.localStorage.removeItem(SLUG_DRAFT_KEY)
    else window.localStorage.setItem(SLUG_DRAFT_KEY, JSON.stringify(draft))
  }

  function changeText(value: string) {
    setText(value)
    persistDraft({ text: value })
  }

  const addMutation = trpc.journal.add.useMutation({
    onSuccess: () => {
      setText('')
      setRatings(DEFAULT_RATINGS)
      setTouched(DEFAULT_TOUCHED)
      setSleepHours('')
      window.localStorage.removeItem(SLUG_DRAFT_KEY)
      void utils.journal.list.invalidate()
    },
  })
  const removeMutation = trpc.journal.remove.useMutation({
    onSettled: () => { void utils.journal.list.invalidate() },
  })

  function markTouched(key: MetricKey) {
    if (touched[key]) return
    const nextTouched = { ...touched, [key]: true }
    setTouched(nextTouched)
    persistDraft({ touched: nextTouched })
  }

  function setRating(key: MetricKey, value: number) {
    const nextRatings = { ...ratings, [key]: value }
    const nextTouched = touched[key] ? touched : { ...touched, [key]: true }
    setRatings(nextRatings)
    setTouched(nextTouched)
    persistDraft({ ratings: nextRatings, touched: nextTouched })
  }

  function save() {
    if (!text.trim() || addMutation.isPending) return
    const raw = sleepHours.trim()
    const hrs = raw === '' ? null : Number(raw)
    const rated = Object.fromEntries(
      METRICS.map((m) => [m.key, touched[m.key] ? ratings[m.key] : null]),
    ) as Record<MetricKey, number | null>
    addMutation.mutate({
      text,
      kind: slug,
      ...rated,
      sleepHours: hrs != null && Number.isFinite(hrs) ? hrs : null,
    })
  }

  return (
    <BoxBoard
      storageKey={`journal-${slug}-boardLayout`}
      defaultLayout={NORMAL_LAYOUT}
      arrangeMode={arranging}
      panes={[
        {
          key: 'writer',
          title: 'Write',
          node: (
            <Pane title="Write" arranging={arranging}>
              <div className="flex min-h-0 flex-1 flex-col">
                <textarea
                  value={text}
                  onChange={(e) => changeText(e.target.value)}
                  placeholder="Write your entry… (Enter for a new line — use Save entry below to store it)"
                  className="min-h-0 flex-1 resize-none whitespace-pre-wrap rounded-lg border border-ink/10 bg-base px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-emerald focus:outline-none"
                />
                <button
                  type="button"
                  onClick={save}
                  disabled={!text.trim() || addMutation.isPending}
                  className="mt-2 shrink-0 self-start rounded-lg bg-emerald px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {addMutation.isPending ? 'Saving…' : 'Save entry'}
                </button>
              </div>
            </Pane>
          ),
        },
        {
          key: 'side',
          title: 'Questionnaire',
          node: (
            <Pane title="How was today? (−5 to +5)" arranging={arranging}>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                {METRICS.map((m) => (
                  <div key={m.key}>
                    <div className={touched[m.key] ? '' : 'opacity-50'}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-ink">{m.label}</span>
                        <span className="font-semibold text-emerald">
                          {touched[m.key] ? ratings[m.key] : '–'}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-5}
                        max={5}
                        step={1}
                        value={ratings[m.key]}
                        onPointerDown={() => markTouched(m.key)}
                        onChange={(e) => setRating(m.key, Number(e.target.value))}
                        className="w-full cursor-pointer accent-emerald"
                        aria-label={m.label}
                      />
                    </div>
                    {m.key === 'sleepQuality' && (
                      <div className="mt-2 flex items-center gap-2">
                        <label htmlFor="sleep-hours" className="text-xs text-muted">
                          Sleep hours
                        </label>
                        <input
                          id="sleep-hours"
                          type="number"
                          min={0}
                          max={24}
                          step={0.5}
                          value={sleepHours}
                          onChange={(e) => { setSleepHours(e.target.value); persistDraft({ sleepHours: e.target.value }) }}
                          placeholder="–"
                          className="w-16 rounded border border-ink/10 bg-surface px-2 py-1 text-xs text-ink focus:border-emerald focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Pane>
          ),
        },
        {
          key: 'recent',
          title: 'Recent entries',
          node: (
            <Pane
              title="Recent entries"
              arranging={arranging}
              right={<ShowLast value={showCount} onChange={setShowCount} />}
            >
              <RecentEntriesBody
                entries={entries}
                onRemove={(id) => removeMutation.mutate({ id })}
                emptyHint="No entries yet — write your first one in the Write box."
              />
            </Pane>
          ),
        },
      ]}
    />
  )
}


// ── Shared pieces ─────────────────────────────────────────────────────────────

/**
 * One box's chrome: a title bar (the drag handle — only grabbable while
 * arranging) plus a body that fills the box. The body's last flex child should
 * own its scroll; the box's content scrolls inside its fixed frame.
 */
function Pane({
  title,
  arranging,
  right,
  children,
}: {
  title: string
  arranging: boolean
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={`flex h-full flex-col rounded-lg ${arranging ? 'ring-1 ring-inset ring-emerald/30' : ''}`}>
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span
          className={`${BOX_DRAG_HANDLE} select-none text-xs font-semibold uppercase tracking-wide ${
            arranging ? 'cursor-grab text-emerald active:cursor-grabbing' : 'cursor-default text-muted'
          }`}
          title={arranging ? 'Drag to move this box' : undefined}
        >
          {arranging ? '⠿ ' : ''}{title}
        </span>
        {right}
      </div>
      {children}
    </div>
  )
}

/** The "Show last N" number control shown in the Recent-entries box title bar. */
function ShowLast({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-xs text-muted">
      Show last
      <input
        type="number"
        min={1}
        max={500}
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        className="w-16 rounded border border-ink/10 bg-base px-2 py-1 text-xs text-ink focus:border-emerald focus:outline-none"
      />
    </label>
  )
}

type EntryRow = {
  id: string
  text: string
  createdAt: string | Date
  sleepHours: number | null
} & Record<MetricKey, number | null>

/** The scrolling list of recent entries (fills the Recent box). */
function RecentEntriesBody({
  entries,
  onRemove,
  emptyHint,
}: {
  entries: EntryRow[]
  onRemove: (id: string) => void
  emptyHint: string
}) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{emptyHint}</p>
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} onRemove={() => onRemove(entry.id)} />
      ))}
    </div>
  )
}

/** One saved entry: time of entry + text + every rating as a chip. */
function EntryCard({ entry, onRemove }: { entry: EntryRow; onRemove: () => void }) {
  const when = new Date(entry.createdAt)
  const timeLabel = when.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="group shrink-0 rounded-lg border border-ink/10 bg-base p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-emerald">{timeLabel}</span>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-xs text-muted opacity-0 transition hover:text-red group-hover:opacity-100"
          aria-label="Remove entry"
          title="Remove"
        >
          ✕
        </button>
      </div>

      {entry.text && (
        <p className="mb-2 whitespace-pre-wrap break-words text-sm text-ink">{entry.text}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {METRICS.filter((m) => entry[m.key] != null).map((m) => (
          <span key={m.key} className="rounded-md bg-surface px-2 py-0.5 text-xs text-muted">
            {m.label} <span className="font-semibold text-ink">{entry[m.key]}</span>
          </span>
        ))}
        {entry.sleepHours != null && (
          <span className="rounded-md bg-surface px-2 py-0.5 text-xs text-muted">
            Sleep hours <span className="font-semibold text-ink">{entry.sleepHours}</span>h
          </span>
        )}
      </div>
    </div>
  )
}

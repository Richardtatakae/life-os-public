'use client'

/**
 * ItemDetailModal — an inline, expandable editor that shows and edits EVERY
 * database field for a goal, a task/subtask, or an area (Pursuits §). It expands
 * in place directly below the item when its "⚙" button is pressed — no overlay,
 * no dimmed background.
 *
 * Design:
 *   - Scalar fields (title, status, deadline, …) are held in local form state
 *     and written in one go via the item's `update` mutation when you press
 *     Save. Every save writes an Event row on the server (project convention).
 *   - Relationship edits (dependencies) are INSTANT
 *     actions with their own mutations + their own Event rows — applied the
 *     moment you click, not batched into Save.
 *   - Read-only audit fields (id, created/started/completed timestamps,
 *     position) are shown at the bottom for reference.
 *
 * Backend support: task.update was extended to accept areaId + parentTaskId
 * (with self/cycle guards); task.get & goal.get return dependsOn id[].
 */

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useVowStore } from '@/stores/vowStore'

export type DetailKind = 'goal' | 'task' | 'area'

interface ItemDetailModalProps {
  kind: DetailKind
  id: string
  onClose: () => void
}

// ── Enum option lists (mirror the Prisma schema) ────────────────────────────
const TASK_STATUSES = ['inbox', 'todo', 'scheduled', 'in_progress', 'blocked', 'done', 'deferred'] as const
const GOAL_STATUSES = ['planning', 'active', 'paused', 'completed', 'archived'] as const
const ENERGIES = ['high', 'medium', 'low'] as const

// ── Date helpers: <input type="date"> uses local yyyy-mm-dd strings ─────────
function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fromDateInput(s: string): Date | null {
  return s ? new Date(`${s}T00:00:00`) : null
}
function fmtTimestamp(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

// ── Tiny presentational helpers (kept local to this file) ───────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'bg-base border border-ink/10 rounded-lg px-2 py-1.5 text-sm text-ink ' +
  'placeholder:text-muted focus:outline-none focus:border-emerald w-full'

// ─────────────────────────────────────────────────────────────────────────────

export function ItemDetailModal({ kind, id, onClose }: ItemDetailModalProps) {
  // Escape collapses the inline editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const heading = kind === 'goal' ? 'Edit goal' : kind === 'task' ? 'Edit task' : 'Edit area'

  return (
    <div className="my-1 rounded-xl border border-line bg-base/60 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-line">
        <h3 className="text-sm font-bold text-ink">{heading}</h3>
        <button
          onClick={onClose}
          className="text-muted hover:text-ink transition-colors text-base leading-none"
          aria-label="Collapse"
        >
          ✕
        </button>
      </div>

      <div className="px-4 py-3">
        {kind === 'task' && <TaskDetailFields id={id} onClose={onClose} />}
        {kind === 'goal' && <GoalDetailFields id={id} onClose={onClose} />}
        {kind === 'area' && <AreaDetailFields id={id} onClose={onClose} />}
      </div>
    </div>
  )
}

// ─────────────────── Footer (Save / Cancel) ───────────────────

function Footer({ onSave, onClose, saving, error }: {
  onSave: () => void
  onClose: () => void
  saving: boolean
  error: string | null
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      {error && <span className="text-xs text-red mr-auto">{error}</span>}
      <button
        onClick={onClose}
        className="text-sm px-4 py-2 rounded-lg bg-slate text-muted hover:bg-line transition-colors font-medium"
      >
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="text-sm px-4 py-2 rounded-lg bg-emerald text-white font-semibold
          hover:opacity-90 transition disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

// ─────────────────── Dependency editor (tasks + goals share the shape) ───────

function DependencyEditor({
  currentIds,
  candidates,
  titleOf,
  onAdd,
  onRemove,
}: {
  currentIds: string[]
  candidates: { id: string; title: string }[]
  titleOf: (id: string) => string
  onAdd: (prerequisiteId: string) => void
  onRemove: (prerequisiteId: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">Dependencies</span>
      {currentIds.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {currentIds.map((pid) => (
            <span key={pid} className="text-xs px-1.5 py-0.5 rounded bg-ink/10 text-muted flex items-center gap-1">
              depends on: {titleOf(pid)}
              <button onClick={() => onRemove(pid)} className="hover:text-red" aria-label="Remove dependency">✕</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No dependencies.</p>
      )}
      {candidates.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) onAdd(e.target.value) }}
          className={inputCls + ' w-fit text-xs'}
        >
          <option value="">+ add dependency…</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      )}
    </div>
  )
}

// ─────────────────── Read-only audit block ───────────────────

function AuditInfo({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-4 pt-3 border-t border-line grid grid-cols-2 gap-x-4 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-faint">{k}</span>
          <span className="text-xs text-muted break-all">{v}</span>
        </div>
      ))}
    </div>
  )
}

// ════════════════════ TASK ════════════════════

interface TaskFormState {
  title: string
  status: typeof TASK_STATUSES[number]
  category: string
  priority: number | null
  energy: typeof ENERGIES[number] | null
  estimateMin: number | null
  deadline: string
  softDeadline: string
  notes: string
  goalId: string
  areaId: string
  parentTaskId: string
}

function TaskDetailFields({ id, onClose }: { id: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: task, isLoading } = trpc.task.get.useQuery({ id })
  const activeVow = useVowStore((s) => s.vow)
  const setActivationTaskId = useVowStore((s) => s.setActivationTaskId)
  const areas = trpc.area.list.useQuery().data ?? []
  const goals = trpc.goal.list.useQuery().data ?? []
  const tasks = trpc.task.list.useQuery({ limit: 500 }).data ?? []

  const [form, setForm] = useState<TaskFormState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => {
    void utils.task.tree.invalidate()
    void utils.task.todayList.invalidate()
    void utils.task.get.invalidate({ id })
  }
  const update = trpc.task.update.useMutation({
    onSuccess: () => { invalidate(); onClose() },
    onError: (e) => setError(e.message),
  })
  const addDep = trpc.task.addDependency.useMutation({
    onSuccess: () => { setError(null); invalidate() },
    onError: (e) => setError(e.message),
  })
  const removeDep = trpc.task.removeDependency.useMutation({ onSettled: invalidate })

  useEffect(() => {
    if (task && !form) {
      setForm({
        title: task.title,
        status: task.status as TaskFormState['status'],
        category: task.category ?? '',
        priority: task.priority,
        energy: task.energy as TaskFormState['energy'],
        estimateMin: task.estimateMin,
        deadline: toDateInput(task.deadline),
        softDeadline: toDateInput(task.softDeadline),
        notes: task.notes ?? '',
        goalId: task.goalId ?? '',
        areaId: task.areaId ?? '',
        parentTaskId: task.parentTaskId ?? '',
      })
    }
  }, [task, form])

  if (isLoading || !task || !form) return <p className="text-sm text-muted py-6 text-center animate-pulse">Loading…</p>

  const set = <K extends keyof TaskFormState>(k: K, v: TaskFormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  function save() {
    if (!form) return
    update.mutate({
      id,
      title: form.title.trim(),
      status: form.status,
      category: form.category.trim() || null,
      priority: form.priority,
      energy: form.energy,
      estimateMin: form.estimateMin,
      deadline: fromDateInput(form.deadline),
      softDeadline: fromDateInput(form.softDeadline),
      notes: form.notes.trim() || null,
      goalId: form.goalId || null,
      areaId: form.areaId || null,
      parentTaskId: form.parentTaskId || null,
    })
  }

  const depCandidates = tasks
    .filter((t) => t.id !== id && !task.dependsOn.includes(t.id))
    .map((t) => ({ id: t.id, title: t.title }))
  const titleOfTask = (tid: string) => tasks.find((t) => t.id === tid)?.title ?? tid
  const parentCandidates = tasks.filter((t) => t.id !== id)

  return (
    <div className="flex flex-col gap-3">
      <Field label="Title">
        <input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value as TaskFormState['status'])}>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Energy">
          <select className={inputCls} value={form.energy ?? ''} onChange={(e) => set('energy', (e.target.value || null) as TaskFormState['energy'])}>
            <option value="">—</option>
            {ENERGIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Priority (1–5)">
          <input type="number" min={1} max={5} className={inputCls} value={form.priority ?? ''}
            onChange={(e) => set('priority', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
        <Field label="Estimate (min)">
          <input type="number" min={0} className={inputCls} value={form.estimateMin ?? ''}
            onChange={(e) => set('estimateMin', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
        <Field label="Deadline">
          <input type="date" className={inputCls} value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
        </Field>
        <Field label="Soft deadline">
          <input type="date" className={inputCls} value={form.softDeadline} onChange={(e) => set('softDeadline', e.target.value)} />
        </Field>
      </div>

      <Field label="Category">
        <input className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. admin" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Goal">
          <select className={inputCls} value={form.goalId} onChange={(e) => set('goalId', e.target.value)}>
            <option value="">— none —</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        <Field label="Area">
          <select className={inputCls} value={form.areaId} onChange={(e) => set('areaId', e.target.value)}>
            <option value="">— none —</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Parent task">
        <select className={inputCls} value={form.parentTaskId} onChange={(e) => set('parentTaskId', e.target.value)}>
          <option value="">— none (top-level) —</option>
          {parentCandidates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </Field>

      <Field label="Notes">
        <textarea className={inputCls + ' resize-none'} rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      <DependencyEditor
        currentIds={task.dependsOn}
        candidates={depCandidates}
        titleOf={titleOfTask}
        onAdd={(pid) => addDep.mutate({ dependentId: id, prerequisiteId: pid })}
        onRemove={(pid) => removeDep.mutate({ dependentId: id, prerequisiteId: pid })}
      />

      <AuditInfo rows={[
        ['Created', fmtTimestamp(task.createdAt)],
        ['Started', fmtTimestamp(task.startedAt)],
        ['Completed', fmtTimestamp(task.completedAt)],
        ['ID', task.id],
      ]} />

      {/* Vow Mode entry — only for undone tasks and when no vow is active */}
      {task.status !== 'done' && !activeVow && (
        <div className="mt-2 pt-3 border-t border-line">
          <button
            onClick={() => { setActivationTaskId(id); onClose() }}
            className="w-full py-2 px-4 rounded-lg border border-amber/30 text-sm font-semibold
              text-amber hover:bg-amber/10 transition-colors"
          >
            ⛓ Nothing else until this is done — Swear a Vow
          </button>
        </div>
      )}

      <Footer onSave={save} onClose={onClose} saving={update.isPending} error={error} />
    </div>
  )
}

// ════════════════════ GOAL ════════════════════

interface GoalFormState {
  title: string
  description: string
  status: typeof GOAL_STATUSES[number]
  areaId: string
  projectId: string
  parentId: string
  targetMetric: string
  targetValue: number | null
  deadline: string
}

function GoalDetailFields({ id, onClose }: { id: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  const { data: goal, isLoading } = trpc.goal.get.useQuery({ id })
  const areas = trpc.area.list.useQuery().data ?? []
  const projects = trpc.project.list.useQuery().data ?? []
  const goals = trpc.goal.list.useQuery().data ?? []

  const [form, setForm] = useState<GoalFormState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => {
    void utils.goal.tree.invalidate()
    void utils.goal.get.invalidate({ id })
  }
  const update = trpc.goal.update.useMutation({
    onSuccess: () => { invalidate(); onClose() },
    onError: (e) => setError(e.message),
  })
  const addDep = trpc.goal.addDependency.useMutation({
    onSuccess: () => { setError(null); invalidate() },
    onError: (e) => setError(e.message),
  })
  const removeDep = trpc.goal.removeDependency.useMutation({ onSettled: invalidate })

  useEffect(() => {
    if (goal && !form) {
      setForm({
        title: goal.title,
        description: goal.description ?? '',
        status: goal.status as GoalFormState['status'],
        areaId: goal.areaId ?? '',
        projectId: goal.projectId ?? '',
        parentId: goal.parentId ?? '',
        targetMetric: goal.targetMetric ?? '',
        targetValue: goal.targetValue,
        deadline: toDateInput(goal.deadline),
      })
    }
  }, [goal, form])

  if (isLoading || !goal || !form) return <p className="text-sm text-muted py-6 text-center animate-pulse">Loading…</p>

  const set = <K extends keyof GoalFormState>(k: K, v: GoalFormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  function save() {
    if (!form) return
    update.mutate({
      id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      areaId: form.areaId || null,
      projectId: form.projectId || null,
      parentId: form.parentId || null,
      targetMetric: form.targetMetric.trim() || null,
      targetValue: form.targetValue,
      deadline: fromDateInput(form.deadline),
    })
  }

  const depCandidates = goals
    .filter((g) => g.id !== id && !goal.dependsOn.includes(g.id))
    .map((g) => ({ id: g.id, title: g.title }))
  const titleOfGoal = (gid: string) => goals.find((g) => g.id === gid)?.title ?? gid
  const parentCandidates = goals.filter((g) => g.id !== id)

  return (
    <div className="flex flex-col gap-3">
      <Field label="Title">
        <input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} />
      </Field>

      <Field label="Description / why">
        <textarea className={inputCls + ' resize-none'} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value as GoalFormState['status'])}>
            {GOAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Deadline">
          <input type="date" className={inputCls} value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
        </Field>
        <Field label="Target metric">
          <input className={inputCls} value={form.targetMetric} onChange={(e) => set('targetMetric', e.target.value)} placeholder="e.g. books read" />
        </Field>
        <Field label="Target value">
          <input type="number" className={inputCls} value={form.targetValue ?? ''}
            onChange={(e) => set('targetValue', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
        <Field label="Area">
          <select
            className={inputCls}
            value={form.areaId}
            onChange={(e) => {
              const areaId = e.target.value
              // Projects belong to an area; clear the project if it no longer fits.
              const keepProject = projects.some((p) => p.id === form.projectId && p.areaId === areaId)
              setForm((f) => (f ? { ...f, areaId, projectId: keepProject ? f.projectId : '' } : f))
            }}
          >
            <option value="">— none —</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select
            className={inputCls}
            value={form.projectId}
            onChange={(e) => set('projectId', e.target.value)}
            disabled={!form.areaId}
          >
            <option value="">— none (area-level goal) —</option>
            {projects.filter((p) => p.areaId === form.areaId).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Parent goal">
          <select className={inputCls} value={form.parentId} onChange={(e) => set('parentId', e.target.value)}>
            <option value="">— none —</option>
            {parentCandidates.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
      </div>

      <DependencyEditor
        currentIds={goal.dependsOn}
        candidates={depCandidates}
        titleOf={titleOfGoal}
        onAdd={(pid) => addDep.mutate({ dependentId: id, prerequisiteId: pid })}
        onRemove={(pid) => removeDep.mutate({ dependentId: id, prerequisiteId: pid })}
      />

      <AuditInfo rows={[
        ['Created', fmtTimestamp(goal.createdAt)],
        ['Completed', fmtTimestamp(goal.completedAt)],
        ['ID', goal.id],
      ]} />

      <Footer onSave={save} onClose={onClose} saving={update.isPending} error={error} />
    </div>
  )
}

// ════════════════════ AREA ════════════════════

function AreaDetailFields({ id, onClose }: { id: string; onClose: () => void }) {
  const utils = trpc.useUtils()
  // Areas have no `get` endpoint — find this one in the list.
  const areasQuery = trpc.area.list.useQuery()
  const area = (areasQuery.data ?? []).find((a) => a.id === id)

  const [name, setName] = useState<string | null>(null)
  const [color, setColor] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const update = trpc.area.update.useMutation({
    onSuccess: () => { void utils.area.list.invalidate(); onClose() },
    onError: (e) => setError(e.message),
  })

  useEffect(() => {
    if (area && name === null) {
      setName(area.name)
      setColor(area.color ?? '')
    }
  }, [area, name])

  if (areasQuery.isLoading || !area || name === null) {
    return <p className="text-sm text-muted py-6 text-center animate-pulse">Loading…</p>
  }

  function save() {
    update.mutate({ id, name: (name ?? '').trim(), color: color || null })
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label="Accent colour">
        <div className="flex items-center gap-2">
          <input type="color" value={color || '#888888'} onChange={(e) => setColor(e.target.value)}
            className="h-8 w-12 rounded border border-ink/10 bg-base cursor-pointer" />
          <input className={inputCls} value={color} onChange={(e) => setColor(e.target.value)} placeholder="#hex or CSS token (optional)" />
          {color && (
            <button onClick={() => setColor('')} className="text-xs text-muted hover:text-red shrink-0" aria-label="Clear colour">clear</button>
          )}
        </div>
      </Field>

      <AuditInfo rows={[
        ['Created', fmtTimestamp(area.createdAt)],
        ['ID', area.id],
      ]} />

      <Footer onSave={save} onClose={onClose} saving={update.isPending} error={error} />
    </div>
  )
}

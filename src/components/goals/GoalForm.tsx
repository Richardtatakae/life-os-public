'use client'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'

/**
 * GoalForm — the detail-rich "new goal" form used inside the Pursuits module.
 *
 * A goal is always created inside an Area (passed as `defaultAreaId` by the
 * area's "+ New goal" button), so there is no area picker here — the area is
 * implied by where you clicked. Fields follow a light SMART framing:
 *   • Title        — the objective
 *   • Why          — motivation (stored as `description`)
 *   • Success metric — how you'll measure it (metric label + target number)
 *   • Deadline     — target date
 *   • Parent goal  — optional bigger goal this nests under (same area)
 *   • Blocked by   — other goals that must be completed first (dependencies)
 */

interface GoalFormProps {
  /** The Area this goal is created in. */
  defaultAreaId?: string
  /** The Project this goal belongs to (when created inside a project). */
  defaultProjectId?: string
  /** Pre-fill the parent goal (for a "sub-goal" flow). */
  defaultParentId?: string
  onSuccess?: (goalId: string) => void
  onCancel?: () => void
}

export function GoalForm({ defaultAreaId, defaultProjectId, defaultParentId, onSuccess, onCancel }: GoalFormProps) {
  const [title, setTitle] = useState('')
  const [why, setWhy] = useState('')
  const [metric, setMetric] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [deadline, setDeadline] = useState('')
  const [parentId, setParentId] = useState(defaultParentId ?? '')
  const [dependsOn, setDependsOn] = useState<string[]>([])

  const utils = trpc.useUtils()
  const listQuery = trpc.goal.list.useQuery()
  const addDepMutation = trpc.goal.addDependency.useMutation()

  const createMutation = trpc.goal.create.useMutation({
    onSuccess: async (goal) => {
      // Wire up any goal-to-goal dependencies the user selected.
      await Promise.all(
        dependsOn.map((prerequisiteId) =>
          addDepMutation.mutateAsync({ dependentId: goal.id, prerequisiteId }),
        ),
      )
      await utils.goal.tree.invalidate()
      onSuccess?.(goal.id)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    const num = targetValue.trim() === '' ? null : Number(targetValue)
    createMutation.mutate({
      title: title.trim(),
      description: why.trim() || null,
      areaId: defaultAreaId ?? null,
      projectId: defaultProjectId ?? null,
      targetMetric: metric.trim() || null,
      targetValue: num != null && !Number.isNaN(num) ? num : null,
      deadline: deadline ? new Date(deadline) : null,
      parentId: parentId.trim() || null,
      status: 'active',
    })
  }

  const isPending = createMutation.isPending
  const error = createMutation.error ?? addDepMutation.error

  // Candidate parents/prerequisites: other goals (parents limited to same area).
  const allGoals = listQuery.data ?? []
  const parentCandidates = defaultAreaId
    ? allGoals.filter((g) => g.areaId === defaultAreaId)
    : allGoals
  const depCandidates = allGoals

  return (
    <form onSubmit={handleSubmit} className="bg-base border border-ink/10 rounded-lg p-3 space-y-3 mt-1">
      {/* Title */}
      <div>
        <label className="block text-xs text-muted mb-1">
          Goal <span className="text-red">*</span>
        </label>
        <input
          type="text"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Run a half-marathon"
          required
          className="w-full bg-surface border border-ink/10 rounded px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-emerald"
        />
      </div>

      {/* Why / motivation */}
      <div>
        <label className="block text-xs text-muted mb-1">Why does this matter?</label>
        <textarea
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="The reason behind it — what reaching this gives you."
          rows={2}
          className="w-full bg-surface border border-ink/10 rounded px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-emerald resize-none"
        />
      </div>

      {/* Success metric */}
      <div>
        <label className="block text-xs text-muted mb-1">How will you measure success?</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            placeholder="Metric — e.g. km run, books read"
            className="flex-1 bg-surface border border-ink/10 rounded px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-emerald"
          />
          <input
            type="number"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder="Target"
            className="w-24 bg-surface border border-ink/10 rounded px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-emerald"
          />
        </div>
      </div>

      {/* Deadline */}
      <div>
        <label className="block text-xs text-muted mb-1">Deadline (optional)</label>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="w-full bg-surface border border-ink/10 rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-emerald"
        />
      </div>

      {/* Parent goal */}
      {parentCandidates.length > 0 && (
        <div>
          <label className="block text-xs text-muted mb-1">Part of a bigger goal? (optional)</label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full bg-surface border border-ink/10 rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-emerald"
          >
            <option value="">— None (top-level goal) —</option>
            {parentCandidates.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
        </div>
      )}

      {/* Dependencies (blocked by another goal) */}
      {depCandidates.length > 0 && (
        <div>
          <label className="block text-xs text-muted mb-1">Blocked by another goal? (optional)</label>
          {dependsOn.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {dependsOn.map((id) => (
                <span key={id} className="text-xs px-1.5 py-0.5 rounded bg-ink/10 text-muted flex items-center gap-1">
                  {allGoals.find((g) => g.id === id)?.title ?? id}
                  <button
                    type="button"
                    onClick={() => setDependsOn((prev) => prev.filter((x) => x !== id))}
                    className="hover:text-red"
                    aria-label="Remove dependency"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value
              if (v) setDependsOn((prev) => (prev.includes(v) ? prev : [...prev, v]))
            }}
            className="w-full bg-surface border border-ink/10 rounded px-3 py-2 text-sm text-muted focus:outline-none focus:border-emerald"
          >
            <option value="">+ must finish this goal first…</option>
            {depCandidates
              .filter((g) => !dependsOn.includes(g.id))
              .map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
          </select>
        </div>
      )}

      {error && <p className="text-red text-xs">{error.message}</p>}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={isPending || !title.trim()}
          className="flex-1 px-4 py-2 rounded bg-emerald text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {isPending ? 'Saving…' : 'Create goal'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded border border-ink/20 text-sm text-muted hover:bg-ink/5 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

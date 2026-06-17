'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'

// ── Types ─────────────────────────────────────────────────────────────────

interface TaskFormProps {
  /** If provided, the form edits an existing task instead of creating one. */
  taskId?: string
  initialValues?: {
    title?: string
    priority?: number | null
    energy?: 'high' | 'medium' | 'low' | null
    estimateMin?: number | null
    deadline?: Date | null
    notes?: string | null
  }
  onSuccess?: () => void
  onCancel?: () => void
}

// ── Component ─────────────────────────────────────────────────────────────

export function TaskForm({ taskId, initialValues, onSuccess, onCancel }: TaskFormProps) {
  const isEditing = Boolean(taskId)

  const [title, setTitle] = useState(initialValues?.title ?? '')
  const [priority, setPriority] = useState<string>(
    initialValues?.priority !== null && initialValues?.priority !== undefined
      ? String(initialValues.priority)
      : ''
  )
  const [energy, setEnergy] = useState<string>(initialValues?.energy ?? '')
  const [estimateMin, setEstimateMin] = useState<string>(
    initialValues?.estimateMin !== null && initialValues?.estimateMin !== undefined
      ? String(initialValues.estimateMin)
      : ''
  )
  const [deadline, setDeadline] = useState<string>(
    initialValues?.deadline
      ? initialValues.deadline.toISOString().slice(0, 10)
      : ''
  )
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const utils = trpc.useUtils()

  const createMutation = trpc.task.create.useMutation({
    onSuccess: () => {
      void utils.task.todayList.invalidate()
      void utils.task.list.invalidate()
      onSuccess?.()
    },
    onError: (err) => setError(err.message),
  })

  const updateMutation = trpc.task.update.useMutation({
    onSuccess: () => {
      void utils.task.todayList.invalidate()
      void utils.task.list.invalidate()
      onSuccess?.()
    },
    onError: (err) => setError(err.message),
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setError(null)

    const parsed = {
      title: title.trim(),
      priority: priority ? parseInt(priority, 10) : null,
      energy: (energy || null) as 'high' | 'medium' | 'low' | null,
      estimateMin: estimateMin ? parseInt(estimateMin, 10) : null,
      deadline: deadline ? new Date(deadline) : null,
      notes: notes || null,
    }

    if (isEditing && taskId) {
      updateMutation.mutate({ id: taskId, ...parsed })
    } else {
      createMutation.mutate(parsed)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 bg-surface rounded-xl p-5 w-full max-w-md"
    >
      <h2 className="text-lg font-semibold text-ink">
        {isEditing ? 'Edit task' : 'New task'}
      </h2>

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label htmlFor="task-title" className="text-xs text-muted uppercase tracking-wide">
          Title *
        </label>
        <input
          id="task-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          required
          className="bg-base border border-line rounded-lg px-3 py-2
            text-ink placeholder:text-faint focus:outline-none
            focus:border-emerald text-sm"
        />
      </div>

      {/* Priority + Energy row */}
      <div className="flex gap-3">
        {/* Priority */}
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="task-priority" className="text-xs text-muted uppercase tracking-wide">
            Priority
          </label>
          <select
            id="task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="bg-base border border-line rounded-lg px-3 py-2
              text-ink focus:outline-none focus:border-emerald text-sm"
          >
            <option value="">None</option>
            <option value="1">P1 — Critical</option>
            <option value="2">P2 — High</option>
            <option value="3">P3 — Medium</option>
            <option value="4">P4 — Low</option>
            <option value="5">P5 — Backlog</option>
          </select>
        </div>

        {/* Energy */}
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="task-energy" className="text-xs text-muted uppercase tracking-wide">
            Energy
          </label>
          <select
            id="task-energy"
            value={energy}
            onChange={(e) => setEnergy(e.target.value)}
            className="bg-base border border-line rounded-lg px-3 py-2
              text-ink focus:outline-none focus:border-emerald text-sm"
          >
            <option value="">None</option>
            <option value="high">⚡ High</option>
            <option value="medium">🔶 Medium</option>
            <option value="low">🌿 Low</option>
          </select>
        </div>
      </div>

      {/* Estimate + Deadline row */}
      <div className="flex gap-3">
        {/* Estimate */}
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="task-estimate" className="text-xs text-muted uppercase tracking-wide">
            Estimate (min)
          </label>
          <input
            id="task-estimate"
            type="number"
            min={0}
            value={estimateMin}
            onChange={(e) => setEstimateMin(e.target.value)}
            placeholder="e.g. 30"
            className="bg-base border border-line rounded-lg px-3 py-2
              text-ink placeholder:text-faint focus:outline-none
              focus:border-emerald text-sm"
          />
        </div>

        {/* Deadline */}
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="task-deadline" className="text-xs text-muted uppercase tracking-wide">
            Deadline
          </label>
          <input
            id="task-deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="bg-base border border-line rounded-lg px-3 py-2
              text-ink focus:outline-none focus:border-emerald text-sm
              [color-scheme:dark]"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1">
        <label htmlFor="task-notes" className="text-xs text-muted uppercase tracking-wide">
          Notes
        </label>
        <textarea
          id="task-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional context…"
          rows={3}
          className="bg-base border border-line rounded-lg px-3 py-2
            text-ink placeholder:text-faint focus:outline-none
            focus:border-emerald text-sm resize-none"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red">{error}</p>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 mt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg text-muted
              hover:text-ink transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 text-sm rounded-lg bg-emerald text-white font-semibold
            hover:bg-emerald-deep disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Add task'}
        </button>
      </div>
    </form>
  )
}

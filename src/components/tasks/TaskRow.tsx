'use client'

import type { TaskListItem } from '@/stores/taskStore'
import { useUiStore } from '@/stores/uiStore'
import { beginWarmup } from '@/stores/warmupStore'
import { useVowStore } from '@/stores/vowStore'

// ── Helpers ────────────────────────────────────────────────────────────────

function priorityColor(priority: number | null): string {
  switch (priority) {
    case 1: return 'bg-red text-white'   // red — critical
    case 2: return 'bg-amber text-black'   // amber — high
    case 3: return 'bg-purple text-white'   // purple — medium
    case 4: return 'bg-emerald text-white'   // emerald — low
    case 5: return 'bg-line text-muted' // grey — backlog
    default: return 'bg-slate text-muted'
  }
}

function energyEmoji(energy: string | null): string {
  switch (energy) {
    case 'high':   return '⚡'
    case 'medium': return '🔶'
    case 'low':    return '🌿'
    default:       return ''
  }
}

function relativeDeadline(deadline: Date | null): string | null {
  if (!deadline) return null
  const now = new Date()
  const diff = deadline.getTime() - now.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `in ${days}d`
}

// ── Props ─────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: TaskListItem
  onComplete: (task: TaskListItem) => void
  onDefer?: (task: TaskListItem) => void
  dimmed?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────

export function TaskRow({ task, onComplete, onDefer, dimmed = false }: TaskRowProps) {
  const isDone = task.status === 'done'
  const deadlineLabel = relativeDeadline(task.deadline)
  const isOverdue = deadlineLabel?.includes('overdue') ?? false
  const openPromptModal = useUiStore((s) => s.openPromptModal)
  const openFocusMode = useUiStore((s) => s.openFocusMode)
  const activeVow = useVowStore((s) => s.vow)
  const setActivationTaskId = useVowStore((s) => s.setActivationTaskId)

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-opacity
        ${dimmed ? 'opacity-50' : 'opacity-100'}
        ${isDone ? 'opacity-40' : ''}
        hover:bg-surface`}
    >
      {/* Checkbox — plain styled input to avoid cross-plan coupling */}
      <input
        type="checkbox"
        checked={isDone}
        onChange={() => !isDone && onComplete(task)}
        disabled={isDone}
        aria-label={`Complete task: ${task.title}`}
        className="w-4 h-4 cursor-pointer accent-emerald shrink-0"
      />

      {/* Priority pill */}
      {task.priority !== null && (
        <span
          className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${priorityColor(task.priority)}`}
        >
          P{task.priority}
        </span>
      )}

      {/* Title */}
      <span
        className={`flex-1 text-sm truncate
          ${isDone ? 'line-through text-faint' : 'text-ink'}`}
      >
        {task.title}
      </span>

      {/* Energy emoji */}
      {task.energy && (
        <span className="text-sm shrink-0" title={`Energy: ${task.energy}`}>
          {energyEmoji(task.energy)}
        </span>
      )}

      {/* Estimate */}
      {task.estimateMin !== null && (
        <span className="text-xs text-muted shrink-0">
          {task.estimateMin}m
        </span>
      )}

      {/* Deadline */}
      {deadlineLabel && (
        <span
          className={`text-xs shrink-0 ${
            isOverdue ? 'text-red' : 'text-muted'
          }`}
        >
          {deadlineLabel}
        </span>
      )}

      {/* Focus mode — work on just this task in a full-screen environment. */}
      {!isDone && (
        <button
          onClick={() => openFocusMode(task.id)}
          className="text-xs text-muted hover:text-emerald px-1.5 py-0.5
            rounded transition-colors shrink-0"
          aria-label={`Focus mode: ${task.title}`}
          title="Focus mode"
        >
          ▶ Focus
        </button>
      )}

      {/* "Just 2 minutes" — a no-pressure warm-up that starts focus immediately. */}
      {!isDone && (
        <button
          onClick={() => beginWarmup(task.id)}
          className="text-xs text-muted hover:text-emerald px-1.5 py-0.5
            rounded transition-colors shrink-0"
          aria-label={`Just 2 minutes: ${task.title}`}
          title="Just 2 minutes — a no-pressure warm-up"
        >
          2 min
        </button>
      )}

      {/* Vow button — hidden when a vow is already active; only shown on undone tasks */}
      {!isDone && !activeVow && (
        <button
          onClick={() => setActivationTaskId(task.id)}
          className="text-xs text-muted hover:text-amber px-1.5 py-0.5
            rounded transition-colors shrink-0"
          aria-label={`Nothing else until this is done: ${task.title}`}
          title="Nothing else until this is done"
        >
          ⛓
        </button>
      )}

      {/* Defer button (optional) */}
      {onDefer && !isDone && (
        <button
          onClick={() => onDefer(task)}
          className="text-xs text-muted hover:text-amber px-1.5 py-0.5
            rounded transition-colors shrink-0"
          aria-label={`Defer task: ${task.title}`}
        >
          Defer
        </button>
      )}

      {/* Copy prompt button */}
      <button
        onClick={() => openPromptModal({ open: true, kind: 'task', entityId: task.id })}
        className="text-xs text-muted hover:text-purple px-1.5 py-0.5
          rounded transition-colors shrink-0"
        aria-label={`Copy prompt for task: ${task.title}`}
        title="Copy prompt"
      >
        ⌘
      </button>
    </div>
  )
}

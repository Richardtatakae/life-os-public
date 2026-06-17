'use client'
import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { usePomodoroStore, formatRemaining, formatElapsed } from '@/stores/pomodoroStore'

const DURATION_OPTIONS = [15, 25, 50, 90] as const
type DurationOption = (typeof DURATION_OPTIONS)[number]

/**
 * @param inline — when true the widget renders as a normal in-flow box (fills its
 *   container, draggable by its header) instead of the fixed bottom-right overlay.
 *   The dashboard uses this so the Pomodoro is a movable/minimizable element.
 */
export function PomodoroWidget({ inline = false }: { inline?: boolean } = {}) {
  const store = usePomodoroStore()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [showStartMenu, setShowStartMenu] = useState(false)
  const [selectedDuration, setSelectedDuration] = useState<DurationOption>(25)

  // tRPC queries and mutations
  const utils = trpc.useUtils()
  const { data: current, isLoading } = trpc.pomodoro.current.useQuery(undefined, {
    refetchInterval: 5000,
  })

  const startMutation = trpc.pomodoro.start.useMutation({
    onSuccess: () => utils.pomodoro.current.invalidate(),
  })
  const pauseMutation = trpc.pomodoro.pause.useMutation({
    onSuccess: () => utils.pomodoro.current.invalidate(),
  })
  const resumeMutation = trpc.pomodoro.resume.useMutation({
    onSuccess: () => utils.pomodoro.current.invalidate(),
  })
  const completeMutation = trpc.pomodoro.complete.useMutation({
    onSuccess: () => {
      store.clear()
      utils.pomodoro.current.invalidate()
    },
  })
  const abandonMutation = trpc.pomodoro.abandon.useMutation({
    onSuccess: () => {
      store.clear()
      utils.pomodoro.current.invalidate()
    },
  })

  // Sync server state into store
  useEffect(() => {
    if (current) {
      store.setCurrent({
        id: current.id,
        startedAt: new Date(current.startedAt),
        status: current.status as 'running' | 'paused',
        targetMin: current.targetMin,
        pausedMs: current.pausedMs,
        taskId: current.taskId ?? null,
      })
    } else if (!isLoading) {
      store.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, isLoading])

  // Tick interval — only run when status is running
  useEffect(() => {
    if (store.status === 'running') {
      intervalRef.current = setInterval(() => store.tick(), 1000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.status])

  const isRunning = store.status === 'running'
  const isPaused = store.status === 'paused'
  const hasActive = isRunning || isPaused

  const progressPct =
    hasActive && store.targetMin
      ? Math.min(100, (store.elapsedMs / (store.targetMin * 60 * 1000)) * 100)
      : 0

  const timeDisplay = hasActive
    ? store.targetMin
      ? formatRemaining(store.elapsedMs, store.targetMin)
      : formatElapsed(store.elapsedMs)
    : `${selectedDuration}:00`

  const stateColor = isRunning
    ? 'border-emerald'
    : isPaused
      ? 'border-amber'
      : 'border-ink/10'

  const stateTextColor = isRunning ? 'text-emerald' : isPaused ? 'text-amber' : 'text-muted'

  return (
    <div
      className={`panel tint-red rounded-xl border bg-surface p-4 ${stateColor} transition-colors ${
        inline ? 'h-full w-full' : 'fixed bottom-4 right-4 z-50 w-64 shadow-2xl'
      }`}
    >
      {/* Header — doubles as the drag handle when inline (on the dashboard). */}
      <div
        className={`mb-2 flex items-center justify-between ${
          inline ? 'box-drag-handle cursor-grab select-none active:cursor-grabbing' : ''
        }`}
        title={inline ? 'Drag to move · drag any edge to resize' : undefined}
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-faint">
          Pomodoro
        </span>
        {hasActive && (
          <span
            className={`flex items-center gap-1 text-xs font-medium ${stateTextColor}`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${isRunning ? 'animate-pulse bg-emerald' : 'bg-amber'}`}
            />
            {isRunning ? 'Running' : 'Paused'}
          </span>
        )}
      </div>

      {/* Task label */}
      {hasActive && (
        <div className="mb-2 truncate text-xs text-muted">
          {current?.taskId ? `Task: ${current.taskId}` : 'No task — focus block'}
        </div>
      )}

      {/* Time display */}
      <div className={`mb-3 text-center font-mono text-4xl font-bold ${stateTextColor}`}>
        {timeDisplay}
      </div>

      {/* Progress bar */}
      {hasActive && (
        <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-ink/10">
          <div
            className={`h-full rounded-full transition-all ${isRunning ? 'bg-emerald' : 'bg-amber'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2">
        {!hasActive ? (
          // Start button with dropdown
          <div className="relative flex-1">
            <button
              onClick={() => setShowStartMenu((v) => !v)}
              className="w-full rounded-lg bg-emerald px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 active:scale-95"
            >
              Start · {selectedDuration}min ▾
            </button>
            {showStartMenu && (
              <div className="absolute bottom-full mb-1 left-0 w-full rounded-lg border border-ink/10 bg-surface py-1 shadow-xl">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d}
                    className={`w-full px-3 py-1.5 text-left text-sm transition hover:bg-ink/10 ${
                      selectedDuration === d ? 'text-emerald' : 'text-muted'
                    }`}
                    onClick={() => {
                      setSelectedDuration(d)
                      setShowStartMenu(false)
                      startMutation.mutate({ targetMin: d })
                    }}
                  >
                    {d} minutes
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Pause / Resume */}
            {isRunning ? (
              <button
                onClick={() => current && pauseMutation.mutate({ id: current.id })}
                disabled={pauseMutation.isPending}
                className="flex-1 rounded-lg bg-amber px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                Pause
              </button>
            ) : (
              <button
                onClick={() => current && resumeMutation.mutate({ id: current.id })}
                disabled={resumeMutation.isPending}
                className="flex-1 rounded-lg bg-emerald px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                Resume
              </button>
            )}

            {/* Complete */}
            <button
              onClick={() => current && completeMutation.mutate({ id: current.id })}
              disabled={completeMutation.isPending}
              className="rounded-lg bg-ink/10 px-3 py-2 text-sm font-medium text-muted transition hover:bg-ink/20 active:scale-95 disabled:opacity-50"
              title="Complete"
            >
              ✓
            </button>

            {/* Abandon */}
            <button
              onClick={() => current && abandonMutation.mutate({ id: current.id })}
              disabled={abandonMutation.isPending}
              className="rounded-lg bg-ink/10 px-3 py-2 text-sm font-medium text-muted transition hover:bg-ink/20 active:scale-95 disabled:opacity-50"
              title="Abandon"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Duration selector when no active pomodoro */}
      {!hasActive && (
        <div className="mt-2 flex justify-center gap-1">
          {DURATION_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDuration(d)}
              className={`rounded px-2 py-0.5 text-xs transition ${
                selectedDuration === d
                  ? 'bg-emerald text-white'
                  : 'text-faint hover:text-muted'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

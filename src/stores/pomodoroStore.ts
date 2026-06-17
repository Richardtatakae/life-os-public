'use client'
import { create } from 'zustand'

interface PomodoroState {
  currentId: string | null
  startedAt: Date | null
  status: 'running' | 'paused' | null
  targetMin: number | null
  elapsedMs: number
  pausedMs: number
  taskId: string | null
  setCurrent: (p: {
    id: string
    startedAt: Date
    status: 'running' | 'paused'
    targetMin: number
    pausedMs: number
    taskId: string | null
  }) => void
  clear: () => void
  tick: () => void
}

export const usePomodoroStore = create<PomodoroState>((set, get) => ({
  currentId: null,
  startedAt: null,
  status: null,
  targetMin: null,
  elapsedMs: 0,
  pausedMs: 0,
  taskId: null,

  setCurrent: (p) =>
    set((state) => {
      // Derive elapsed live from startedAt instead of resetting to 0. The old
      // `elapsedMs: 0` made every server re-fetch flash the full target time
      // (e.g. "25:00") for one frame before the next 1s tick corrected it.
      const derived = Math.max(0, Date.now() - p.startedAt.getTime() - p.pausedMs)
      return {
        currentId: p.id,
        startedAt: p.startedAt,
        status: p.status,
        targetMin: p.targetMin,
        pausedMs: p.pausedMs,
        taskId: p.taskId,
        // Running: live value. Paused: the timer is frozen, so keep the last
        // ticked value for the same session; fall back to derived on first load.
        elapsedMs:
          p.status === 'running'
            ? derived
            : state.currentId === p.id
              ? state.elapsedMs
              : derived,
      }
    }),

  clear: () =>
    set({
      currentId: null,
      startedAt: null,
      status: null,
      targetMin: null,
      elapsedMs: 0,
      pausedMs: 0,
      taskId: null,
    }),

  tick: () => {
    const s = get()
    if (s.status === 'running' && s.startedAt) {
      set({ elapsedMs: Date.now() - s.startedAt.getTime() - s.pausedMs })
    }
  },
}))

/** Format milliseconds as mm:ss */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Format remaining time as mm:ss (clamps to 00:00 if over target) */
export function formatRemaining(elapsedMs: number, targetMin: number): string {
  const targetMs = targetMin * 60 * 1000
  const remainingMs = Math.max(0, targetMs - elapsedMs)
  return formatElapsed(remainingMs)
}

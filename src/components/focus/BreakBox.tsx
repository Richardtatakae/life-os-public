'use client'

/**
 * BreakBox.tsx — a floating bottom-right card that shows the running Focus-mode
 * BREAK countdown when you've stepped out of Focus mode.
 *
 * Focus mode locks you in while a work interval runs, but once the break starts
 * the overlay is dismissible. If you close it mid-break, this box appears so the
 * break timer keeps counting where you can see it; tapping it drops you straight
 * back into Focus mode for that task. It hides itself while the Focus overlay is
 * open (the overlay shows the break itself) and clears when the break is skipped
 * or a new interval begins.
 *
 * The break lives in `breakStore` (see there for why it's global + in-memory).
 */

import { useEffect, useState } from 'react'
import { useBreakStore } from '@/stores/breakStore'
import { useUiStore, openFocusMode } from '@/stores/uiStore'
import { formatElapsed } from '@/stores/pomodoroStore'
import { playChime } from '@/lib/chime'

export function BreakBox() {
  const taskId = useBreakStore((s) => s.taskId)
  const taskTitle = useBreakStore((s) => s.taskTitle)
  const until = useBreakStore((s) => s.until)
  const chimed = useBreakStore((s) => s.chimed)
  const clearBreak = useBreakStore((s) => s.clearBreak)
  const markChimed = useBreakStore((s) => s.markChimed)
  const focusOpen = useUiStore((s) => s.focusModal.open)

  const [nowTick, setNowTick] = useState(() => Date.now())

  // Re-render once a second while a break is active so the countdown moves.
  const active = until !== null && !focusOpen
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  // Chime once when the break runs out here (audio was primed when the break
  // started, from the "End interval" click in Focus mode). The `chimed` guard is
  // shared via the store so the overlay and this box never double-fire.
  useEffect(() => {
    if (until === null || chimed) return
    if (nowTick >= until) {
      markChimed()
      playChime()
    }
  }, [until, chimed, nowTick, markChimed])

  if (!active || until === null || !taskId) return null

  const remainingMs = Math.max(0, until - nowTick)
  const over = remainingMs <= 0

  return (
    <div className="fixed bottom-4 right-4 z-[190] w-64 select-none">
      <div
        role="button"
        tabIndex={0}
        onClick={() => openFocusMode(taskId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openFocusMode(taskId)
        }}
        className="group relative cursor-pointer rounded-2xl border border-purple-500/40 bg-surface/95 p-4 shadow-2xl backdrop-blur transition-colors hover:border-purple-400"
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            clearBreak()
          }}
          title="Dismiss break"
          className="absolute right-2 top-2 rounded-md px-1.5 text-sm text-faint hover:bg-ink/10 hover:text-ink transition-colors"
        >
          ✕
        </button>

        <div className="text-[11px] font-semibold uppercase tracking-widest text-purple-300">
          {over ? "Break's up" : 'On a break'}
        </div>
        <div className="mt-1 font-mono text-3xl font-bold text-purple-400">
          {formatElapsed(remainingMs)}
        </div>
        <div className="mt-1 truncate text-xs text-muted" title={taskTitle ?? undefined}>
          {taskTitle ?? 'this task'}
        </div>
        <div className="mt-2 text-[11px] text-faint group-hover:text-muted transition-colors">
          {over ? 'Tap to get back to it →' : 'Tap to return to Focus →'}
        </div>
      </div>
    </div>
  )
}

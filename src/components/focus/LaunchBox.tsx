'use client'

/**
 * LaunchBox.tsx — a floating bottom-right card showing the running "on-deck"
 * launch countdown, and the thing that fires when it hits zero.
 *
 * You configure + start a launch countdown from the Focus overlay's idle screen,
 * then you're free to close Focus mode and roam other tabs. This box keeps the
 * countdown visible wherever you are; tapping it drops you back into Focus mode
 * for that target so you can keep setting up. When the countdown reaches zero it:
 *   1. plays the chime (primed when the countdown was started, from that click),
 *   2. auto-starts the chosen Pomodoro for the target,
 *   3. force-opens Focus mode — "thrown into focus mode" — into the locked work
 *      phase (the overlay picks up the running Pomodoro and locks itself).
 *
 * The countdown lives in `launchStore` (see there for why it's global + in-memory).
 * This component is always mounted (in GlobalOverlays) so it ticks + fires even
 * when the overlay is closed and you're on another tab.
 */

import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useLaunchStore } from '@/stores/launchStore'
import { openFocusMode } from '@/stores/uiStore'
import { formatElapsed } from '@/stores/pomodoroStore'
import { playChime } from '@/lib/chime'

export function LaunchBox() {
  const targetKind = useLaunchStore((s) => s.targetKind)
  const targetId = useLaunchStore((s) => s.targetId)
  const targetTitle = useLaunchStore((s) => s.targetTitle)
  const until = useLaunchStore((s) => s.until)
  const workMin = useLaunchStore((s) => s.workMin)
  const clearLaunch = useLaunchStore((s) => s.clearLaunch)

  const utils = trpc.useUtils()
  const startPomodoro = trpc.pomodoro.start.useMutation({
    onSuccess: () => utils.pomodoro.current.invalidate(),
  })

  const [nowTick, setNowTick] = useState(() => Date.now())
  // Guard keyed on the deadline so each distinct countdown fires exactly once,
  // even though this single instance persists across multiple launches.
  const firedForRef = useRef<number | null>(null)

  // Re-render once a second while a countdown is active so the time moves.
  const active = until !== null
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  // When the countdown reaches zero: chime, start the real Pomodoro, throw the
  // user into Focus mode. Audio was primed from the "Start launch countdown"
  // click, so playback is allowed here.
  useEffect(() => {
    if (until === null || targetId === null) return
    if (nowTick >= until && firedForRef.current !== until) {
      firedForRef.current = until
      playChime()
      const target =
        targetKind === 'task' ? { taskId: targetId }
        : targetKind === 'goal' ? { goalId: targetId }
        : targetKind === 'project' ? { projectId: targetId }
        : { areaId: targetId }
      startPomodoro.mutate({ ...target, targetMin: Math.max(1, Math.min(180, workMin)) })
      openFocusMode({ kind: targetKind, id: targetId })
      clearLaunch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until, targetId, targetKind, workMin, nowTick])

  if (until === null || targetId === null) return null

  const remainingMs = Math.max(0, until - nowTick)

  return (
    <div className="fixed bottom-4 right-4 z-[190] w-64 select-none">
      <div
        role="button"
        tabIndex={0}
        onClick={() => openFocusMode({ kind: targetKind, id: targetId })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openFocusMode({ kind: targetKind, id: targetId })
        }}
        className="group relative cursor-pointer rounded-2xl border border-emerald/40 bg-surface/95 p-4 shadow-2xl backdrop-blur transition-colors hover:border-emerald"
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            clearLaunch()
          }}
          title="Cancel launch countdown"
          className="absolute right-2 top-2 rounded-md px-1.5 text-sm text-faint hover:bg-ink/10 hover:text-ink transition-colors"
        >
          ✕
        </button>

        <div className="text-[11px] font-semibold uppercase tracking-widest text-emerald">
          On deck — starting soon
        </div>
        <div className="mt-1 font-mono text-3xl font-bold text-emerald">
          {formatElapsed(remainingMs)}
        </div>
        <div className="mt-1 truncate text-xs text-muted" title={targetTitle ?? undefined}>
          {targetTitle ?? 'this task'}
        </div>
        <div className="mt-2 text-[11px] text-faint group-hover:text-muted transition-colors">
          Roam freely — it&apos;ll pull you in →
        </div>
      </div>
    </div>
  )
}

'use client'

/**
 * VowSplash.tsx — once-per-session splash shown when the app launches
 * with an active vow.
 *
 * Appears briefly (2.5s or on click) so the user is never confused about
 * why the UI looks different after reopening the app.
 *
 * Module-level flag ensures it never shows twice in the same browser session.
 */

import { useEffect, useState } from 'react'
import { useVowStore } from '@/stores/vowStore'

// Module-level: only show once per JS lifetime (per tab/session)
let splashShownThisSession = false

export function VowSplash() {
  const vow = useVowStore((s) => s.vow)
  const [visible, setVisible] = useState(false)
  const [frozen, setFrozen] = useState<{ taskTitle: string; finishCriteria: string } | null>(null)

  useEffect(() => {
    // Only show if we haven't shown yet this session and there IS an active vow
    if (splashShownThisSession) return
    if (!vow) return

    // Freeze the content at the time we first detect a vow (avoids flicker
    // when the query re-fetches mid-display)
    setFrozen({ taskTitle: vow.taskTitle, finishCriteria: vow.finishCriteria })
    splashShownThisSession = true
    setVisible(true)

    const t = setTimeout(() => setVisible(false), 2500)
    return () => clearTimeout(t)
  }, [vow])

  if (!visible || !frozen) return null

  return (
    /* z-[205] — above VowBar (150), VowActivationModal (200), everything else */
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vow Mode reminder"
      className="fixed inset-0 z-[205] flex flex-col items-center justify-center bg-base/95 transition-opacity"
      onClick={() => setVisible(false)}
    >
      {/* Chain icon */}
      <div className="mb-4 text-5xl select-none">⛓</div>

      {/* Headline */}
      <div className="text-3xl font-bold text-amber-light tracking-tight mb-3">
        You&apos;re still in it.
      </div>

      {/* Task title */}
      <div className="max-w-sm text-center text-lg font-semibold text-amber mb-2 px-6">
        {frozen.taskTitle}
      </div>

      {/* Finish criteria */}
      <div className="max-w-xs text-center text-sm text-muted px-6 leading-relaxed">
        {frozen.finishCriteria}
      </div>

      {/* Dismiss hint */}
      <div className="mt-8 text-xs text-faint select-none">
        Click anywhere to continue
      </div>
    </div>
  )
}

'use client'

/**
 * PursuitsPickerOverlay — the "＋ From Pursuits" popup for the day planner.
 *
 * It IS the Pursuits module: the very same <TaskTree> the Pursuits tab renders,
 * with all of its functionality (areas/projects/goals/tasks, add/edit/complete,
 * drag-to-reorder, details, focus, and the ☆ Today button that pushes an item
 * onto today's planner box). It's shown in a dim overlay that closes on a
 * click-away, on Esc, or via the × — so you can push several items and the
 * popup stays open until you dismiss it.
 *
 * Rendered through a portal to <body> so it sits under the app theme (matching
 * the Pursuits tab, including light/dark) rather than the planner's warm-paper
 * scope.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { PursuitsColumns } from '@/components/pursuits/PursuitsColumns'
import { PlannerDateProvider } from '@/components/tasks/dailyPlanContext'

export function PursuitsPickerOverlay({
  date,
  onClose,
}: {
  /** The planner day items toggled here are added to (the day being viewed). */
  date: string
  onClose: () => void
}) {
  // Esc closes too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="app-root fixed inset-0 z-[60] flex items-start justify-center
                 bg-black/50 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative flex w-full max-w-3xl flex-col" style={{ maxHeight: '88vh' }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-2 -top-2 z-10 flex h-8 w-8 items-center justify-center
                     rounded-full bg-surface text-lg text-muted shadow-md
                     hover:text-ink"
        >
          ×
        </button>
        {/* PursuitsColumns is h-full + scrolls internally; this wrapper bounds its height.
            The provider points every ☆ toggle inside at the viewed day. */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg shadow-2xl">
          <PlannerDateProvider value={date}>
            <PursuitsColumns />
          </PlannerDateProvider>
        </div>
      </div>
    </div>,
    document.body,
  )
}

'use client'

/**
 * VowActivationModal — activation ritual for Vow Mode.
 *
 * Opens when `activationTaskId` in vowStore is non-null.
 * Mounted globally by GlobalOverlays with no props.
 *
 * Flow:
 *   1. User writes finish criteria (required).
 *   2. Seven rules are displayed.
 *   3. Press-and-hold commit button for VOW_HOLD_MS to activate.
 *   4. On success → setVow, setKeptCount, close modal.
 *   5. On CONFLICT error → inline message, no crash.
 *   6. Esc / backdrop click → close (no vow made).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useVowStore } from '@/stores/vowStore'
import { VOW_HOLD_MS, VOW_RULES } from './vowRules'

// ─────────────────────────────────────────────────────────────────────────────

export function VowActivationModal() {
  const activationTaskId = useVowStore((s) => s.activationTaskId)
  const setActivationTaskId = useVowStore((s) => s.setActivationTaskId)
  const setVow = useVowStore((s) => s.setVow)
  const setKeptCount = useVowStore((s) => s.setKeptCount)

  const [finishCriteria, setFinishCriteria] = useState('')
  const [conflictError, setConflictError] = useState<string | null>(null)

  // Press-and-hold state
  const [progress, setProgress] = useState(0) // 0–100
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number | null>(null)

  // Fetch the task title when a taskId is set.
  const { data: task } = trpc.task.get.useQuery(
    { id: activationTaskId! },
    { enabled: activationTaskId !== null },
  )

  const activate = trpc.vow.activate.useMutation({
    onSuccess: (result) => {
      setVow(result)
      setKeptCount(result.keptCount)
      setActivationTaskId(null)
    },
    onError: (err) => {
      if (err.data?.code === 'CONFLICT' || err.message.includes('CONFLICT') || err.message.toLowerCase().includes('active')) {
        setConflictError('A vow is already active — only one at a time.')
      } else {
        setConflictError(err.message)
      }
    },
  })

  // Reset local state when modal opens for a new task.
  useEffect(() => {
    if (activationTaskId) {
      setFinishCriteria('')
      setConflictError(null)
      setProgress(0)
    }
  }, [activationTaskId])

  // Esc closes modal.
  useEffect(() => {
    if (!activationTaskId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationTaskId])

  function close() {
    cancelHold()
    setActivationTaskId(null)
  }

  function cancelHold() {
    if (holdRef.current) {
      clearInterval(holdRef.current)
      holdRef.current = null
    }
    startTimeRef.current = null
    setProgress(0)
  }

  const commitDisabled = finishCriteria.trim() === '' || activate.isPending

  function startHold() {
    if (commitDisabled) return
    startTimeRef.current = Date.now()
    holdRef.current = setInterval(() => {
      const elapsed = Date.now() - (startTimeRef.current ?? Date.now())
      const pct = Math.min((elapsed / VOW_HOLD_MS) * 100, 100)
      setProgress(pct)
      if (pct >= 100) {
        cancelHold()
        setProgress(100)
        activate.mutate({ taskId: activationTaskId!, finishCriteria: finishCriteria.trim() })
      }
    }, 16)
  }

  const stopHold = useCallback(() => {
    if (holdRef.current) cancelHold()
  }, [])

  if (!activationTaskId) return null

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      {/* Panel */}
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl border border-amber/30 bg-surface shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-widest text-amber font-semibold">Vow Mode</span>
            <h2 className="text-base font-bold text-ink leading-tight">
              {task?.title ?? '…'}
            </h2>
          </div>
          <button
            onClick={close}
            className="text-muted hover:text-ink transition-colors text-lg leading-none p-1"
            aria-label="Close without vowing"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-5">
          {/* Finish criteria */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="vow-finish-criteria"
              className="text-xs font-semibold uppercase tracking-wider text-amber"
            >
              Done means:
            </label>
            <textarea
              id="vow-finish-criteria"
              rows={3}
              value={finishCriteria}
              onChange={(e) => { setFinishCriteria(e.target.value); setConflictError(null) }}
              placeholder="I can… / X is shipped / the page renders… — write the moment this ends well."
              className="bg-base border border-amber/20 rounded-lg px-3 py-2 text-sm text-ink
                placeholder:text-muted focus:outline-none focus:border-amber resize-none w-full"
            />
          </div>

          {/* Rules */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted font-semibold">The Seven Rules</span>
            <ol className="flex flex-col gap-1.5">
              {VOW_RULES.map((rule, i) => (
                <li key={i} className="flex gap-2.5 text-xs">
                  <span className="text-amber font-bold shrink-0 w-4 text-right">{i + 1}.</span>
                  <span>
                    <span className="font-semibold text-ink">{rule.title}</span>
                    {' '}
                    <span className="text-muted">{rule.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Conflict error */}
          {conflictError && (
            <p className="text-xs text-amber-light bg-amber/10 border border-amber/20 rounded-lg px-3 py-2">
              {conflictError}
            </p>
          )}

          {/* Press-and-hold commit */}
          <div className="relative overflow-hidden rounded-xl">
            {/* Amber fill progress bar (behind the button text) */}
            <div
              className="absolute inset-0 bg-amber/30 transition-none"
              style={{ width: `${progress}%`, transitionProperty: 'none' }}
            />
            <button
              onPointerDown={startHold}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              disabled={commitDisabled}
              className="relative w-full py-3 rounded-xl border border-amber/40 text-sm font-bold
                text-amber-light select-none cursor-pointer
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors"
              style={{ touchAction: 'none' }}
              aria-label="Hold to swear the vow — 3 seconds"
            >
              {activate.isPending
                ? 'Swearing…'
                : progress > 0
                  ? 'Keep holding…'
                  : 'Hold to swear the vow — 3s'}
            </button>
          </div>

          <p className="text-[10px] text-muted text-center -mt-3">
            Press and hold for 3 seconds to commit. Release to cancel.
          </p>
        </div>
      </div>
    </div>
  )
}

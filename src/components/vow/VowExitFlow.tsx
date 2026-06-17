'use client'

/**
 * VowExitFlow.tsx — exit-flow modal for completing or breaking a vow.
 *
 * Mounts in GlobalOverlays with no props. Reads exitIntent from vowStore;
 * renders when non-null, stays hidden otherwise.
 *
 * COMPLETE path (exitIntent === 'complete') — 3 stages:
 *   1. Confirm   — shows finishCriteria; checkbox required; "Complete the vow"
 *   2. Celebrate — calm amber moment; task title; time under vow; keptCount+1
 *   3. Journal   — "How did you break the resistance?"; Save / Skip
 *
 * BREAK path (exitIntent === 'break') — single stage:
 *   — required reason textarea; "It gets logged, not judged."
 *   — [Break the vow] submits; [Back to the task] cancels
 *
 * AUTO-DETECT external completion:
 *   While vow is non-null and exitIntent is null, poll the vow's task via
 *   trpc.task.get (reuses the same 30s interval VowBar uses). If the task
 *   reports status==='done', we set exitIntent to 'complete' so stage 1 still
 *   runs as the ritual — with a note "This task was just completed elsewhere."
 *
 * EDGE CASE — vow.complete on an already-done task:
 *   The vow.complete router finds the vow by endedAt=null.  If the task was
 *   already marked done externally the vow is still "active" (endedAt is still
 *   null), so complete() will succeed — it just updates the task to done again
 *   (idempotent prisma.task.update). No error surfacing is needed.
 *
 * CLOSE semantics:
 *   All close paths call: setVow(null), setExitIntent(null), clearTrayVow(),
 *   utils.vow.active.invalidate().
 *   Esc / backdrop during stage 1 (confirm) or break = cancel only
 *   (setExitIntent(null); vow stays).
 *   Esc / backdrop during celebrate/journal = same as Skip (full cleanup).
 */

import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useVowStore } from '@/stores/vowStore'
import { clearTrayVow } from '@/lib/vowShell'

// ── Helper ────────────────────────────────────────────────────────────────────

function formatDuration(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime()
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CompleteStage = 'confirm' | 'celebrate' | 'journal'

// ── Main component ────────────────────────────────────────────────────────────

export function VowExitFlow() {
  const vow = useVowStore((s) => s.vow)
  const keptCount = useVowStore((s) => s.keptCount)
  const setVow = useVowStore((s) => s.setVow)
  const setKeptCount = useVowStore((s) => s.setKeptCount)
  const exitIntent = useVowStore((s) => s.exitIntent)
  const setExitIntent = useVowStore((s) => s.setExitIntent)

  const utils = trpc.useUtils()

  // Complete path state
  const [completeStage, setCompleteStage] = useState<CompleteStage>('confirm')
  const [criteriaChecked, setCriteriaChecked] = useState(false)
  const [completedSnapshot, setCompletedSnapshot] = useState<{
    taskTitle: string
    startedAt: Date
    newKeptCount: number
  } | null>(null)
  const [journalText, setJournalText] = useState('')
  const [completeError, setCompleteError] = useState<string | null>(null)

  // Break path state
  const [breakReason, setBreakReason] = useState('')

  // External completion detection — poll the task only when vow is active and
  // no exit is already in progress. Reuses the existing 30s polling pattern.
  const taskQuery = trpc.task.get.useQuery(
    { id: vow?.taskId ?? '' },
    {
      enabled: !!vow && !exitIntent,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  )

  // Track whether external completion was detected so stage 1 can note it.
  const [externallyCompleted, setExternallyCompleted] = useState(false)
  const prevExternalRef = useRef(false)

  useEffect(() => {
    if (!vow || exitIntent) return
    const task = taskQuery.data
    if (task?.status === 'done' && !prevExternalRef.current) {
      prevExternalRef.current = true
      setExternallyCompleted(true)
      setExitIntent('complete')
    }
  }, [taskQuery.data, vow, exitIntent, setExitIntent])

  // Reset stage/state when the flow is opened fresh.
  const prevExitIntentRef = useRef<typeof exitIntent>(null)
  useEffect(() => {
    if (exitIntent !== null && prevExitIntentRef.current === null) {
      // Fresh open
      setCompleteStage('confirm')
      setCriteriaChecked(false)
      setCompleteError(null)
      setJournalText('')
      setBreakReason('')
      setCompletedSnapshot(null)
    }
    prevExitIntentRef.current = exitIntent
  }, [exitIntent])

  // Reset external-completion sentinel when vow changes (new vow started).
  useEffect(() => {
    prevExternalRef.current = false
    setExternallyCompleted(false)
  }, [vow?.id])

  // ── Mutations ────────────────────────────────────────────────────────────

  const completeMutation = trpc.vow.complete.useMutation({
    onSuccess: (snap) => {
      const newKeptCount = snap.keptCount
      setKeptCount(newKeptCount)
      setCompletedSnapshot({
        taskTitle: snap.taskTitle,
        startedAt: snap.startedAt,
        newKeptCount,
      })
      setCompleteStage('celebrate')
    },
    onError: (err) => {
      setCompleteError(err.message)
    },
  })

  const breakMutation = trpc.vow.breakVow.useMutation({
    onSuccess: () => {
      doClose()
    },
  })

  const journalMutation = trpc.journal.add.useMutation({
    onSuccess: () => {
      doClose()
    },
  })

  // ── Close helpers ────────────────────────────────────────────────────────

  /** Full cleanup: vow ended (or journal saved/skipped). */
  function doClose() {
    setVow(null)
    setExitIntent(null)
    clearTrayVow()
    utils.vow.active.invalidate()
  }

  /** Cancel-only: just dismiss the intent; vow stays active. */
  function doCancel() {
    setExitIntent(null)
    setExternallyCompleted(false)
    prevExternalRef.current = false
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!exitIntent) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (exitIntent === 'complete') {
        if (completeStage === 'confirm') doCancel()
        else doClose() // celebrate / journal
      } else {
        // break
        doCancel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitIntent, completeStage])

  // ── Nothing to render ────────────────────────────────────────────────────

  if (!exitIntent || !vow) return null

  // ── Backdrop click handler ────────────────────────────────────────────────

  function handleBackdrop() {
    if (exitIntent === 'complete') {
      if (completeStage === 'confirm') doCancel()
      else doClose()
    } else {
      doCancel()
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Vow exit flow"
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-amber bg-surface p-6 shadow-2xl"
        style={{ boxShadow: '0 0 32px color-mix(in srgb, var(--color-amber) 30%, transparent)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {exitIntent === 'complete' && (
          <>
            {completeStage === 'confirm' && (
              <CompleteConfirm
                vow={vow}
                checked={criteriaChecked}
                onCheck={setCriteriaChecked}
                onSubmit={() => completeMutation.mutate()}
                onCancel={doCancel}
                isPending={completeMutation.isPending}
                error={completeError}
                externallyCompleted={externallyCompleted}
              />
            )}
            {completeStage === 'celebrate' && completedSnapshot && (
              <CompleteCelebrate
                snapshot={completedSnapshot}
                onContinue={() => setCompleteStage('journal')}
              />
            )}
            {completeStage === 'journal' && (
              <CompleteJournal
                text={journalText}
                onChange={setJournalText}
                onSave={() => {
                  if (journalText.trim()) {
                    journalMutation.mutate({ text: journalText.trim(), kind: 'journal' })
                  }
                }}
                onSkip={doClose}
                isPending={journalMutation.isPending}
              />
            )}
          </>
        )}

        {exitIntent === 'break' && (
          <BreakConfirm
            vow={vow}
            reason={breakReason}
            onReasonChange={setBreakReason}
            onSubmit={() => {
              if (breakReason.trim()) {
                breakMutation.mutate({ reason: breakReason.trim() })
              }
            }}
            onBack={doCancel}
            isPending={breakMutation.isPending}
          />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface VowLike {
  taskTitle: string
  finishCriteria: string
  startedAt: Date
}

function CompleteConfirm({
  vow,
  checked,
  onCheck,
  onSubmit,
  onCancel,
  isPending,
  error,
  externallyCompleted,
}: {
  vow: VowLike
  checked: boolean
  onCheck: (v: boolean) => void
  onSubmit: () => void
  onCancel: () => void
  isPending: boolean
  error: string | null
  externallyCompleted: boolean
}) {
  return (
    <>
      <div className="mb-1 flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-ink">Complete the vow.</h2>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:border-amber hover:text-ink"
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>

      <p className="mb-4 text-sm font-medium text-amber-light truncate">{vow.taskTitle}</p>

      {externallyCompleted && (
        <p className="mb-3 rounded-lg border border-amber-soft bg-amber-soft px-3 py-2 text-xs text-amber-light">
          This task was just completed elsewhere. Confirm the finish criteria to close the vow.
        </p>
      )}

      <p className="mb-2 text-xs uppercase tracking-wide text-muted">Finish criteria</p>
      <blockquote className="mb-5 rounded-lg border-l-2 border-amber bg-base px-4 py-3 text-sm leading-relaxed text-ink italic">
        &ldquo;{vow.finishCriteria}&rdquo;
      </blockquote>

      <label className="mb-5 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-amber"
          disabled={isPending}
        />
        <span className="text-sm leading-relaxed text-muted">
          This is true — the finish line is crossed.
        </span>
      </label>

      {error && (
        <p className="mb-3 text-xs text-amber-light">{error}</p>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!checked || isPending}
          className="w-full rounded-lg border border-amber bg-amber px-4 py-2.5 text-sm font-semibold text-base transition-opacity disabled:opacity-40 hover:opacity-90"
        >
          {isPending ? 'Completing…' : 'Complete the vow'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-lg px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
        >
          Back to the task
        </button>
      </div>
    </>
  )
}

function CompleteCelebrate({
  snapshot,
  onContinue,
}: {
  snapshot: { taskTitle: string; startedAt: Date; newKeptCount: number }
  onContinue: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      {/* Glow ring */}
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-amber"
        style={{
          boxShadow: '0 0 24px color-mix(in srgb, var(--color-amber) 50%, transparent)',
          animation: 'vowCelebrate 0.6s ease-out forwards',
        }}
      >
        <span className="text-2xl" role="img" aria-label="vow kept">
          ⛓
        </span>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-amber-light">Vow kept.</h2>
        <p className="mt-1 text-sm text-muted truncate max-w-xs">{snapshot.taskTitle}</p>
      </div>

      <div className="flex items-center gap-6 rounded-lg border border-line bg-base px-5 py-3 text-sm">
        <div className="text-center">
          <p className="text-xs text-muted">Time under vow</p>
          <p className="mt-0.5 font-medium text-ink">{formatDuration(snapshot.startedAt)}</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div className="text-center">
          <p className="text-xs text-muted">Vows kept</p>
          <p className="mt-0.5 font-medium text-amber-light">{snapshot.newKeptCount}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="w-full rounded-lg border border-amber bg-amber px-4 py-2.5 text-sm font-semibold text-base transition-opacity hover:opacity-90"
      >
        Continue
      </button>

      <style>{`
        @keyframes vowCelebrate {
          from { transform: scale(0.8); opacity: 0.5; }
          to   { transform: scale(1);   opacity: 1;   }
        }
      `}</style>
    </div>
  )
}

function CompleteJournal({
  text,
  onChange,
  onSave,
  onSkip,
  isPending,
}: {
  text: string
  onChange: (v: string) => void
  onSave: () => void
  onSkip: () => void
  isPending: boolean
}) {
  return (
    <>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-ink">How did you break the resistance?</h2>
        <p className="mt-1 text-xs text-muted">A single line is enough.</p>
      </div>

      <input
        type="text"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
        placeholder="What shifted for you?"
        disabled={isPending}
        className="mb-4 w-full rounded-lg border border-line bg-base px-3 py-2.5 text-sm text-ink outline-none focus:border-amber disabled:opacity-50"
      />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!text.trim() || isPending}
          className="w-full rounded-lg border border-amber bg-amber px-4 py-2.5 text-sm font-semibold text-base transition-opacity disabled:opacity-40 hover:opacity-90"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="w-full rounded-lg px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
        >
          Skip
        </button>
      </div>
    </>
  )
}

function BreakConfirm({
  vow,
  reason,
  onReasonChange,
  onSubmit,
  onBack,
  isPending,
}: {
  vow: VowLike
  reason: string
  onReasonChange: (v: string) => void
  onSubmit: () => void
  onBack: () => void
  isPending: boolean
}) {
  return (
    <>
      <div className="mb-1 flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-ink">Breaking the vow.</h2>
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:border-amber hover:text-ink"
          aria-label="Back to task"
        >
          ✕
        </button>
      </div>

      <p className="mb-4 text-sm font-medium text-amber-light truncate">{vow.taskTitle}</p>

      <label className="mb-1 block text-xs text-muted">Reason</label>
      <textarea
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        rows={3}
        autoFocus
        placeholder="What happened?"
        disabled={isPending}
        className="mb-1 w-full resize-none rounded-lg border border-line bg-base p-3 text-sm leading-relaxed text-ink outline-none focus:border-amber disabled:opacity-50"
      />
      <p className="mb-4 text-xs text-muted">It gets logged, not judged.</p>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!reason.trim() || isPending}
          className="w-full rounded-lg border border-line px-4 py-2.5 text-sm text-muted transition-colors disabled:opacity-40 hover:border-line-strong hover:text-ink"
        >
          {isPending ? 'Breaking…' : 'Break the vow'}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-lg px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
        >
          Back to the task
        </button>
      </div>
    </>
  )
}

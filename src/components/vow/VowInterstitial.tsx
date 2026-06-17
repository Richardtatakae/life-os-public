'use client'

/**
 * VowInterstitial.tsx — friction dialog shown when the user tries to navigate
 * to a tab while a vow is active (Wave 2, Task 5).
 *
 * Three actions:
 *   • Park the thought  (amber primary)  — saves text as Idea tagged vow; stays put.
 *   • Override anyway   (muted secondary) — logs reason, then navigates.
 *   • Back to the task  (ghost)           — dismisses; no action.
 *
 * One textarea serves both Park and Override — the button pressed decides meaning.
 * Park and Override are disabled when textarea is empty; Back is always enabled.
 * Esc / backdrop click = Back to the task.
 */

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useVowStore } from '@/stores/vowStore'
import { useUiStore, type TabId } from '@/stores/uiStore'

interface Props {
  pendingTab: TabId
  onClose: () => void
}

export function VowInterstitial({ pendingTab, onClose }: Props) {
  const vow = useVowStore((s) => s.vow)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  const [text, setText] = useState('')
  const [parkedFlash, setParkedFlash] = useState(false)

  // Escape key → back to task
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // tRPC mutations
  const createIdea = trpc.idea.create.useMutation({
    onSuccess: () => {
      setParkedFlash(true)
      setTimeout(() => {
        setParkedFlash(false)
        onClose()
      }, 1000)
    },
  })

  const logOverride = trpc.vow.logOverride.useMutation({
    onSuccess: () => {
      setActiveTab(pendingTab)
      onClose()
    },
  })

  const isEmpty = text.trim().length === 0
  const isWorking = createIdea.isPending || logOverride.isPending

  function handlePark() {
    if (isEmpty || isWorking) return
    createIdea.mutate({ text: text.trim(), source: 'vow' })
  }

  function handleOverride() {
    if (isEmpty || isWorking) return
    logOverride.mutate({ toTab: pendingTab, reason: text.trim() })
  }

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Vow interstitial"
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-1 flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold text-ink">You&rsquo;re under vow.</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:border-amber hover:text-ink"
            aria-label="Back to task"
          >
            ✕
          </button>
        </div>

        {/* Vow task title */}
        {vow?.taskTitle && (
          <p className="mb-4 text-sm text-amber-light font-medium truncate">
            {vow.taskTitle}
          </p>
        )}

        {/* Body copy */}
        <p className="mb-4 text-sm leading-relaxed text-muted">
          This isn&rsquo;t your task. What pulled you away?
        </p>

        {/* Single textarea */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoFocus
          placeholder="What's on your mind?"
          disabled={isWorking || parkedFlash}
          className="mb-1 w-full resize-none rounded-lg border border-line bg-base p-3 text-sm leading-relaxed text-ink outline-none focus:border-amber disabled:opacity-50"
        />

        {/* Parked confirmation flash */}
        {parkedFlash && (
          <p className="mb-3 text-xs font-medium text-amber-light">
            Parked ✓ — it&rsquo;ll be in Ideas
          </p>
        )}
        {!parkedFlash && <div className="mb-3" />}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {/* Park the thought — primary amber */}
          <button
            type="button"
            onClick={handlePark}
            disabled={isEmpty || isWorking}
            className="w-full rounded-lg border border-amber bg-amber px-4 py-2.5 text-sm font-semibold text-base transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            {createIdea.isPending ? 'Saving…' : 'Park the thought'}
          </button>

          {/* Override anyway — muted secondary */}
          <div className="relative">
            <button
              type="button"
              onClick={handleOverride}
              disabled={isEmpty || isWorking}
              className="w-full rounded-lg border border-line px-4 py-2.5 text-sm text-muted transition-colors disabled:opacity-40 hover:border-line-strong hover:text-ink"
            >
              {logOverride.isPending ? 'Logging…' : 'Override anyway'}
            </button>
            <p className="mt-1 text-center text-xs text-faint">
              It gets logged, not judged.
            </p>
          </div>

          {/* Back to the task — ghost */}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
          >
            Back to the task
          </button>
        </div>
      </div>
    </div>
  )
}

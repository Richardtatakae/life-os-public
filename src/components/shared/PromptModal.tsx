'use client'

/**
 * PromptModal.tsx — global modal for the copy-prompt feature.
 *
 * Listens to useUiStore.promptModal for open/kind/entityId state.
 * When open, calls the matching tRPC query, displays the generated text
 * in a read-only textarea with auto-select-all, and provides a
 * "Copy to clipboard" button.
 *
 * Mount this once in the dashboard layout. All "Copy prompt" buttons
 * in TaskRow/HabitRow/CoachingCard trigger it via openPromptModal().
 *
 * Blueprint §10.13 / Plan 13.
 */

import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useUiStore } from '@/stores/uiStore'

// ─────────────────── Inner query components ───────────────────

function TaskPromptContent({ entityId, onText }: { entityId: string; onText: (t: string) => void }) {
  const { data, isLoading } = trpc.prompt.forTask.useQuery({ taskId: entityId })
  useEffect(() => { if (data?.text) onText(data.text) }, [data, onText])
  if (isLoading) return <LoadingState />
  if (!data) return null
  return null
}

function HabitPromptContent({ entityId, onText }: { entityId: string; onText: (t: string) => void }) {
  const { data, isLoading } = trpc.prompt.forHabit.useQuery({ habitId: entityId })
  useEffect(() => { if (data?.text) onText(data.text) }, [data, onText])
  if (isLoading) return <LoadingState />
  if (!data) return null
  return null
}

function CustomPromptContent({
  title,
  context,
  onText,
}: {
  title: string
  context?: string
  onText: (t: string) => void
}) {
  const { data, isLoading } = trpc.prompt.forCustom.useQuery({ title, context })
  useEffect(() => { if (data?.text) onText(data.text) }, [data, onText])
  if (isLoading) return <LoadingState />
  if (!data) return null
  return null
}

function LoadingState() {
  return (
    <p className="text-sm text-muted text-center py-4 animate-pulse">
      Generating prompt…
    </p>
  )
}

// ─────────────────── Main modal ───────────────────

export function PromptModal() {
  const modal = useUiStore((s) => s.promptModal)
  const close = useUiStore((s) => s.closePromptModal)

  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (modal.open) {
      setText('')
      setCopied(false)
    }
  }, [modal.open])

  // Auto-select-all when text is populated
  useEffect(() => {
    if (text && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [text])

  async function handleCopy() {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard API not available (e.g., in tests) — silently ignore
    }
  }

  if (!modal.open) return null

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={close}
      aria-modal="true"
      role="dialog"
      aria-label="Copy prompt modal"
    >
      {/* Panel */}
      <div
        className="panel relative w-full max-w-2xl mx-4 bg-base border border-line rounded-2xl shadow-2xl p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">Copy prompt</h2>
          <button
            onClick={close}
            className="text-muted hover:text-ink transition-colors text-lg leading-none"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Hidden query components — they populate `text` via onText callback */}
        {modal.kind === 'task' && (
          <TaskPromptContent entityId={modal.entityId} onText={setText} />
        )}
        {modal.kind === 'habit' && (
          <HabitPromptContent entityId={modal.entityId} onText={setText} />
        )}
        {modal.kind === 'custom' && (
          <CustomPromptContent title={modal.title} context={modal.context} onText={setText} />
        )}

        {/* Textarea */}
        {text ? (
          <textarea
            ref={textareaRef}
            readOnly
            value={text}
            rows={14}
            className="w-full bg-surface border border-line rounded-lg p-3 text-xs
              text-ink font-mono leading-relaxed resize-none focus:outline-none
              focus:ring-1 focus:ring-purple"
            aria-label="Generated prompt text"
          />
        ) : (
          <div className="flex items-center justify-center h-40">
            <LoadingState />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={close}
            className="text-sm px-4 py-2 rounded-lg bg-slate text-muted
              hover:bg-line transition-colors font-medium"
          >
            Close
          </button>
          <button
            onClick={handleCopy}
            disabled={!text}
            className={`text-sm px-4 py-2 rounded-lg font-semibold transition-colors
              ${copied
                ? 'bg-emerald text-white'
                : text
                  ? 'bg-purple text-white hover:bg-purple-deep'
                  : 'bg-line text-faint cursor-not-allowed'
              }`}
            aria-label="Copy generated prompt to clipboard"
          >
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </div>
      </div>
    </div>
  )
}

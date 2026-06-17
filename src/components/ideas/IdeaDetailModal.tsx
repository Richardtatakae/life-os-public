'use client'

/**
 * IdeaDetailModal — overlay modal for viewing and editing a single Idea.
 *
 * Shows: optional heading (editable), body text (editable), folder reassignment.
 * Saves via idea.update (Event-logged on the server).
 * Opens on idea row click; closes on backdrop click or Escape.
 */

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import type { FolderNode } from '@/server/routers/folder'

interface IdeaDetailModalProps {
  ideaId: string
  onClose: () => void
}

// Flatten a nested folder tree to a flat list for the <select>.
function flattenTree(nodes: FolderNode[], depth = 0): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = []
  for (const node of nodes) {
    result.push({ id: node.id, label: '  '.repeat(depth) + node.name })
    result.push(...flattenTree(node.children, depth + 1))
  }
  return result
}

const inputCls =
  'bg-base border border-ink/10 rounded-lg px-3 py-2 text-sm text-ink ' +
  'placeholder:text-muted focus:outline-none focus:border-emerald w-full'

export function IdeaDetailModal({ ideaId, onClose }: IdeaDetailModalProps) {
  const utils = trpc.useUtils()

  // Load this single idea from the flat list (no `idea.get` endpoint exists).
  const ideasQuery = trpc.idea.list.useQuery()
  const idea = (ideasQuery.data ?? []).find((i) => i.id === ideaId)

  // Folder tree for the reassign dropdown.
  const folderTree = trpc.folder.tree.useQuery().data ?? []
  const flatFolders = flattenTree(folderTree)

  // Local form state — initialised from the idea when it loads.
  const [heading, setHeading] = useState<string>('')
  const [text, setText] = useState<string>('')
  const [folderId, setFolderId] = useState<string>('__unfiled__')
  const [initialised, setInitialised] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (idea && !initialised) {
      setHeading(idea.heading ?? '')
      setText(idea.text)
      setFolderId(idea.folderId ?? '__unfiled__')
      setInitialised(true)
    }
  }, [idea, initialised])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updateMutation = trpc.idea.update.useMutation({
    onSuccess: () => {
      void utils.idea.list.invalidate()
      void utils.idea.listByFolder.invalidate()
      onClose()
    },
    onError: (e) => setError(e.message),
  })

  function save() {
    if (!text.trim()) { setError('Body text cannot be empty.'); return }
    updateMutation.mutate({
      id: ideaId,
      heading: heading.trim() || null,
      text: text.trim(),
      folderId: folderId === '__unfiled__' ? null : folderId,
    })
  }

  const isLoading = ideasQuery.isLoading || !idea || !initialised

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Modal panel — stop propagation so clicking inside doesn't close */}
      <div
        className="relative bg-surface border border-line rounded-2xl shadow-2xl
          w-full max-w-lg mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold text-ink">Idea</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink transition-colors text-base leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted py-6 text-center animate-pulse">Loading…</p>
          ) : (
            <>
              {/* Heading — optional */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Heading <span className="normal-case font-normal">(optional)</span>
                </label>
                <input
                  className={inputCls}
                  value={heading}
                  onChange={(e) => setHeading(e.target.value)}
                  placeholder="Give this idea a title…"
                />
              </div>

              {/* Body — required */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Body
                </label>
                <textarea
                  className={inputCls + ' resize-none'}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="The idea itself…"
                />
              </div>

              {/* Folder */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Folder
                </label>
                <select
                  className={inputCls}
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                >
                  <option value="__unfiled__">📋 Unfiled</option>
                  {flatFolders.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isLoading && (
          <div className="px-5 py-3 border-t border-line flex items-center justify-end gap-3">
            {error && <span className="text-xs text-red mr-auto">{error}</span>}
            <button
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-lg bg-slate text-muted hover:bg-line transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={updateMutation.isPending}
              className="text-sm px-4 py-2 rounded-lg bg-emerald text-white font-semibold
                hover:opacity-90 transition disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

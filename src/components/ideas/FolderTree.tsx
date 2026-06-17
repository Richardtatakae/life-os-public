'use client'

/**
 * FolderTree — recursive sidebar for the Ideas module.
 *
 * Shows an always-present "Unfiled" entry plus the nested folder hierarchy.
 * Supports: select, create (inline input), rename (inline input), archive (delete).
 *
 * Drag-to-folder: each row exposes a useDroppable so an outer DndContext (owned
 * by IdeasList) can route idea drops here. Pass `dragOverFolderId` from that
 * context to highlight the active target with a sky-blue tint.
 */

import { useState, useRef, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { trpc } from '@/lib/trpc/client'
import type { FolderNode } from '@/server/routers/folder'

/** Sentinel id used for the "Unfiled" droppable (maps to folderId = null). */
export const UNFILED_DROP_ID = '__unfiled__'

interface FolderTreeProps {
  selectedFolderId: string | null   // null = Unfiled
  onSelect: (folderId: string | null) => void
  /** Id of the folder row currently being dragged over (from outer DndContext). */
  dragOverFolderId?: string | null
}

// ── Tiny input that auto-focuses and commits on Enter/Escape ────────────────
function InlineInput({
  initialValue,
  placeholder,
  onCommit,
  onCancel,
}: {
  initialValue: string
  placeholder: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function commit() {
    const v = value.trim()
    if (v) onCommit(v)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={commit}
      placeholder={placeholder}
      className="flex-1 min-w-0 bg-base border border-emerald/40 rounded px-1.5 py-0.5
        text-xs text-ink placeholder:text-muted focus:outline-none focus:border-emerald"
    />
  )
}

// ── A single folder node (recursive) ────────────────────────────────────────
function FolderItem({
  node,
  depth,
  selectedFolderId,
  dragOverFolderId,
  onSelect,
  onAddChild,
}: {
  node: FolderNode
  depth: number
  selectedFolderId: string | null
  dragOverFolderId: string | null | undefined
  onSelect: (folderId: string | null) => void
  onAddChild: (parentId: string) => void
}) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const utils = trpc.useUtils()

  // Make this row a drop target for idea cards dragged from the outer DndContext.
  const { setNodeRef: setDropRef } = useDroppable({ id: node.id })

  const renameMutation = trpc.folder.rename.useMutation({
    onSuccess: () => { void utils.folder.tree.invalidate(); setIsRenaming(false) },
  })
  const archiveMutation = trpc.folder.archive.useMutation({
    onSuccess: () => {
      void utils.folder.tree.invalidate()
      void utils.idea.list.invalidate()
      void utils.idea.listByFolder.invalidate()
    },
  })

  const isSelected = selectedFolderId === node.id
  const isDragOver = dragOverFolderId === node.id
  const hasChildren = node.children.length > 0
  const indent = depth * 12

  return (
    <div>
      <div
        ref={setDropRef}
        className={`group flex items-center gap-1 rounded-lg px-2 py-1 cursor-pointer transition-colors text-sm
          ${isDragOver
            ? 'bg-sky-500/20 ring-1 ring-sky-400/60 text-sky-300'
            : isSelected
              ? 'bg-emerald/15 text-emerald'
              : 'text-muted hover:bg-surface hover:text-ink'}`}
        style={{ paddingLeft: `${indent + 8}px` }}
        onClick={() => { if (!isRenaming) onSelect(node.id) }}
      >
        {/* Expand/collapse toggle for folders that have children */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          className="shrink-0 w-4 text-center opacity-50 hover:opacity-100 text-[10px]"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {hasChildren ? (expanded ? '▾' : '▸') : ' '}
        </button>

        {/* Folder icon */}
        <span className="shrink-0 text-[13px]">📁</span>

        {/* Name or inline rename input */}
        {isRenaming ? (
          <InlineInput
            initialValue={node.name}
            placeholder="Folder name…"
            onCommit={(name) => renameMutation.mutate({ id: node.id, name })}
            onCancel={() => setIsRenaming(false)}
          />
        ) : (
          <span className="flex-1 truncate select-none">{node.name}</span>
        )}

        {/* Action buttons (only show on hover, when not renaming) */}
        {!isRenaming && (
          <div className="hidden group-hover:flex items-center gap-1 shrink-0">
            <button
              type="button"
              title="Add sub-folder"
              onClick={(e) => { e.stopPropagation(); onAddChild(node.id) }}
              className="text-[10px] opacity-60 hover:opacity-100 hover:text-emerald px-1"
              aria-label="Add sub-folder"
            >
              +
            </button>
            <button
              type="button"
              title="Rename"
              onClick={(e) => { e.stopPropagation(); setIsRenaming(true) }}
              className="text-[10px] opacity-60 hover:opacity-100 hover:text-amber px-1"
              aria-label="Rename folder"
            >
              ✎
            </button>
            <button
              type="button"
              title="Delete folder (ideas go to Unfiled)"
              onClick={(e) => {
                e.stopPropagation()
                archiveMutation.mutate({ id: node.id })
                if (isSelected) onSelect(null)
              }}
              className="text-[10px] opacity-60 hover:opacity-100 hover:text-red px-1"
              aria-label="Delete folder"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Recursive children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              dragOverFolderId={dragOverFolderId}
              onSelect={onSelect}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main FolderTree ──────────────────────────────────────────────────────────
export function FolderTree({ selectedFolderId, onSelect, dragOverFolderId }: FolderTreeProps) {
  const utils = trpc.useUtils()
  const treeQuery = trpc.folder.tree.useQuery()
  const tree = treeQuery.data ?? []

  // Tracks which parent is awaiting a new child (null = root level).
  const [creatingUnder, setCreatingUnder] = useState<string | 'root' | null>(null)

  // Make the "Unfiled" row a droppable with the sentinel id.
  const { setNodeRef: setUnfiledDropRef } = useDroppable({ id: UNFILED_DROP_ID })

  const createMutation = trpc.folder.create.useMutation({
    onSuccess: (folder) => {
      void utils.folder.tree.invalidate()
      setCreatingUnder(null)
      onSelect(folder.id)
    },
  })

  function renderNewFolderInput(parentId: string | null) {
    return (
      <div
        className="flex items-center gap-1 rounded-lg px-2 py-1"
        style={{ paddingLeft: `${(parentId ? 12 : 0) + 8}px` }}
      >
        <span className="shrink-0 w-4" />
        <span className="shrink-0 text-[13px]">📁</span>
        <InlineInput
          initialValue=""
          placeholder="New folder…"
          onCommit={(name) => createMutation.mutate({ name, parentId: parentId ?? undefined })}
          onCancel={() => setCreatingUnder(null)}
        />
      </div>
    )
  }

  const isUnfiledDragOver = dragOverFolderId === UNFILED_DROP_ID

  return (
    <div className="flex flex-col gap-0.5 py-1">
      {/* ── Unfiled — always at top ── */}
      <div
        ref={setUnfiledDropRef}
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 cursor-pointer transition-colors text-sm
          ${isUnfiledDragOver
            ? 'bg-sky-500/20 ring-1 ring-sky-400/60 text-sky-300'
            : selectedFolderId === null
              ? 'bg-amber/15 text-amber-light'
              : 'text-muted hover:bg-surface hover:text-ink'}`}
        onClick={() => onSelect(null)}
      >
        <span className="text-[13px]">📋</span>
        <span className="flex-1 truncate select-none">Unfiled</span>
      </div>

      {/* Divider */}
      <div className="border-t border-line my-1" />

      {/* ── Folder tree ── */}
      {treeQuery.isLoading ? (
        <p className="text-xs text-muted px-3 py-2 animate-pulse">Loading…</p>
      ) : (
        <>
          {tree.map((node) => (
            <div key={node.id}>
              <FolderItem
                node={node}
                depth={0}
                selectedFolderId={selectedFolderId}
                dragOverFolderId={dragOverFolderId}
                onSelect={onSelect}
                onAddChild={(parentId) => setCreatingUnder(parentId)}
              />
              {/* Inline "new sub-folder" input under this root node */}
              {creatingUnder === node.id && renderNewFolderInput(node.id)}
            </div>
          ))}

          {/* Inline "new root folder" input */}
          {creatingUnder === 'root' && renderNewFolderInput(null)}
        </>
      )}

      {/* ── Add folder at root ── */}
      <button
        type="button"
        onClick={() => setCreatingUnder('root')}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted
          hover:bg-surface hover:text-ink transition-colors mt-1"
      >
        <span>+ New folder</span>
      </button>
    </div>
  )
}

'use client'

/**
 * IdeasList — the Ideas tab, rebuilt Obsidian-style.
 *
 * Layout: a nested folder sidebar on the left + a folder→ideas main view on the
 * right. Selecting a folder (or the always-present "Unfiled" entry) shows the
 * ideas filed there. Creating an idea allows an OPTIONAL heading and files it
 * into the selected folder. Clicking an idea opens a detail popup where you can
 * edit the heading + body and reassign its folder.
 *
 * All data goes through the `idea` + `folder` tRPC routers (Prisma + Event log).
 *
 * Vow Mode: ideas parked via the friction dialog carry `source === 'vow'`. They
 * appear in an amber-accented "Captured under vow" box rendered ABOVE the main
 * list (they file as Unfiled, so the box shows in the Unfiled view). The box is
 * hidden when there are no vow ideas. Vow ideas are a plain (non-sortable) list;
 * regular ideas keep full drag-to-reorder behaviour.
 *
 * Drag-to-folder: a single DndContext wraps BOTH the FolderTree sidebar and the
 * regular-ideas list. Dragging an idea card onto a folder row calls idea.update
 * to move it; dragging onto another idea row reorders within the list.
 * The FolderTree's own SortableList is NOT used for this — we use a local
 * SortableContext here so the droppables in FolderTree share this outer context.
 */

import React, { useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { trpc } from '@/lib/trpc/client'
import { FolderTree, UNFILED_DROP_ID } from '@/components/ideas/FolderTree'
import { IdeaDetailModal } from '@/components/ideas/IdeaDetailModal'

// ── Local SortableItem for the ideas list ────────────────────────────────────
// We manage our own SortableContext inside IdeasList's outer DndContext so
// folder droppables (in FolderTree) can share the same context. SortableList
// (shared) owns its own DndContext and cannot cross the sidebar boundary.
function IdeaSortableItem({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={'cursor-grab active:cursor-grabbing ' + (className ?? '')}
    >
      {children}
    </div>
  )
}

// ── IdeasList ─────────────────────────────────────────────────────────────────
export function IdeasList() {
  // null = Unfiled. The selected folder drives the main view + new-idea filing.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [heading, setHeading] = useState('')
  const [text, setText] = useState('')
  const [openIdeaId, setOpenIdeaId] = useState<string | null>(null)
  // Tracks which droppable (folder id or UNFILED_DROP_ID) the pointer is over.
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const ideasQuery = trpc.idea.listByFolder.useQuery({ folderId: selectedFolderId })
  const ideas = ideasQuery.data ?? []

  const invalidate = () => {
    void utils.idea.listByFolder.invalidate()
    void utils.idea.list.invalidate()
  }

  const createMutation = trpc.idea.create.useMutation({
    onSuccess: () => { setText(''); setHeading(''); invalidate() },
  })
  const removeMutation = trpc.idea.remove.useMutation({ onSettled: invalidate })
  const reorderMutation = trpc.idea.reorder.useMutation({ onSettled: invalidate })
  const moveMutation = trpc.idea.update.useMutation({ onSettled: invalidate })

  // Split into vow-captured vs regular ideas. Both groups preserve the
  // server orderBy: [position asc, createdAt asc].
  // Declared before handlers so they can reference regularIdeas.
  const vowIdeas = ideas.filter((i) => i.source === 'vow')
  const regularIdeas = ideas.filter((i) => i.source !== 'vow')

  // dnd-kit sensors: 4px activation so a tap/click never accidentally starts a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  /** Returns true if the given droppable id belongs to a folder sidebar row. */
  function isFolderDrop(id: string | number): boolean {
    const s = String(id)
    return s === UNFILED_DROP_ID || (!regularIdeas.find((i) => i.id === s))
  }

  /** Called while dragging — track which folder row the pointer is over. */
  function handleDragOver(e: DragOverEvent) {
    const overId = e.over ? String(e.over.id) : null
    if (overId && isFolderDrop(overId)) {
      setDragOverFolderId(overId)
    } else {
      setDragOverFolderId(null)
    }
  }

  /** Called when drag ends — route to folder-move or within-list reorder. */
  function handleDragEnd(e: DragEndEvent) {
    setDragOverFolderId(null)
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    if (isFolderDrop(overId)) {
      // ── Drop on a folder row ──────────────────────────────────────────────
      const targetFolderId = overId === UNFILED_DROP_ID ? null : overId
      // No-op if the idea is already in this folder.
      const idea = regularIdeas.find((i) => i.id === activeId)
      if (!idea) return
      const currentFolderId = idea.folderId ?? null
      if (currentFolderId === targetFolderId) return
      moveMutation.mutate({ id: activeId, folderId: targetFolderId })
    } else {
      // ── Drop on another idea row — reorder within list ────────────────────
      if (activeId === overId) return
      const ids = regularIdeas.map((i) => i.id)
      const oldIndex = ids.indexOf(activeId)
      const newIndex = ids.indexOf(overId)
      if (oldIndex === -1 || newIndex === -1) return
      reorderMutation.mutate({ orderedIds: arrayMove(ids, oldIndex, newIndex) })
    }
  }

  function add() {
    const t = text.trim()
    if (!t) return
    createMutation.mutate({
      text: t,
      heading: heading.trim() || undefined,
      folderId: selectedFolderId,
    })
  }

  /** Shared row content used in both the vow box and the main list. */
  function IdeaRow({ id, heading: h, text: ideaText }: { id: string; heading: string | null; text: string }) {
    return (
      <>
        <span className="text-muted shrink-0 select-none">•</span>
        <div className="flex-1 min-w-0" onClick={() => setOpenIdeaId(id)}>
          {h && <span className="block text-sm font-semibold text-ink break-words">{h}</span>}
          <span className={`block text-sm whitespace-pre-wrap break-words ${h ? 'text-muted' : 'text-ink'}`}>
            {ideaText}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); removeMutation.mutate({ id }) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-red transition-all shrink-0"
          aria-label="Remove idea"
          title="Remove"
        >
          ✕
        </button>
      </>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1
        className="box-drag-handle cursor-grab active:cursor-grabbing select-none inline-block text-lg font-semibold text-ink uppercase tracking-wide mb-3"
        title="Drag to move · drag any edge to resize"
      >
        Ideas
      </h1>

      {/*
        ONE DndContext wrapping BOTH the sidebar and the list.
        Folder rows (useDroppable in FolderTree) and idea rows (useSortable in
        IdeaSortableItem) all register into this single context, so a drag that
        starts on an idea can end on a folder row.
      */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4">
          {/* ── Sidebar: nested folder tree (contains useDroppable rows) ── */}
          <aside className="w-56 shrink-0 rounded-xl border border-line bg-base/40 overflow-y-auto">
            <FolderTree
              selectedFolderId={selectedFolderId}
              onSelect={setSelectedFolderId}
              dragOverFolderId={dragOverFolderId}
            />
          </aside>

          {/* ── Main view: ideas in the selected folder ── */}
          <div className="flex-1 min-w-0">
            {/* Add box — optional heading + required body. */}
            <div className="flex flex-col gap-2 mb-4">
              <input
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') add() }}
                placeholder="Heading (optional)…"
                className="bg-base border border-ink/10 rounded-lg px-3 py-2
                  text-sm text-ink placeholder:text-muted
                  focus:outline-none focus:border-emerald"
              />
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') add() }}
                  placeholder="Jot down an idea…"
                  className="flex-1 bg-base border border-ink/10 rounded-lg px-3 py-2
                    text-sm text-ink placeholder:text-muted
                    focus:outline-none focus:border-emerald"
                />
                <button
                  type="button"
                  onClick={add}
                  disabled={createMutation.isPending || !text.trim()}
                  className="text-sm px-4 py-2 rounded-lg bg-emerald text-white font-semibold
                    hover:opacity-90 transition disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>

            {/* ── Captured under vow ── hidden when no vow ideas exist. */}
            {vowIdeas.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber/40 bg-amber/5 px-4 py-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-amber">
                  ⛓ Captured under vow
                </p>
                <div className="flex flex-col gap-1">
                  {vowIdeas.map((idea) => (
                    <div
                      key={idea.id}
                      className="flex items-start gap-2 px-3 py-2 rounded-lg group hover:bg-amber/10 transition-colors cursor-pointer"
                    >
                      <IdeaRow id={idea.id} heading={idea.heading} text={idea.text} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Main list ── sortable, drag-to-reorder or drag-to-folder. */}
            {regularIdeas.length === 0 && vowIdeas.length === 0 ? (
              <p className="text-muted text-sm py-6 text-center">
                No ideas here yet — jot down your first one above.
              </p>
            ) : regularIdeas.length === 0 ? null : (
              <SortableContext
                items={regularIdeas.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-1">
                  {regularIdeas.map((idea) => (
                    <IdeaSortableItem
                      key={idea.id}
                      id={idea.id}
                      className="flex items-start gap-2 px-3 py-2 rounded-lg group hover:bg-surface transition-colors"
                    >
                      <IdeaRow id={idea.id} heading={idea.heading} text={idea.text} />
                    </IdeaSortableItem>
                  ))}
                </div>
              </SortableContext>
            )}
          </div>
        </div>
      </DndContext>

      {/* ── Detail popup ── */}
      {openIdeaId && (
        <IdeaDetailModal ideaId={openIdeaId} onClose={() => setOpenIdeaId(null)} />
      )}
    </div>
  )
}

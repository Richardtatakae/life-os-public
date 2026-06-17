'use client'

/**
 * DistilledView — the Distilled tab.
 *
 * Lists every document produced by the `/distill` skill (self-contained HTML
 * files in ~/Distilled/) in a left sidebar and shows the selected one in a
 * sandboxed <iframe> on the right.
 *
 * The sidebar is organisable:
 *  • Drag a document to reorder it, or drag it into a group.
 *  • Create named groups ("+ New group"); rename by clicking the name; collapse
 *    with the chevron; drag a group's header to reorder groups.
 *  • Deleting a document moves the file(s) to the Trash (recoverable). Deleting a
 *    GROUP only ungroups its documents — it never touches the files.
 *
 * The list of documents comes from the filesystem (trpc.distilled.list). The
 * *organisation* (groups, membership, order) is the app's own data, so it
 * persists to SQLite via the settings router under the key below — surviving
 * reloads, unlike localStorage. New files always appear at the top of the
 * ungrouped section; removed files drop out automatically.
 */

import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// SQLite settings key holding the sidebar organisation JSON (see DistilledOrg).
const ORG_KEY = 'distilledOrg'
const UNGROUPED = 'ungrouped'

interface DocMeta {
  slug: string
  title: string
  sizeBytes: number
  modifiedAt: string | Date
  hasPdf: boolean
}

interface Group {
  id: string
  name: string
  collapsed: boolean
}

/** Persisted shape: the groups, each doc's group, and order per container. */
interface DistilledOrg {
  groups: Group[]
  assign: Record<string, string> // slug -> groupId
  order: Record<string, string[]> // containerId ('ungrouped' | groupId) -> slugs
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Build the live container layout from the file list + saved organisation.
 *  New files land at the top of "ungrouped"; deleted files fall out. */
function buildState(docs: DocMeta[], org: DistilledOrg) {
  const groups: Group[] = (org.groups ?? []).map((g) => ({
    id: g.id,
    name: g.name ?? 'Group',
    collapsed: !!g.collapsed,
  }))
  const liveSet = new Set(docs.map((d) => d.slug))
  const items: Record<string, string[]> = { [UNGROUPED]: [] }
  for (const g of groups) items[g.id] = []
  const placed = new Set<string>()

  // 1) honour saved order, per container
  for (const cid of [UNGROUPED, ...groups.map((g) => g.id)]) {
    for (const slug of org.order?.[cid] ?? []) {
      if (liveSet.has(slug) && !placed.has(slug)) {
        items[cid].push(slug)
        placed.add(slug)
      }
    }
  }
  // 2) assigned-but-not-yet-ordered docs
  for (const [slug, gid] of Object.entries(org.assign ?? {})) {
    if (liveSet.has(slug) && !placed.has(slug) && items[gid]) {
      items[gid].push(slug)
      placed.add(slug)
    }
  }
  // 3) brand-new docs → top of ungrouped (docs arrive newest-first)
  const fresh: string[] = []
  for (const d of docs) {
    if (!placed.has(d.slug)) {
      fresh.push(d.slug)
      placed.add(d.slug)
    }
  }
  items[UNGROUPED] = [...fresh, ...items[UNGROUPED]]
  return { items, groups }
}

/** Serialise the live layout back to the persisted shape. */
function toOrg(items: Record<string, string[]>, groups: Group[]): DistilledOrg {
  const order: Record<string, string[]> = {}
  const assign: Record<string, string> = {}
  for (const cid of Object.keys(items)) {
    order[cid] = items[cid]
    if (cid !== UNGROUPED) for (const s of items[cid]) assign[s] = cid
  }
  return { groups, assign, order }
}

// ── component ─────────────────────────────────────────────────────────────────

export function DistilledView() {
  const utils = trpc.useUtils()
  const listQuery = trpc.distilled.list.useQuery()
  const docs = (listQuery.data ?? []) as DocMeta[]
  const bySlug: Record<string, DocMeta> = {}
  for (const d of docs) bySlug[d.slug] = d

  // Organisation (persisted to SQLite). Hydrate once, then mirror locally.
  const orgQuery = trpc.settings.get.useQuery({ key: ORG_KEY }, { staleTime: Infinity, retry: false })
  const setSetting = trpc.settings.set.useMutation()
  const [hydrated, setHydrated] = useState(false)
  const [org, setOrg] = useState<DistilledOrg>({ groups: [], assign: {}, order: {} })

  useEffect(() => {
    if (hydrated || orgQuery.isLoading) return
    if (orgQuery.data) {
      try {
        const p = JSON.parse(orgQuery.data) as Partial<DistilledOrg>
        setOrg({
          groups: Array.isArray(p.groups) ? (p.groups as Group[]) : [],
          assign: (p.assign as Record<string, string>) ?? {},
          order: (p.order as Record<string, string[]>) ?? {},
        })
      } catch {
        /* ignore malformed org */
      }
    }
    setHydrated(true)
  }, [hydrated, orgQuery.isLoading, orgQuery.data])

  // Live layout: containers of slugs + the ordered groups.
  const [items, setItems] = useState<Record<string, string[]>>({ [UNGROUPED]: [] })
  const [groups, setGroups] = useState<Group[]>([])
  const draggingRef = useRef(false)
  const [dragType, setDragType] = useState<'doc' | 'group' | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  // Rebuild the layout whenever the files or the saved org change (but never
  // mid-drag, so a background refetch can't yank a row out from under you).
  useEffect(() => {
    if (!hydrated || draggingRef.current) return
    const built = buildState(docs, org)
    setItems(built.items)
    setGroups(built.groups)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, org, listQuery.dataUpdatedAt])

  // Persist + mirror a new layout.
  function commit(nextItems: Record<string, string[]>, nextGroups: Group[]) {
    const nextOrg = toOrg(nextItems, nextGroups)
    setItems(nextItems)
    setGroups(nextGroups)
    setOrg(nextOrg)
    const json = JSON.stringify(nextOrg)
    setSetting.mutate({ key: ORG_KEY, value: json })
    utils.settings.get.setData({ key: ORG_KEY }, json)
  }

  // ── viewer state ──
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (docs.length === 0) {
      if (selected !== null) setSelected(null)
      return
    }
    if (selected === null || !docs.some((d) => d.slug === selected)) {
      setSelected(docs[0].slug)
    }
  }, [docs, selected])

  const docQuery = trpc.distilled.read.useQuery(
    { slug: selected ?? '' },
    { enabled: selected !== null },
  )

  const removeMutation = trpc.distilled.remove.useMutation({
    onSuccess: () => {
      void utils.distilled.list.invalidate()
    },
  })

  // ── group operations ──
  function addGroup() {
    const id = crypto.randomUUID()
    commit({ ...items, [id]: [] }, [...groups, { id, name: 'New group', collapsed: false }])
    setJustAdded(id)
  }
  function renameGroup(id: string, name: string) {
    commit(
      items,
      groups.map((g) => (g.id === id ? { ...g, name: name.trim() || 'Group' } : g)),
    )
  }
  function toggleGroup(id: string) {
    commit(
      items,
      groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)),
    )
  }
  function deleteGroup(id: string) {
    // Ungroup its docs (move to the end of ungrouped) — never delete files.
    const moved = items[id] ?? []
    const next: Record<string, string[]> = { ...items, [UNGROUPED]: [...items[UNGROUPED], ...moved] }
    delete next[id]
    commit(
      next,
      groups.filter((g) => g.id !== id),
    )
  }

  // ── drag & drop ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function findContainer(id: string): string | null {
    if (!id) return null
    if (id.startsWith('body:')) return id.slice(5)
    if (items[id]) return id // 'ungrouped' or a group id (e.g. a doc dropped on its header)
    for (const c of Object.keys(items)) if (items[c].includes(id)) return c
    return null
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    draggingRef.current = true
    setDragType(groups.some((g) => g.id === id) ? 'group' : 'doc')
  }

  function onDragEnd(e: DragEndEvent) {
    const type = dragType
    draggingRef.current = false
    setDragType(null)
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    if (type === 'group') {
      const oldI = groups.findIndex((g) => g.id === activeId)
      const newI = groups.findIndex((g) => g.id === overId)
      if (oldI < 0 || newI < 0 || oldI === newI) return
      commit(items, arrayMove(groups, oldI, newI))
      return
    }

    // document: move within / across containers
    const srcC = findContainer(activeId)
    let dstC = findContainer(overId)
    if (!srcC) return
    if (!dstC) dstC = srcC
    const working = { ...items, [srcC]: items[srcC].filter((s) => s !== activeId) }
    const dstArr = dstC === srcC ? working[srcC] : [...items[dstC]]
    const overIdx = dstArr.indexOf(overId)
    const idx = overIdx >= 0 ? overIdx : dstArr.length
    dstArr.splice(idx, 0, activeId)
    working[dstC] = dstArr
    commit(working, groups)
  }

  // ── render ──
  const totalDocs = docs.length

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1
          className="box-drag-handle inline-block cursor-grab select-none text-lg font-semibold uppercase tracking-wide text-ink active:cursor-grabbing"
          title="Drag to move · drag any edge to resize"
        >
          Distilled
        </h1>
        <button
          type="button"
          onClick={() => void listQuery.refetch()}
          className="rounded-md border border-ink/10 bg-base px-2.5 py-1 text-xs text-muted transition hover:text-ink"
          title="Re-scan ~/Distilled for new documents"
        >
          ↻ Refresh
        </button>
      </div>

      {totalDocs === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-sm text-center text-sm text-muted">
            No distilled documents yet. Run the <span className="text-ink">/distill</span> skill to
            turn an article, note, or URL into a document — it&apos;ll appear here.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          {/* Sidebar (left) */}
          <div className="flex w-full shrink-0 flex-col overflow-y-auto lg:max-h-full lg:w-72">
            <button
              type="button"
              onClick={addGroup}
              className="mb-2 self-start rounded-md border border-ink/10 bg-base px-2.5 py-1 text-xs text-muted transition hover:text-ink"
              title="Create a new group"
            >
              + New group
            </button>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => {
                draggingRef.current = false
                setDragType(null)
              }}
            >
              {/* Ungrouped documents */}
              <Container id={UNGROUPED}>
                <SortableContext items={items[UNGROUPED]} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-1.5">
                    {items[UNGROUPED].map((slug) => {
                      const doc = bySlug[slug]
                      if (!doc) return null
                      return (
                        <DocRow
                          key={slug}
                          doc={doc}
                          isActive={slug === selected}
                          pending={removeMutation.isPending}
                          onSelect={() => setSelected(slug)}
                          onDelete={() => removeMutation.mutate({ slug })}
                        />
                      )
                    })}
                    {items[UNGROUPED].length === 0 && groups.length > 0 && (
                      <p className="rounded-md border border-dashed border-ink/10 px-3 py-2 text-center text-xs text-muted">
                        Drag a document here to ungroup it
                      </p>
                    )}
                  </div>
                </SortableContext>
              </Container>

              {/* Groups */}
              <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                <div className="mt-2 flex flex-col gap-2">
                  {groups.map((g) => (
                    <GroupBlock
                      key={g.id}
                      group={g}
                      count={items[g.id]?.length ?? 0}
                      defaultEditing={g.id === justAdded}
                      onToggle={() => toggleGroup(g.id)}
                      onRename={(name) => renameGroup(g.id, name)}
                      onDelete={() => deleteGroup(g.id)}
                      onEditingDone={() => setJustAdded(null)}
                    >
                      {!g.collapsed && (
                        <Container id={g.id}>
                          <SortableContext
                            items={items[g.id] ?? []}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="flex flex-col gap-1.5 pt-1.5">
                              {(items[g.id] ?? []).map((slug) => {
                                const doc = bySlug[slug]
                                if (!doc) return null
                                return (
                                  <DocRow
                                    key={slug}
                                    doc={doc}
                                    isActive={slug === selected}
                                    pending={removeMutation.isPending}
                                    onSelect={() => setSelected(slug)}
                                    onDelete={() => removeMutation.mutate({ slug })}
                                  />
                                )
                              })}
                              {(items[g.id]?.length ?? 0) === 0 && (
                                <p className="rounded-md border border-dashed border-ink/10 px-3 py-2 text-center text-xs text-muted">
                                  Drag documents here
                                </p>
                              )}
                            </div>
                          </SortableContext>
                        </Container>
                      )}
                    </GroupBlock>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          {/* Viewer (right) */}
          <div className="min-h-[320px] flex-1 overflow-hidden rounded-lg border border-ink/10 bg-surface">
            {selected === null ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Select a document to read it.
              </div>
            ) : docQuery.isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Loading…
              </div>
            ) : docQuery.error ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Couldn&apos;t open this document.
              </div>
            ) : (
              <iframe
                key={selected}
                title={selected}
                srcDoc={docQuery.data?.html ?? ''}
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                className="h-full w-full border-0"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── droppable container (so empty / collapsed areas still accept drops) ────────

function Container({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `body:${id}` })
  return <div ref={setNodeRef}>{children}</div>
}

// ── one document row (whole body draggable; click selects; ✕ deletes) ──────────

function DocRow({
  doc,
  isActive,
  pending,
  onSelect,
  onDelete,
}: {
  doc: DocMeta
  isActive: boolean
  pending: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: doc.slug,
  })
  const [confirm, setConfirm] = useState(false)
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
      className={
        'group relative cursor-grab rounded-lg border transition active:cursor-grabbing ' +
        (isActive ? 'border-emerald bg-emerald/10' : 'border-ink/10 bg-base hover:border-ink/25')
      }
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full px-3 py-2 pr-8 text-left"
      >
        <div className="truncate text-sm font-medium text-ink">{doc.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span>{fmtDate(doc.modifiedAt)}</span>
          <span>·</span>
          <span>{fmtSize(doc.sizeBytes)}</span>
          {doc.hasPdf && (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
              PDF
            </span>
          )}
        </div>
      </button>

      {confirm ? (
        <div
          className="absolute right-1.5 top-1.5 flex items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="rounded border border-ink/20 bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-ink transition hover:bg-ink/10 disabled:opacity-50"
            title="Move this document to the Trash"
          >
            {pending ? '…' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            disabled={pending}
            className="rounded border border-ink/10 px-1.5 py-0.5 text-[11px] text-muted transition hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setConfirm(true)}
          className="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-xs text-muted opacity-0 transition hover:text-ink group-hover:opacity-100"
          aria-label="Delete document"
          title="Delete document"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── one group: draggable header (reorder) + collapsible body ───────────────────

function GroupBlock({
  group,
  count,
  defaultEditing,
  onToggle,
  onRename,
  onDelete,
  onEditingDone,
  children,
}: {
  group: Group
  count: number
  defaultEditing: boolean
  onToggle: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onEditingDone: () => void
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  })
  const [editing, setEditing] = useState(defaultEditing)
  const [draft, setDraft] = useState(group.name)
  const [confirm, setConfirm] = useState(false)
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  function commitRename() {
    setEditing(false)
    onEditingDone()
    if (draft.trim() !== group.name) onRename(draft)
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-ink/10 bg-surface/40">
      {/* Header — grab anywhere here to reorder the group */}
      <div
        {...attributes}
        {...listeners}
        className="flex cursor-grab items-center gap-1.5 px-2 py-1.5 active:cursor-grabbing"
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggle}
          className="shrink-0 rounded px-1 text-xs text-muted transition hover:text-ink"
          aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
          title={group.collapsed ? 'Expand' : 'Collapse'}
        >
          {group.collapsed ? '▸' : '▾'}
        </button>

        {editing ? (
          <input
            autoFocus
            value={draft}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraft(group.name)
                setEditing(false)
                onEditingDone()
              }
            }}
            className="min-w-0 flex-1 rounded border border-ink/10 bg-base px-1.5 py-0.5 text-xs font-semibold text-ink focus:border-emerald focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setDraft(group.name)
              setEditing(true)
            }}
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold uppercase tracking-wide text-ink"
            title="Click to rename"
          >
            {group.name}
          </button>
        )}

        <span className="shrink-0 text-[11px] tabular-nums text-muted">{count}</span>

        {confirm ? (
          <span className="flex shrink-0 items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-ink/20 bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-ink transition hover:bg-ink/10"
              title="Remove the group (documents move back to ungrouped — files are kept)"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="rounded border border-ink/10 px-1.5 py-0.5 text-[11px] text-muted transition hover:text-ink"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setConfirm(true)}
            className="shrink-0 rounded px-1 text-xs text-muted transition hover:text-ink"
            aria-label="Remove group"
            title="Remove group (keeps the documents)"
          >
            ✕
          </button>
        )}
      </div>

      {/* Body (documents) — hidden when collapsed */}
      {!group.collapsed && <div className="px-2 pb-2">{children}</div>}
    </div>
  )
}

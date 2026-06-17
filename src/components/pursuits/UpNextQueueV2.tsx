'use client'

/**
 * UpNextQueueV2 — design-review rebuild of the "Up next" numbered queue panel.
 *
 * Data layer: identical to UpNextQueue.tsx — same 5 tRPC queries, same index,
 * same entry resolution, same suggestions, same three mutations, same dnd-kit
 * setup, same modal. Only the visuals change.
 *
 * Built on @/components/ui primitives + Tailwind token utilities.
 * Zero .pmc / .un- / .boa / .cbo scoped CSS classes.
 *
 * Colour rule (non-negotiable — the palette is red-green-safe for accessibility):
 *   State conveyed via blue↔amber + brightness only.
 *   NOW   → primary (blue)
 *   Overdue → Badge variant="warning" (amber)
 *   NEVER red or green for state.
 */

import { useState, type JSX } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Target } from 'lucide-react'
import { buildPursuitsIndex } from '@/components/tasks/pursuitsShared'
import { suggestions, goalProgress, deadlineLabel } from '@/lib/pursuitsDerived'
import { FocusRowButton } from '@/components/focus/PursuitFocus'
import { ItemDetailModal } from '@/components/shared/ItemDetailModal'
import type { DetailKind } from '@/components/shared/ItemDetailModal'
import type { GoalNode } from '@/stores/goalStore'
import type { TaskNode } from '@/components/tasks/TaskTreeNode'
import { Panel } from '@/components/ui/panel'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

// ── Resolved display entry ───────────────────────────────────────────────────

interface TaskEntry {
  itemId: string
  kind: 'task'
  id: string
  title: string
  task: TaskNode
  crumb: string
}

interface GoalEntry {
  itemId: string
  kind: 'goal'
  id: string
  title: string
  goal: GoalNode
  crumb: string
  pct: number
}

type QueueEntry = TaskEntry | GoalEntry

// ── Sortable row ─────────────────────────────────────────────────────────────

function SortableRow({
  entry,
  index,
  onOpenDetail,
  onRemove,
}: {
  entry: QueueEntry
  index: number
  onOpenDetail: (kind: DetailKind, id: string) => void
  onRemove: (kind: 'task' | 'goal', id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.itemId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const isNow = index === 0

  // Deadline chip for task entries
  const dlChip = (() => {
    if (entry.kind !== 'task') return null
    const dl = deadlineLabel(entry.task.deadline ?? null)
    if (!dl) return null
    return dl.overdue ? (
      <Badge variant="warning">{dl.txt}</Badge>
    ) : (
      <Badge variant="outline">{dl.txt}</Badge>
    )
  })()

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'flex items-center gap-2.5 rounded-[calc(var(--radius)-4px)] px-2.5 py-2',
        'cursor-grab border border-transparent transition-colors hover:bg-secondary',
        isDragging && 'ring-2 ring-primary',
      )}
      onClick={() => onOpenDetail(entry.kind as DetailKind, entry.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetail(entry.kind as DetailKind, entry.id)
        }
      }}
    >
      {/* Number chip */}
      <span
        className={cn(
          'w-9 shrink-0 rounded-md py-0.5 text-center text-[11px] font-bold',
          isNow
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-secondary text-muted-foreground',
        )}
      >
        {isNow ? 'NOW' : index + 1}
      </span>

      {/* Goal icon */}
      {entry.kind === 'goal' && (
        <Target className="size-3.5 shrink-0 text-primary" />
      )}

      {/* Main content */}
      <span className="min-w-0 flex-1 flex flex-col">
        <span className="text-sm font-semibold text-foreground truncate">
          {entry.title}
        </span>
        <span className="text-[10.5px] text-muted-foreground truncate">
          {entry.crumb}
        </span>
      </span>

      {/* Task chips */}
      {entry.kind === 'task' && (
        <>
          {entry.task.priority != null && (
            <Badge variant="secondary">P{entry.task.priority}</Badge>
          )}
          {entry.task.energy != null && (
            <span className="text-xs text-muted-foreground">
              {entry.task.energy === 'high'
                ? '⚡'
                : entry.task.energy === 'medium'
                  ? '◐'
                  : '🌿'}
            </span>
          )}
          {entry.task.estimateMin != null && (
            <span className="text-xs text-muted-foreground">
              {entry.task.estimateMin}m
            </span>
          )}
          {dlChip}
        </>
      )}

      {/* Goal mini progress */}
      {entry.kind === 'goal' && (
        <>
          <Progress value={entry.pct} className="h-1.5 w-[90px]" />
          <span className="text-xs text-muted-foreground">{entry.pct}%</span>
        </>
      )}

      {/* Focus button */}
      <span onClick={(e) => e.stopPropagation()}>
        <FocusRowButton kind={entry.kind} id={entry.id} />
      </span>

      {/* Remove button */}
      <button
        type="button"
        title="Remove from Up next"
        className="px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation()
          onRemove(entry.kind, entry.id)
        }}
      >
        ✕
      </button>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function UpNextQueueV2(): JSX.Element | null {
  const utils = trpc.useUtils()

  // Data queries
  const { data: queueItems = [] } = trpc.upNext.list.useQuery()
  const { data: taskRoots = [] } = trpc.task.tree.useQuery()
  const { data: goalRoots = [] } = trpc.goal.tree.useQuery()
  const { data: areas = [] } = trpc.area.list.useQuery()
  const { data: projects = [] } = trpc.project.list.useQuery()

  // Modal state
  const [modal, setModal] = useState<{ kind: DetailKind; id: string } | null>(null)

  // Mutations
  const removeMutation = trpc.upNext.remove.useMutation({
    onSettled: () => { void utils.upNext.list.invalidate() },
  })
  const reorderMutation = trpc.upNext.reorder.useMutation({
    onSettled: () => { void utils.upNext.list.invalidate() },
  })
  const addMutation = trpc.upNext.add.useMutation({
    onSettled: () => { void utils.upNext.list.invalidate() },
  })

  // Build lookup index
  const index = buildPursuitsIndex(taskRoots, goalRoots, projects)

  // Resolve queue items to display entries, silently dropping stale refs
  const entries: QueueEntry[] = []
  for (const item of queueItems) {
    if (item.kind === 'task' && item.taskId) {
      const node = index.idToNode.get(item.taskId)
      if (!node || node.status === 'done') continue

      let crumb = ''
      const goal = node.goalId ? index.goalById.get(node.goalId) : null
      const area = areas.find((a) => a.id === (node.areaId ?? goal?.areaId))
      if (area && goal) crumb = `${area.name} › ${goal.title}`
      else if (area) crumb = area.name
      else if (goal) crumb = goal.title

      entries.push({
        itemId: item.id,
        kind: 'task',
        id: item.taskId,
        title: node.title,
        task: node,
        crumb,
      })
    } else if (item.kind === 'goal' && item.goalId) {
      const goal = index.goalById.get(item.goalId)
      if (!goal || goal.status === 'completed') continue

      const area = areas.find((a) => a.id === goal.areaId)
      const project = goal.projectId
        ? projects.find((p) => p.id === goal.projectId)
        : null
      let crumb = area?.name ?? ''
      if (project) crumb = crumb ? `${crumb} › ${project.name}` : project.name

      const goalTasks = index.rootsByOwner.get(goal.id) ?? []
      const pct = goalProgress(goalTasks)

      entries.push({
        itemId: item.id,
        kind: 'goal',
        id: item.goalId,
        title: goal.title,
        goal,
        crumb,
        pct,
      })
    }
  }

  // Suggestions — filtered to entries not already in the queue
  const pinnedTaskIds = new Set(entries.filter((e) => e.kind === 'task').map((e) => e.id))
  const pinnedGoalIds = new Set(entries.filter((e) => e.kind === 'goal').map((e) => e.id))
  const suggestionList = suggestions({ areas, index, pinnedTaskIds, pinnedGoalIds })

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = entries.findIndex((e) => e.itemId === active.id)
    const newIndex = entries.findIndex((e) => e.itemId === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(entries, oldIndex, newIndex)
    reorderMutation.mutate({ orderedIds: reordered.map((e) => e.itemId) })
  }

  return (
    <Panel>
      {/* Panel header */}
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Up next
        </h3>
        <span className="text-xs text-muted-foreground">
          drag to reorder · click for details
        </span>
      </div>

      {/* Queue rows */}
      {entries.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Nothing queued yet — add tasks or goals to build your order.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={entries.map((e) => e.itemId)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-0.5">
              {entries.map((entry, idx) => (
                <SortableRow
                  key={entry.itemId}
                  entry={entry}
                  index={idx}
                  onOpenDetail={(kind, id) => setModal({ kind, id })}
                  onRemove={(kind, id) => removeMutation.mutate({ kind, id })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Suggestions strip */}
      {suggestionList.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
            Suggestions
          </span>
          {suggestionList.map((s) => (
            <button
              key={s.task.id}
              type="button"
              title={`${s.areaName} › ${s.goal.title}`}
              className={cn(
                'rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground',
                'transition-colors hover:border-primary hover:text-primary',
              )}
              onClick={() => addMutation.mutate({ kind: 'task', id: s.task.id })}
            >
              ＋ {s.task.title}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">
            auto-picked by deadline — click ＋ to add
          </span>
        </div>
      )}

      {/* Detail modal */}
      {modal && (
        <ItemDetailModal
          kind={modal.kind}
          id={modal.id}
          onClose={() => setModal(null)}
        />
      )}
    </Panel>
  )
}

'use client'

/**
 * SortableList / SortableItem — the ONE reusable drag-to-reorder primitive for
 * Life OS. Grab an item ANYWHERE on its body and slide it to reorder, exactly
 * like the Pursuits area bars. We never use a separate drag handle / grip icon
 * in this app — the element itself is the handle.
 *
 * Usage (any list, any item type):
 *
 *   const reorder = trpc.thing.reorder.useMutation({ onSettled: invalidate })
 *
 *   <SortableList
 *     ids={items.map((i) => i.id)}
 *     onReorder={(orderedIds) => reorder.mutate({ orderedIds })}
 *     className="flex flex-col gap-2"
 *   >
 *     {items.map((i) => (
 *       <SortableItem key={i.id} id={i.id}>
 *         …your row markup…
 *       </SortableItem>
 *     ))}
 *   </SortableList>
 *
 * Notes
 * • Whole-body handle: the entire <SortableItem> is draggable. Buttons, inputs
 *   and checkboxes inside it still work, because a drag only begins after the
 *   pointer moves 4px — a plain click never starts a drag. For a control where
 *   even a 4px nudge would be disruptive (e.g. a text input you click into),
 *   add onPointerDown={(e) => e.stopPropagation()} to that control.
 * • Nesting: a <SortableItem> may itself contain another <SortableList> for a
 *   sub-list. dnd-kit scopes droppables to their own <DndContext> and routes a
 *   drag to the innermost context, so the outer and inner lists never collide.
 *   To make a row inside a nested list move the OUTER list instead of the inner
 *   one, render it with <SortableItem disabled> (or, for the shared Pursuits
 *   rows, rely on DailyPlanMode) so its press bubbles up to the outer handle.
 */

import React from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface SortableListProps {
  /** Item ids in current display order. Drives both the sort + the new order. */
  ids: string[]
  /** Called with the reordered id list after a successful drag. */
  onReorder: (orderedIds: string[]) => void
  children: React.ReactNode
  /** Optional wrapper class around the items (e.g. "flex flex-col gap-2"). */
  className?: string
}

export function SortableList({ ids, onReorder, children, className }: SortableListProps) {
  // 4px activation so a plain click (checkbox / expand / button) never drags.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(ids, oldIndex, newIndex))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {className ? <div className={className}>{children}</div> : children}
      </SortableContext>
    </DndContext>
  )
}

interface SortableItemProps {
  id: string
  /** When true the item can't be dragged and its press bubbles to an enclosing
   *  SortableList (used to make a nested row move the outer list). */
  disabled?: boolean
  children: React.ReactNode
  className?: string
}

export function SortableItem({ id, disabled, children, className }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  // When disabled we attach NO drag listeners, so a press bubbles past this
  // item to whatever SortableList encloses it.
  const dragProps = disabled ? {} : { ...attributes, ...listeners }
  const cursor = disabled ? '' : 'cursor-grab active:cursor-grabbing '

  return (
    <div ref={setNodeRef} style={style} {...dragProps} className={cursor + (className ?? '')}>
      {children}
    </div>
  )
}

'use client'

/**
 * AreasColumn — left column of Mission Control.
 *
 * Each area is a selectable row (colour dot, name, open-task count). Clicking a
 * row selects that area (pursuitsStore.setSelArea), which drives the Goals
 * column. Hover reveals the same per-area actions AreaSection has in the legacy
 * TaskTree: rename ✎, ⚙ details modal, 🗑 archive (with confirm), + project,
 * + goal, + task, FocusRowButton, PlanButton, TimeTally. Areas remain a
 * SortableContext so drag-to-reorder still works (the wrapping DndContext lives
 * in PursuitsColumns).
 *
 * Below the list sits the "Overview" block: a per-area progress bar + open
 * count (countTasks), the sidebar piece carried over from V1.
 */

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ItemDetailModal } from '@/components/shared/ItemDetailModal'
import { PlanButton } from '@/components/tasks/PlanButton'
import { FocusRowButton, TimeTally } from '@/components/focus/PursuitFocus'
import { GoalForm } from '@/components/goals/GoalForm'
import { usePursuitsStore } from '@/stores/pursuitsStore'
import { countTasks } from '@/lib/pursuitsDerived'
import type { TaskNode } from '@/components/tasks/TaskTreeNode'
import type { Area, PursuitsIndex } from '@/components/tasks/pursuitsShared'

interface AreasColumnProps {
  areas: Area[]
  index: PursuitsIndex
  showArchive: boolean
  toggleArchive: () => void
}

export function AreasColumn({ areas, index, showArchive, toggleArchive }: AreasColumnProps) {
  const { rootsByOwner, goalsByArea, goalsByProject, projectsByArea } = index

  // Gather every top-level task under an area (its loose tasks + every goal's
  // tasks + every project goal's tasks) so the open-count and Overview bar
  // reflect the whole area, matching V1's areaStats.
  function areaTasks(areaId: string): TaskNode[] {
    const out: TaskNode[] = [...(rootsByOwner.get(areaId) ?? [])]
    for (const g of goalsByArea.get(areaId) ?? []) {
      out.push(...(rootsByOwner.get(g.id) ?? []))
    }
    for (const p of projectsByArea.get(areaId) ?? []) {
      for (const g of goalsByProject.get(p.id) ?? []) {
        out.push(...(rootsByOwner.get(g.id) ?? []))
      }
    }
    return out
  }

  return (
    <div className="panel v2-col">
      <div className="v2-colhead">
        Areas
        <span style={{ marginLeft: 'auto' }}>
          <NewAreaButton />
        </span>
      </div>

      <SortableContext items={areas.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        {areas.map((area) => (
          <AreaRow
            key={area.id}
            area={area}
            tasks={areaTasks(area.id)}
          />
        ))}
      </SortableContext>

      {areas.length === 0 && (
        <p className="v2-empty">No areas yet.</p>
      )}

      {/* Overview block — per-area progress bar + open count. */}
      {areas.length > 0 && (
        <div className="ov-block">
          <h4>Overview</h4>
          {areas.map((area) => {
            const { done, total } = countTasks(areaTasks(area.id))
            const pct = total ? Math.round((done / total) * 100) : 0
            return (
              <div key={area.id} className="ov-row">
                <span
                  className="dot"
                  style={{ backgroundColor: area.color ?? 'var(--line-strong)' }}
                />
                <span className="nm">{area.name}</span>
                <span className="pbar"><span style={{ width: `${pct}%` }} /></span>
                <span className="ct">{total - done} open</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Archive toggle — moved into the Areas column footer. */}
      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--line)' }}>
        <label className={'arch-toggle' + (showArchive ? ' on' : '')} onClick={toggleArchive}>
          <span className="track" />
          Archive
        </label>
      </div>
    </div>
  )
}

// ─────────────────── "+ area" (header button) ───────────────────

function NewAreaButton() {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const utils = trpc.useUtils()
  const createMutation = trpc.area.create.useMutation({
    onSuccess: () => { setName(''); setAdding(false); void utils.area.list.invalidate() },
  })

  function addArea() {
    const n = name.trim()
    if (!n) return
    createMutation.mutate({ name: n })
  }

  if (!adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className="ghostbtn">
        + area
      </button>
    )
  }

  return (
    <div
      className="add-row"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setAdding(false); setName('')
        }
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') addArea()
          if (e.key === 'Escape') { setAdding(false); setName('') }
        }}
        placeholder="New area…"
      />
      <button type="button" onClick={addArea} className="bluebtn">
        Add
      </button>
    </div>
  )
}

// ─────────────────── A single selectable area row ───────────────────

function AreaRow({ area, tasks }: { area: Area; tasks: TaskNode[] }) {
  const selAreaId = usePursuitsStore((s) => s.selAreaId)
  const setSelArea = usePursuitsStore((s) => s.setSelArea)
  const selected = selAreaId === area.id
  const { done, total } = useMemo(() => countTasks(tasks), [tasks])
  const open = total - done

  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(area.name)
  const [detailOpen, setDetailOpen] = useState(false)
  const [addingProject, setAddingProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [addingGoal, setAddingGoal] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')

  const utils = trpc.useUtils()
  const renameMutation = trpc.area.update.useMutation({
    onSuccess: () => { setRenaming(false); void utils.area.list.invalidate() },
  })
  const createProjectMutation = trpc.project.create.useMutation({
    onSuccess: () => { setProjectName(''); setAddingProject(false); void utils.project.list.invalidate() },
  })
  const archiveMutation = trpc.area.archive.useMutation({
    onSettled: () => {
      void utils.area.list.invalidate()
      void utils.goal.tree.invalidate()
      void utils.task.tree.invalidate()
    },
  })
  const createTaskMutation = trpc.task.create.useMutation({
    onSuccess: () => { setTaskTitle(''); setAddingTask(false); void utils.task.tree.invalidate() },
  })

  // Drag-to-reorder among areas — the whole row is the handle (4px activation
  // means a plain click still selects / hits the buttons).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: area.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  function addProject() {
    const n = projectName.trim()
    if (!n) return
    createProjectMutation.mutate({ name: n, areaId: area.id })
  }
  function addTask() {
    const t = taskTitle.trim()
    if (!t) return
    createTaskMutation.mutate({ title: t, areaId: area.id })
  }

  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div ref={setNodeRef} style={style}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => setSelArea(area.id)}
        className={'v2-area' + (selected ? ' sel' : '')}
      >
        <span
          className="dot"
          style={{ backgroundColor: area.color ?? 'var(--line-strong)' }}
        />

        {renaming ? (
          <input
            autoFocus
            value={name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) renameMutation.mutate({ id: area.id, name: name.trim() })
              if (e.key === 'Escape') { setRenaming(false); setName(area.name) }
            }}
            onBlur={() => { setRenaming(false); setName(area.name) }}
            style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '2px 8px', fontSize: 13, color: 'var(--ink)' }}
          />
        ) : (
          <span>
            <span className="nm">{area.name}</span>
            <br />
            <span className="sub">{open} open · {pct}%</span>
          </span>
        )}

        <TimeTally kind="area" id={area.id} />
      </button>

      {/* Hover actions — preserved below the area row. */}
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1 -mt-0.5 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => { setSelArea(area.id); setAddingProject(true) }}
          className="ghostbtn"
        >
          + project
        </button>
        <button
          type="button"
          onClick={() => { setSelArea(area.id); setAddingGoal(true) }}
          className="ghostbtn"
        >
          + goal
        </button>
        <button
          type="button"
          onClick={() => setAddingTask(true)}
          className="ghostbtn"
        >
          + task
        </button>
        <FocusRowButton kind="area" id={area.id} />
        <PlanButton kind="area" id={area.id} />
        <button
          type="button"
          onClick={() => setRenaming(true)}
          className="ghostbtn"
          aria-label="Rename area"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="ghostbtn"
          aria-label="Edit all details"
          title="Edit all details"
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Archive area "${area.name}"? Its goals stay, but lose their area.`)) {
              archiveMutation.mutate({ id: area.id })
            }
          }}
          className="ghostbtn"
          aria-label="Archive area"
        >
          🗑
        </button>
      </div>

      {/* Inline new-project input. */}
      {addingProject && (
        <div
          className="add-row"
          style={{ padding: '0 8px 8px' }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setAddingProject(false); setProjectName('')
            }
          }}
        >
          <input
            autoFocus
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addProject()
              if (e.key === 'Escape') { setAddingProject(false); setProjectName('') }
            }}
            placeholder="New project…"
          />
          <button type="button" onClick={addProject} className="bluebtn">
            Add
          </button>
        </div>
      )}

      {/* Inline new-goal form (creates an area-level goal). */}
      {addingGoal && (
        <div style={{ padding: '0 8px 8px' }}>
          <GoalForm
            defaultAreaId={area.id}
            onSuccess={() => setAddingGoal(false)}
            onCancel={() => setAddingGoal(false)}
          />
        </div>
      )}

      {/* Inline new loose-task input. */}
      {addingTask && (
        <div
          className="add-row"
          style={{ padding: '0 8px 8px' }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setAddingTask(false); setTaskTitle('')
            }
          }}
        >
          <input
            autoFocus
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTask()
              if (e.key === 'Escape') { setAddingTask(false); setTaskTitle('') }
            }}
            placeholder="New task…"
          />
          <button type="button" onClick={addTask} className="bluebtn">
            Add
          </button>
        </div>
      )}

      {detailOpen && (
        <ItemDetailModal kind="area" id={area.id} onClose={() => setDetailOpen(false)} />
      )}
    </div>
  )
}

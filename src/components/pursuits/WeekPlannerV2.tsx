'use client'

/**
 * WeekPlannerV2 — "Plan your days" panel, design-system rebuild.
 *
 * ALL data wiring, dnd logic, and the collapsible pool tree are identical
 * to WeekPlanner.tsx. Only visual styling changes: .panel / .cal-* /
 * .ct2 / .cm / .grow class-based styling replaced with Tailwind token
 * utilities + the Panel primitive. Do NOT import the pmc CSS here.
 *
 * e2e note: heading MUST remain <h2> with exact text "Plan your days"
 * (Playwright: getByRole('heading', { level: 2, name: 'Plan your days' })).
 *
 * Area-colour accents on chips are kept as inline borderLeftColor because
 * they carry real per-area data that Tailwind cannot express statically.
 *
 * Token fallbacks chosen:
 *   --color-blue-soft → does NOT exist; today column uses primary border +
 *     bg-secondary (same readable tint used everywhere else).
 *   --color-blue / --color-muted / --color-faint → confirmed in globals.css,
 *     kept as CSS custom-property references in inline style where needed.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { trpc } from '@/lib/trpc/client'
import { buildPursuitsIndex, type Area, type Project } from '@/components/tasks/pursuitsShared'
import { visibleTasks } from '@/lib/pursuitsDerived'
import type { TaskNode } from '@/components/tasks/TaskTreeNode'
import type { GoalNode } from '@/stores/goalStore'
import { Panel } from '@/components/ui/panel'
import { cn } from '@/lib/utils'

// ── date helpers ─────────────────────────────────────────────────────────────

/** Local calendar YYYY-MM-DD (matches dayPlanner.ts todayISO). */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Add `n` days to a Date (returns a new Date). */
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

/** Short weekday + day-number label, e.g. "Mon 9". */
function shortLabel(d: Date): string {
  const wd = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)
  return `${wd} ${d.getDate()}`
}

interface DayInfo {
  date: string   // YYYY-MM-DD
  label: string  // "Mon 9"
  today: boolean
}

function buildWeek(): DayInfo[] {
  const base = new Date()
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(base, i)
    return { date: localISO(d), label: shortLabel(d), today: i === 0 }
  })
}

// ── drag item shapes ──────────────────────────────────────────────────────────

type DragKind = 'task' | 'goal'
interface DragData {
  kind: DragKind
  id: string
  title: string
}

// ── DraggablePoolChip ─────────────────────────────────────────────────────────

interface DraggablePoolChipProps {
  kind: DragKind
  id: string
  title: string
  areaColor?: string | null
  indent?: number
}

function DraggablePoolChip({ kind, id, title, areaColor, indent = 0 }: DraggablePoolChipProps) {
  const dragId = `${kind}:${id}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { kind, id, title } satisfies DragData,
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title="Drag onto a day to plan it"
      className={cn(
        'rounded-lg border border-border bg-card px-2 py-1.5 text-xs',
        'cursor-grab transition-opacity',
      )}
      style={{
        borderLeftWidth: 4,
        borderLeftColor: areaColor ?? 'var(--color-muted)',
        marginLeft: indent * 10,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <span className="block font-semibold leading-snug">
        {kind === 'goal' && <span style={{ marginRight: 4, opacity: 0.7 }}>◎</span>}
        {title}
      </span>
    </div>
  )
}

// ── DroppablePoolColumn ───────────────────────────────────────────────────────

interface DroppablePoolColumnProps {
  unplannedCount: number
  children: React.ReactNode
}

function DroppablePoolColumn({ unplannedCount, children }: DroppablePoolColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // base day cell — solid border + deeper bg for pool
        'rounded-xl border border-solid border-border bg-background p-2 min-h-[120px] flex flex-col gap-1.5',
        isOver && 'ring-2 ring-primary ring-inset',
      )}
    >
      <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-muted-foreground mb-1">
        Unplanned ({unplannedCount})
      </div>
      {children}
    </div>
  )
}

// ── DroppableDayColumn ────────────────────────────────────────────────────────

interface PlannerBlock {
  id: string
  title: string
  taskId: string | null
  goalId: string | null
  date: string
}

interface DroppableDayColumnProps {
  day: DayInfo
  blocks: PlannerBlock[]
  isLastDay: boolean
  nextDayDate: string | null
  onRemove: (block: PlannerBlock) => void
  onReschedule: (block: PlannerBlock, toDate: string) => void
  getBlockAreaColor: (block: PlannerBlock) => string | null
}

function DroppableDayColumn({
  day,
  blocks,
  isLastDay,
  nextDayDate,
  onRemove,
  onReschedule,
  getBlockAreaColor,
}: DroppableDayColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.date}` })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl border border-dashed border-border bg-secondary p-2 min-h-[120px] flex flex-col gap-1.5',
        day.today && 'border-solid border-primary bg-secondary',
        isOver && 'ring-2 ring-primary ring-inset',
      )}
    >
      {/* Column header */}
      <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-muted-foreground mb-1">
        {day.label}
        {day.today && <span className="text-primary"> · today</span>}
      </div>

      {/* Chips */}
      {blocks.length === 0 ? (
        <span
          className="block text-center text-[10px] opacity-60"
          style={{ color: 'var(--color-faint)', padding: '4px 4px' }}
        >
          drop here
        </span>
      ) : (
        blocks.map((block) => {
          const areaColor = getBlockAreaColor(block)
          return (
            <div
              key={block.id}
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
              style={{ borderLeftWidth: 4, borderLeftColor: areaColor ?? 'var(--color-muted)' }}
            >
              <span className="block font-semibold leading-snug">{block.title}</span>
              <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <span className="flex-1" />
                {!isLastDay && nextDayDate && (
                  <button
                    title="Push to next day"
                    onClick={() => onReschedule(block, nextDayDate)}
                    className="border-none bg-transparent text-muted-foreground hover:text-primary font-bold px-0.5 cursor-pointer"
                  >
                    →
                  </button>
                )}
                <button
                  title="Remove from day"
                  onClick={() => onRemove(block)}
                  className="border-none bg-transparent text-muted-foreground hover:text-primary font-bold px-0.5 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

// ── WeekPlannerV2 (main export) ───────────────────────────────────────────────

export function WeekPlannerV2(): JSX.Element {
  const areasQuery = trpc.area.list.useQuery()
  const projectsQuery = trpc.project.list.useQuery()
  const treeQuery = trpc.task.tree.useQuery()
  const goalsQuery = trpc.goal.tree.useQuery()

  const week = useMemo(() => buildWeek(), [])
  const fromDate = week[0].date
  const toDate = week[week.length - 1].date

  const rangeQuery = trpc.dayPlanner.range.useQuery({ from: fromDate, to: toDate })

  const utils = trpc.useUtils()

  const addFromPursuits = trpc.dayPlanner.addFromPursuits.useMutation({
    onSettled: () => {
      void utils.dayPlanner.range.invalidate()
      void utils.dayPlanner.today.invalidate()
    },
  })
  const removeByRef = trpc.dayPlanner.removeByRef.useMutation({
    onSettled: () => {
      void utils.dayPlanner.range.invalidate()
      void utils.dayPlanner.today.invalidate()
    },
  })
  const rescheduleMut = trpc.dayPlanner.reschedule.useMutation({
    onSettled: () => {
      void utils.dayPlanner.range.invalidate()
      void utils.dayPlanner.today.invalidate()
    },
  })

  // Collapse state for pool tree (Set of area/goal/project ids that are collapsed).
  // Goals and projects start COLLAPSED by default; areas start expanded.
  // We seed the set once on first non-empty data load so that late-loaded ids
  // are also included. The seededRef prevents re-seeding on subsequent renders.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const seededRef = useRef(false)
  const [activeItem, setActiveItem] = useState<DragData | null>(null)

  const roots = (treeQuery.data ?? []) as TaskNode[]
  const goals = (goalsQuery.data ?? []) as GoalNode[]
  const areas = (areasQuery.data ?? []) as Area[]
  const projects = (projectsQuery.data ?? []) as Project[]

  const index = useMemo(() => buildPursuitsIndex(roots, goals, projects), [roots, goals, projects])

  // Area color lookup map
  const areaColorMap = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const a of areas) m.set(a.id, a.color ?? null)
    return m
  }, [areas])

  // Goal → areaId reverse lookup
  const goalAreaMap = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const g of goals) m.set(g.id, g.areaId)
    return m
  }, [goals])

  // Task → areaId reverse lookup (flat traversal of roots)
  const taskAreaMap = useMemo(() => {
    const m = new Map<string, string | null>()
    function walk(nodes: TaskNode[]) {
      for (const n of nodes) {
        m.set(n.id, n.areaId ?? null)
        if (n.children?.length) walk(n.children as TaskNode[])
      }
    }
    walk(roots)
    return m
  }, [roots])

  // Seed collapsed set once on first non-empty data load.
  // Goals and projects start COLLAPSED; areas are NOT included so they stay
  // visible/expanded. The seededRef prevents re-seeding on re-renders, so
  // user expand/collapse actions are never overwritten after initial load.
  useEffect(() => {
    const dataReady = goals.length > 0 || projects.length > 0
    if (!dataReady || seededRef.current) return
    seededRef.current = true
    const seed = new Set<string>()
    for (const g of goals) seed.add(g.id)
    for (const p of projects) seed.add(p.id)
    setCollapsed(seed)
  }, [goals, projects])

  /** Resolve the area color for a placed PlannerBlock. */
  function getBlockAreaColor(block: PlannerBlock): string | null {
    let areaId: string | null | undefined = null
    if (block.goalId) {
      areaId = goalAreaMap.get(block.goalId)
    } else if (block.taskId) {
      areaId = taskAreaMap.get(block.taskId)
    }
    if (!areaId) return null
    return areaColorMap.get(areaId) ?? null
  }

  // Build a set of already-planned task/goal ids for this week
  const rangeBlocks = rangeQuery.data ?? []
  const plannedTaskIds = useMemo(() => {
    const s = new Set<string>()
    for (const b of rangeBlocks) {
      if (b.taskId) s.add(b.taskId)
    }
    return s
  }, [rangeBlocks])
  const plannedGoalIds = useMemo(() => {
    const s = new Set<string>()
    for (const b of rangeBlocks) {
      if (b.goalId) s.add(b.goalId)
    }
    return s
  }, [rangeBlocks])

  // Blocks by date for the 7 columns
  const blocksByDate = useMemo(() => {
    const map = new Map<string, PlannerBlock[]>()
    for (const d of week) map.set(d.date, [])
    for (const b of rangeBlocks) {
      if (!b.taskId && !b.goalId) continue // skip blocks with no pursuits ref
      const list = map.get(b.date)
      if (list) list.push({ id: b.id, title: b.title, taskId: b.taskId, goalId: b.goalId, date: b.date })
    }
    return map
  }, [rangeBlocks, week])

  // sensors: PointerSensor with distance 4 (same as pursuits dnd)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as DragData | undefined
    if (data) setActiveItem(data)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveItem(null)
    const { over, active } = e
    if (!over) return

    const overId = String(over.id)
    if (!overId.startsWith('day:')) return

    const date = overId.replace('day:', '')
    const data = active.data.current as DragData | undefined
    if (!data) return

    addFromPursuits.mutate({ kind: data.kind, id: data.id, date })
  }

  function handleRemove(block: PlannerBlock) {
    if (block.taskId) {
      removeByRef.mutate({ kind: 'task', id: block.taskId, date: block.date })
    } else if (block.goalId) {
      removeByRef.mutate({ kind: 'goal', id: block.goalId, date: block.date })
    }
  }

  function handleReschedule(block: PlannerBlock, toDate: string) {
    rescheduleMut.mutate({ id: block.id, date: toDate })
  }

  const isLoading =
    areasQuery.isPending ||
    projectsQuery.isPending ||
    treeQuery.isPending ||
    goalsQuery.isPending ||
    rangeQuery.isPending

  // Count unplanned items for pool header
  const unplannedCount = useMemo(() => {
    let n = 0
    for (const area of areas) {
      const areaGoals = (index.goalsByArea.get(area.id) ?? []).filter(
        (g) => g.status !== 'completed' && !plannedGoalIds.has(g.id),
      )
      n += areaGoals.length
      const areaProjects = index.projectsByArea.get(area.id) ?? []
      for (const proj of areaProjects) {
        const projGoals = (index.goalsByProject.get(proj.id) ?? []).filter(
          (g) => g.status !== 'completed' && !plannedGoalIds.has(g.id),
        )
        n += projGoals.length
      }
      const looseTasks = visibleTasks(index.rootsByOwner.get(area.id) ?? [], false).filter(
        (t) => !plannedTaskIds.has(t.id),
      )
      n += looseTasks.length
    }
    return n
  }, [areas, index, plannedGoalIds, plannedTaskIds])

  // Build pool items: areas → goals/projects → tasks (filtered by planned status)
  const poolIsEmpty = unplannedCount === 0

  return (
    <Panel className="flex flex-col gap-0">
      {/* Panel header */}
      <div className="flex items-baseline gap-3 mb-1 box-drag-handle cursor-grab active:cursor-grabbing select-none">
        {/* h2 kept (not h3) — e2e asserts getByRole('heading', { level: 2, name: 'Plan your days' }) */}
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0">
          Plan your days
        </h2>
        <span className="text-xs text-muted-foreground">
          drag onto a day · → pushes it a day later
        </span>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* cal-grid: pool column (1.25fr) + 7 day columns (each 1fr) */}
          <div
            className="mt-2.5 grid gap-2.5 items-stretch"
            style={{ gridTemplateColumns: '1.25fr repeat(7, 1fr)' }}
          >
            {/* POOL — first cell */}
            <DroppablePoolColumn unplannedCount={unplannedCount}>
              {poolIsEmpty ? (
                <div
                  className="text-center text-xs"
                  style={{ padding: '20px 12px', color: 'var(--color-faint)' }}
                >
                  Everything&apos;s planned!
                </div>
              ) : (
                areas.map((area) => {
                  const areaCollapsed = collapsed.has(area.id)
                  const areaGoals = (index.goalsByArea.get(area.id) ?? []).filter(
                    (g) => g.status !== 'completed',
                  )
                  const areaProjects = index.projectsByArea.get(area.id) ?? []
                  const looseTasks = visibleTasks(
                    index.rootsByOwner.get(area.id) ?? [],
                    false,
                  ).filter((t) => !plannedTaskIds.has(t.id))

                  // Count unplanned items in this area
                  const unplannedGoals = areaGoals.filter((g) => !plannedGoalIds.has(g.id))
                  const unplannedProjGoals = areaProjects.flatMap(
                    (p) =>
                      (index.goalsByProject.get(p.id) ?? []).filter(
                        (g) => g.status !== 'completed' && !plannedGoalIds.has(g.id),
                      ),
                  )
                  const hasAny =
                    unplannedGoals.length > 0 ||
                    unplannedProjGoals.length > 0 ||
                    looseTasks.length > 0

                  if (!hasAny) return null

                  const areaColor = areaColorMap.get(area.id) ?? null

                  return (
                    <div key={area.id}>
                      {/* Area header — collapsible */}
                      <button
                        onClick={() => toggleCollapse(area.id)}
                        className="flex items-center gap-1.5 w-full bg-transparent border-none cursor-pointer px-2.5 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                      >
                        {areaColor && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: areaColor }}
                          />
                        )}
                        <span className="text-[9px]" style={{ color: 'var(--color-faint)' }}>
                          {areaCollapsed ? '▶' : '▼'}
                        </span>
                        <span className="truncate">{area.name}</span>
                      </button>

                      {!areaCollapsed && (
                        <div>
                          {/* Area-level goals */}
                          {unplannedGoals.map((goal) => {
                            const goalCollapsed = collapsed.has(goal.id)
                            const goalTasks = visibleTasks(
                              index.rootsByOwner.get(goal.id) ?? [],
                              false,
                            ).filter((t) => !plannedTaskIds.has(t.id))

                            return (
                              <div key={goal.id}>
                                {/* Goal row — draggable + collapsible */}
                                <div className="flex items-center pl-2">
                                  {goalTasks.length > 0 && (
                                    <button
                                      onClick={() => toggleCollapse(goal.id)}
                                      className="bg-transparent border-none cursor-pointer px-0.5 text-[9px] leading-none shrink-0"
                                      style={{ color: 'var(--color-faint)' }}
                                    >
                                      {goalCollapsed ? '▶' : '▼'}
                                    </button>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <DraggablePoolChip
                                      kind="goal"
                                      id={goal.id}
                                      title={goal.title}
                                      areaColor={areaColor}
                                      indent={0}
                                    />
                                  </div>
                                </div>

                                {/* Goal tasks */}
                                {!goalCollapsed &&
                                  goalTasks.map((task) => (
                                    <DraggablePoolChip
                                      key={task.id}
                                      kind="task"
                                      id={task.id}
                                      title={task.title}
                                      areaColor={areaColor}
                                      indent={2}
                                    />
                                  ))}
                              </div>
                            )
                          })}

                          {/* Project-level goals */}
                          {areaProjects.map((proj) => {
                            const projGoals = (
                              index.goalsByProject.get(proj.id) ?? []
                            ).filter(
                              (g) => g.status !== 'completed' && !plannedGoalIds.has(g.id),
                            )
                            if (projGoals.length === 0) return null

                            const projCollapsed = collapsed.has(proj.id)
                            return (
                              <div key={proj.id}>
                                {/* Project sub-header */}
                                <button
                                  onClick={() => toggleCollapse(proj.id)}
                                  className="flex items-center gap-1 w-full bg-transparent border-none cursor-pointer py-0.5 pl-5 pr-2.5 text-[10.5px] font-semibold text-left truncate"
                                  style={{ color: 'var(--color-faint)' }}
                                >
                                  <span className="text-[9px]">
                                    {projCollapsed ? '▶' : '▼'}
                                  </span>
                                  <span className="truncate">{proj.name}</span>
                                </button>

                                {!projCollapsed &&
                                  projGoals.map((goal) => {
                                    const goalCollapsed2 = collapsed.has(goal.id)
                                    const goalTasks = visibleTasks(
                                      index.rootsByOwner.get(goal.id) ?? [],
                                      false,
                                    ).filter((t) => !plannedTaskIds.has(t.id))

                                    return (
                                      <div key={goal.id}>
                                        <div className="flex items-center pl-4">
                                          {goalTasks.length > 0 && (
                                            <button
                                              onClick={() => toggleCollapse(goal.id)}
                                              className="bg-transparent border-none cursor-pointer px-0.5 text-[9px] leading-none shrink-0"
                                              style={{ color: 'var(--color-faint)' }}
                                            >
                                              {goalCollapsed2 ? '▶' : '▼'}
                                            </button>
                                          )}
                                          <div className="flex-1 min-w-0">
                                            <DraggablePoolChip
                                              kind="goal"
                                              id={goal.id}
                                              title={goal.title}
                                              areaColor={areaColor}
                                              indent={0}
                                            />
                                          </div>
                                        </div>
                                        {!goalCollapsed2 &&
                                          goalTasks.map((task) => (
                                            <DraggablePoolChip
                                              key={task.id}
                                              kind="task"
                                              id={task.id}
                                              title={task.title}
                                              areaColor={areaColor}
                                              indent={3}
                                            />
                                          ))}
                                      </div>
                                    )
                                  })}
                              </div>
                            )
                          })}

                          {/* Loose area tasks */}
                          {looseTasks.map((task) => (
                            <DraggablePoolChip
                              key={task.id}
                              kind="task"
                              id={task.id}
                              title={task.title}
                              areaColor={areaColor}
                              indent={1}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </DroppablePoolColumn>

            {/* 7 DAY COLUMNS */}
            {week.map((day, i) => {
              const nextDay = i < week.length - 1 ? week[i + 1].date : null
              const blocks = blocksByDate.get(day.date) ?? []
              return (
                <DroppableDayColumn
                  key={day.date}
                  day={day}
                  blocks={blocks}
                  isLastDay={i === week.length - 1}
                  nextDayDate={nextDay}
                  onRemove={handleRemove}
                  onReschedule={handleReschedule}
                  getBlockAreaColor={getBlockAreaColor}
                />
              )
            })}
          </div>

          {/* DragOverlay: a floating ghost of the dragged item */}
          <DragOverlay>
            {activeItem ? (
              <div
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs max-w-[200px] pointer-events-none shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
                style={{ borderLeftWidth: 4, borderLeftColor: 'var(--color-blue)' }}
              >
                <span className="block font-semibold leading-snug">
                  {activeItem.kind === 'goal' && (
                    <span style={{ marginRight: 4, opacity: 0.7 }}>◎</span>
                  )}
                  {activeItem.title}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </Panel>
  )
}

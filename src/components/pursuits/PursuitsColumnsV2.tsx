'use client'

/**
 * PursuitsColumnsV2 — the Areas › Goals › Tasks board.
 *
 * Built entirely on the @/components/ui primitive system + Tailwind token
 * utilities. Zero .pmc / .v2- / .boa / .cbo scoped CSS classes.
 *
 * Data layer: mirrors PursuitsColumns.tsx exactly — same five tRPC queries,
 * same buildPursuitsIndex, same pursuitsStore, same derivation helpers.
 *
 * Interactions (ported from AreasColumn / GoalsColumn / TasksColumn, kept on
 * the V2 visual base):
 *   • Drag-and-drop reorder of areas / goals / tasks (single DndContext +
 *     usePursuitsDnd; the ROW BODY is the handle, 4px activation so clicks
 *     still select; dependency-guard shake on illegal task drops).
 *   • Inline rename (double-click the row) + inline create (+ area / project /
 *     goal / task), Enter to save, Escape to cancel.
 *   • ★ pin-to-Up-next toggle reading upNext.list (filled amber when queued).
 *   • Goal complete / details (why, finish-criteria, future toggle, deps) /
 *     ⚙ ItemDetailModal / archive (via area + project archive).
 *
 * Colour rule (non-negotiable, red-green safe):
 *   Done   → strikethrough + text-muted-foreground (NOT green)
 *   Overdue / pinned / attention → amber (text-destructive / warning badge)
 *   Progress / selection → bg-primary / ring-primary (blue)
 */

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Star, Folder, Clock, CheckSquare, Square, Settings, X } from 'lucide-react'
import type { GoalNode } from '@/stores/goalStore'
import { usePursuitsStore } from '@/stores/pursuitsStore'
import {
  buildPursuitsIndex,
  usePursuitsDnd,
  type Area,
  type Project,
  type PursuitsIndex,
} from '@/components/tasks/pursuitsShared'
import type { TaskNode, FlatTask } from '@/components/tasks/TaskTreeNode'
import { ItemDetailModal } from '@/components/shared/ItemDetailModal'
import { GoalForm } from '@/components/goals/GoalForm'
import {
  goalProgress,
  countTasks,
  deadlineLabel,
  visibleTasks,
  nextActionOf,
} from '@/lib/pursuitsDerived'
import { Panel } from '@/components/ui/panel'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// ── Synthetic "No area" orphan bucket ────────────────────────────────────────
const ORPHAN_AREA: Area = { id: 'none', name: 'No area', color: null }

// ── Shared inline "+ add" input ───────────────────────────────────────────────
// Enter saves, Escape cancels, blur-out (focus leaving the wrapper) closes.

function InlineAdd({
  placeholder,
  onSubmit,
  onClose,
}: {
  placeholder: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  function submit() {
    const v = value.trim()
    if (v) onSubmit(v)
  }
  return (
    <div
      className="flex items-center gap-1.5 px-1 py-1"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose()
      }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onClose()
        }}
        placeholder={placeholder}
        className="h-7 text-xs"
      />
      <button
        type="button"
        onClick={submit}
        className="shrink-0 rounded-[calc(var(--radius)-4px)] bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
      >
        Add
      </button>
    </div>
  )
}

// ── Hover ghost action button (consistent V2 idiom) ───────────────────────────

function GhostAction({
  children,
  onClick,
  label,
  title,
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  label?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      className="rounded-[calc(var(--radius)-5px)] px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  )
}

// ── ★ pin button — amber when queued (never green/red) ────────────────────────

function PinButton({ pinned, onClick }: { pinned: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={pinned ? 'Remove from Up next' : 'Add to Up next'}
      title={pinned ? 'Remove from Up next' : 'Add to Up next'}
      className={cn(
        'shrink-0 rounded-[calc(var(--radius)-5px)] p-0.5 transition-colors',
        pinned
          ? 'text-[color:var(--destructive)]'
          : 'text-muted-foreground/40 hover:text-[color:var(--destructive)]',
      )}
    >
      <Star className={cn('h-3.5 w-3.5', pinned && 'fill-current')} />
    </button>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function PursuitsColumnsV2() {
  const areasQuery = trpc.area.list.useQuery()
  const projectsQuery = trpc.project.list.useQuery()
  const treeQuery = trpc.task.tree.useQuery()
  const goalsQuery = trpc.goal.tree.useQuery()

  const roots = (treeQuery.data ?? []) as TaskNode[]
  const goals = (goalsQuery.data ?? []) as GoalNode[]
  const realAreas = (areasQuery.data ?? []) as Area[]
  const projects = (projectsQuery.data ?? []) as Project[]

  const index = useMemo(
    () => buildPursuitsIndex(roots, goals, projects),
    [roots, goals, projects],
  )

  // Single DndContext for the whole board — reorders REAL areas only (the
  // synthetic orphan row is never draggable / reordered), goals within their
  // visible sibling bucket, and tasks within their sibling group (with the
  // dependency-guard shake). Reuses the shared hook verbatim.
  const { sensors, handleDragEnd, shakeId, shakeMsg } = usePursuitsDnd(index, realAreas)

  const showArchive = usePursuitsStore((s) => s.showArchive)
  const toggleArchive = usePursuitsStore((s) => s.toggleArchive)
  const selAreaId = usePursuitsStore((s) => s.selAreaId)
  const selGoalId = usePursuitsStore((s) => s.selGoalId)
  const setSelArea = usePursuitsStore((s) => s.setSelArea)
  const setSelGoal = usePursuitsStore((s) => s.setSelGoal)

  if (
    areasQuery.isPending ||
    projectsQuery.isPending ||
    treeQuery.isPending ||
    goalsQuery.isPending
  ) {
    return (
      <p className="p-4 text-sm text-muted-foreground">Loading pursuits…</p>
    )
  }

  const hasOrphans =
    (index.goalsByArea.get('none')?.length ?? 0) > 0 ||
    (index.rootsByOwner.get('none')?.length ?? 0) > 0
  const areas = hasOrphans ? [...realAreas, ORPHAN_AREA] : realAreas

  const selectedArea: Area | null =
    selAreaId == null ? null : (areas.find((a) => a.id === selAreaId) ?? null)

  const selectedGoal: GoalNode | null = selGoalId
    ? (index.goalById.get(selGoalId) ?? null)
    : null

  return (
    <>
      {/* Dependency-guard shake — scoped here (kept off globals.css). */}
      <style>{`
        @keyframes task-shake-kf {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-4px); }
          40%, 80% { transform: translateX(4px); }
        }
        .task-shake { animation: task-shake-kf 0.4s ease-in-out; }
      `}</style>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div
          className={cn(
            'grid gap-4',
            'grid-cols-1 sm:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]',
          )}
        >
          {/* Column 1 — Areas */}
          <AreasPanel
            areas={areas}
            index={index}
            selectedAreaId={selAreaId}
            onSelectArea={setSelArea}
            showArchive={showArchive}
            toggleArchive={toggleArchive}
          />

          {/* Column 2 — Goals */}
          <GoalsPanel
            area={selectedArea}
            index={index}
            projects={projects}
            showArchive={showArchive}
            selectedGoalId={selGoalId}
            onSelectGoal={setSelGoal}
          />

          {/* Column 3 — Tasks */}
          <TasksPanel
            area={selectedArea}
            goal={selectedGoal}
            index={index}
            showArchive={showArchive}
            toggleArchive={toggleArchive}
            shakeId={shakeId}
            shakeMsg={shakeMsg}
          />
        </div>
      </DndContext>
    </>
  )
}

// ── Shared column header ──────────────────────────────────────────────────────

function ColHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        'text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3',
        className,
      )}
    >
      {children}
    </h2>
  )
}

// ── Colour dot ───────────────────────────────────────────────────────────────

function Dot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color ?? 'var(--border)' }}
    />
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ icon, label, hint }: { icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        {icon}
      </span>
      <p className="text-sm font-medium text-foreground">{label}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN 1 — Areas
// ─────────────────────────────────────────────────────────────────────────────

interface AreasPanelProps {
  areas: Area[]
  index: PursuitsIndex
  selectedAreaId: string | null
  onSelectArea: (id: string) => void
  showArchive: boolean
  toggleArchive: () => void
}

function AreasPanel({
  areas,
  index,
  selectedAreaId,
  onSelectArea,
  showArchive,
  toggleArchive,
}: AreasPanelProps) {
  const { rootsByOwner, goalsByArea, goalsByProject, projectsByArea } = index
  const [addingArea, setAddingArea] = useState(false)

  const utils = trpc.useUtils()
  const createArea = trpc.area.create.useMutation({
    onSuccess: () => { setAddingArea(false); void utils.area.list.invalidate() },
  })

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
    <Panel className="flex flex-col gap-1 overflow-y-auto">
      <div className="mb-3 flex items-center justify-between">
        <ColHeader className="mb-0">Areas</ColHeader>
        {!addingArea && (
          <GhostAction onClick={() => setAddingArea(true)} label="Add area">
            + area
          </GhostAction>
        )}
      </div>

      {addingArea && (
        <InlineAdd
          placeholder="New area…"
          onSubmit={(name) => createArea.mutate({ name })}
          onClose={() => setAddingArea(false)}
        />
      )}

      {areas.length === 0 && !addingArea ? (
        <EmptyState
          icon={<Folder className="h-5 w-5" />}
          label="No areas yet"
          hint="Areas help organise goals by life domain."
        />
      ) : (
        <>
          {/* Selectable + draggable area rows */}
          <SortableContext items={areas.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-0.5">
              {areas.map((area) => (
                <AreaRow
                  key={area.id}
                  area={area}
                  tasks={areaTasks(area.id)}
                  selected={selectedAreaId === area.id}
                  onSelect={() => onSelectArea(area.id)}
                />
              ))}
            </div>
          </SortableContext>

          {/* Overview block */}
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Overview
            </p>
            <div className="flex flex-col gap-3">
              {areas.map((area) => {
                const tasks = areaTasks(area.id)
                const { done, total } = countTasks(tasks)
                const open = total - done
                const pct = total ? Math.round((done / total) * 100) : 0

                return (
                  <div key={area.id} className="flex items-center gap-2">
                    <Dot color={area.color} className="shrink-0" />
                    <span className="w-20 shrink-0 truncate text-xs text-foreground">
                      {area.name}
                    </span>
                    <Progress value={pct} className="h-1.5 flex-1" />
                    <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">
                      {open} open
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Archive toggle */}
          <div className="mt-4 border-t border-border pt-3">
            <ArchiveSwitch showArchive={showArchive} toggleArchive={toggleArchive} label="Show archive" />
          </div>
        </>
      )}
    </Panel>
  )
}

// ── A single selectable + draggable area row ──────────────────────────────────

function AreaRow({
  area,
  tasks,
  selected,
  onSelect,
}: {
  area: Area
  tasks: TaskNode[]
  selected: boolean
  onSelect: () => void
}) {
  const { done, total } = useMemo(() => countTasks(tasks), [tasks])
  const open = total - done
  const pct = total ? Math.round((done / total) * 100) : 0
  const isOrphan = area.id === 'none'

  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(area.name)
  const [detailOpen, setDetailOpen] = useState(false)

  const utils = trpc.useUtils()
  const renameMutation = trpc.area.update.useMutation({
    onSuccess: () => { setRenaming(false); void utils.area.list.invalidate() },
  })
  const archiveMutation = trpc.area.archive.useMutation({
    onSettled: () => {
      void utils.area.list.invalidate()
      void utils.goal.tree.invalidate()
      void utils.task.tree.invalidate()
    },
  })

  // Drag-to-reorder among areas — the whole row is the handle (4px activation
  // distance, set in usePursuitsDnd, means a plain click still selects).
  // The synthetic orphan row is never draggable.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: area.id, disabled: isOrphan })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="group">
      <div
        {...(isOrphan ? {} : attributes)}
        {...(isOrphan ? {} : listeners)}
        onClick={onSelect}
        onDoubleClick={() => !isOrphan && setRenaming(true)}
        role="button"
        tabIndex={0}
        className={cn(
          'flex w-full cursor-pointer items-start gap-2.5 rounded-[calc(var(--radius)-4px)] px-2.5 py-2',
          'text-left transition-colors',
          selected
            ? 'border border-[color:var(--color-blue)]/40 bg-[color:var(--color-blue)]/10'
            : 'border border-transparent hover:bg-surface-2',
        )}
      >
        <Dot color={area.color} className="mt-0.5" />
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) renameMutation.mutate({ id: area.id, name: name.trim() })
              if (e.key === 'Escape') { setRenaming(false); setName(area.name) }
            }}
            onBlur={() => { setRenaming(false); setName(area.name) }}
            className="h-7 flex-1 text-sm"
          />
        ) : (
          <span className="min-w-0 flex-1">
            <span className={cn(
              'block truncate text-sm font-medium',
              selected ? 'text-[color:var(--color-blue)]' : 'text-foreground',
            )}>
              {area.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {open} open · {pct}%
            </span>
          </span>
        )}
      </div>

      {/* Hover meta-actions (rename / settings / archive). Add-item controls
          moved to the GoalsPanel and TasksPanel header bars. */}
      {!isOrphan && (
        <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-150 group-hover:grid-rows-[1fr] focus-within:grid-rows-[1fr]">
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-0.5 px-2 pb-1 pt-0.5">
              <GhostAction onClick={(e) => { e.stopPropagation(); setRenaming(true) }} label="Rename area">✎</GhostAction>
              <GhostAction onClick={(e) => { e.stopPropagation(); setDetailOpen((v) => !v) }} label="Edit all details" title="Edit all details">
                <Settings className="h-3 w-3" />
              </GhostAction>
              <GhostAction
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Archive area "${area.name}"? Its goals stay, but lose their area.`)) {
                    archiveMutation.mutate({ id: area.id })
                  }
                }}
                label="Archive area"
              >
                🗑
              </GhostAction>
            </div>
          </div>
        </div>
      )}

      {detailOpen && (
        <ItemDetailModal kind="area" id={area.id} onClose={() => setDetailOpen(false)} />
      )}
    </div>
  )
}

// ── Archive switch (reused in Areas footer + Tasks header) ────────────────────

function ArchiveSwitch({
  showArchive,
  toggleArchive,
  label,
}: {
  showArchive: boolean
  toggleArchive: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={toggleArchive}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-[calc(var(--radius)-4px)] px-2 py-1.5 text-xs transition-colors',
        'hover:bg-secondary',
        showArchive ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'inline-flex h-4 w-7 items-center rounded-full transition-colors',
          showArchive ? 'bg-primary' : 'bg-secondary',
        )}
      >
        <span
          className={cn(
            'h-3 w-3 rounded-full bg-background shadow transition-transform',
            showArchive ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN 2 — Goals
// ─────────────────────────────────────────────────────────────────────────────

interface GoalsPanelProps {
  area: Area | null
  index: PursuitsIndex
  projects: Project[]
  showArchive: boolean
  selectedGoalId: string | null
  onSelectGoal: (id: string) => void
}

function GoalsPanel({
  area,
  index,
  projects,
  showArchive,
  selectedGoalId,
  onSelectGoal,
}: GoalsPanelProps) {
  const { rootsByOwner, goalsByArea, goalsByProject, projectsByArea } = index
  const [addingGoal, setAddingGoal] = useState(false)
  const [addingProject, setAddingProject] = useState(false)

  const utils = trpc.useUtils()
  const createProject = trpc.project.create.useMutation({
    onSuccess: () => { setAddingProject(false); void utils.project.list.invalidate() },
  })

  if (!area) {
    return (
      <Panel>
        <ColHeader>Goals</ColHeader>
        <EmptyState
          icon={<CheckSquare className="h-5 w-5" />}
          label="Select an area"
          hint="Click an area on the left to see its goals."
        />
      </Panel>
    )
  }

  const areaProjects = projectsByArea.get(area.id) ?? projects.filter((p) => p.areaId === area.id)
  const areaGoals = goalsByArea.get(area.id) ?? []
  const activeGoals = areaGoals.filter((g) => g.status !== 'planning' && g.status !== 'completed')
  const futureGoals = areaGoals.filter((g) => g.status === 'planning')
  const doneGoals = showArchive ? areaGoals.filter((g) => g.status === 'completed') : []

  const hasAnything =
    areaProjects.length > 0 ||
    activeGoals.length > 0 ||
    futureGoals.length > 0 ||
    doneGoals.length > 0

  return (
    <Panel className="overflow-y-auto">
      {/* Column header with area colour dot + add controls */}
      <div className="mb-3 flex items-center gap-2">
        <Dot color={area.color} />
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {area.name} · Goals
        </h2>
        <GhostAction onClick={() => setAddingProject(true)} label="Add project">+ project</GhostAction>
        <GhostAction onClick={() => setAddingGoal(true)} label="Add goal">+ goal</GhostAction>
      </div>

      {addingProject && (
        <InlineAdd
          placeholder="New project…"
          onSubmit={(name) => createProject.mutate({ name, areaId: area.id })}
          onClose={() => setAddingProject(false)}
        />
      )}

      {addingGoal && (
        <div className="mb-2 px-1">
          <GoalForm
            defaultAreaId={area.id}
            onSuccess={() => setAddingGoal(false)}
            onCancel={() => setAddingGoal(false)}
          />
        </div>
      )}

      {!hasAnything && !addingGoal && (
        <EmptyState
          icon={<CheckSquare className="h-5 w-5" />}
          label="No goals in this area yet"
          hint="Goals help track progress toward outcomes."
        />
      )}

      {/* Project groups */}
      {areaProjects.map((project) => (
        <ProjectSection
          key={project.id}
          project={project}
          goals={goalsByProject.get(project.id) ?? []}
          rootsByOwner={rootsByOwner}
          selectedGoalId={selectedGoalId}
          onSelectGoal={onSelectGoal}
          showArchive={showArchive}
        />
      ))}

      {/* Active goals */}
      {activeGoals.length > 0 && (
        <GoalSection
          label="Goals"
          goals={activeGoals}
          rootsByOwner={rootsByOwner}
          selectedGoalId={selectedGoalId}
          onSelectGoal={onSelectGoal}
        />
      )}

      {/* Future goals */}
      {futureGoals.length > 0 && (
        <GoalSection
          label="Future goals"
          goals={futureGoals}
          rootsByOwner={rootsByOwner}
          selectedGoalId={selectedGoalId}
          onSelectGoal={onSelectGoal}
        />
      )}

      {/* Archived goals — only if showArchive */}
      {doneGoals.length > 0 && (
        <GoalSection
          label="Archived goals"
          goals={doneGoals}
          rootsByOwner={rootsByOwner}
          selectedGoalId={selectedGoalId}
          onSelectGoal={onSelectGoal}
        />
      )}
    </Panel>
  )
}

function GoalSection({
  label,
  goals,
  rootsByOwner,
  selectedGoalId,
  onSelectGoal,
}: {
  label: string
  goals: GoalNode[]
  rootsByOwner: Map<string, TaskNode[]>
  selectedGoalId: string | null
  onSelectGoal: (id: string) => void
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <SortableContext items={goals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1.5">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              tasks={rootsByOwner.get(g.id) ?? []}
              selected={selectedGoalId === g.id}
              onSelect={() => onSelectGoal(g.id)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

function ProjectSection({
  project,
  goals,
  rootsByOwner,
  selectedGoalId,
  onSelectGoal,
  showArchive,
}: {
  project: Project
  goals: GoalNode[]
  rootsByOwner: Map<string, TaskNode[]>
  selectedGoalId: string | null
  onSelectGoal: (id: string) => void
  showArchive: boolean
}) {
  const visibleGoals = showArchive
    ? goals
    : goals.filter((g) => g.status !== 'completed')

  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  const [addingGoal, setAddingGoal] = useState(false)

  const utils = trpc.useUtils()
  const renameMutation = trpc.project.update.useMutation({
    onSuccess: () => { setRenaming(false); void utils.project.list.invalidate() },
  })
  const archiveMutation = trpc.project.archive.useMutation({
    onSettled: () => { void utils.project.list.invalidate(); void utils.goal.tree.invalidate() },
  })

  return (
    <div className="group mb-4">
      {/* Project label — purple with a hairline rule, distinct from goal sections */}
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold tracking-wide"
           style={{ color: 'var(--color-purple)' }}>
        <Folder className="h-3.5 w-3.5 shrink-0" />
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) renameMutation.mutate({ id: project.id, name: name.trim() })
              if (e.key === 'Escape') { setRenaming(false); setName(project.name) }
            }}
            onBlur={() => { setRenaming(false); setName(project.name) }}
            className="h-6 flex-1 text-xs"
          />
        ) : (
          <span
            className="flex-1 truncate"
            onDoubleClick={() => setRenaming(true)}
          >
            {project.name}
          </span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <GhostAction onClick={() => setAddingGoal(true)}>+ goal</GhostAction>
          <GhostAction onClick={() => setRenaming(true)} label="Rename project">✎</GhostAction>
          <GhostAction
            onClick={() => {
              if (confirm(`Archive project "${project.name}"? Its goals stay, but lose their project.`)) {
                archiveMutation.mutate({ id: project.id })
              }
            }}
            label="Archive project"
          >
            🗑
          </GhostAction>
        </div>
      </div>
      {/* Purple hairline under project label */}
      <div className="mb-2 h-px" style={{ background: 'var(--color-purple)', opacity: 0.2 }} />

      {addingGoal && (
        <div className="px-1 pb-1">
          <GoalForm
            defaultAreaId={project.areaId}
            defaultProjectId={project.id}
            onSuccess={() => setAddingGoal(false)}
            onCancel={() => setAddingGoal(false)}
          />
        </div>
      )}

      {visibleGoals.length === 0 && !addingGoal ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          No goals in this project.
        </p>
      ) : (
        <SortableContext items={visibleGoals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {visibleGoals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                tasks={rootsByOwner.get(g.id) ?? []}
                selected={selectedGoalId === g.id}
                onSelect={() => onSelectGoal(g.id)}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </div>
  )
}

function GoalCard({
  goal,
  tasks,
  selected,
  onSelect,
}: {
  goal: GoalNode
  tasks: TaskNode[]
  selected: boolean
  onSelect: () => void
}) {
  const isDone = goal.status === 'completed'
  const isFuture = goal.status === 'planning'
  const pct = goalProgress(tasks)
  const { done, total } = countTasks(tasks)
  const dl = deadlineLabel(goal.deadline)

  const [detailOpen, setDetailOpen] = useState(false)

  const utils = trpc.useUtils()
  const completeMutation = trpc.goal.complete.useMutation({ onSettled: () => void utils.goal.tree.invalidate() })
  const uncompleteMutation = trpc.goal.uncomplete.useMutation({ onSettled: () => void utils.goal.tree.invalidate() })

  // ★ pin — reads upNext.list, matches by goalId, toggles add/remove.
  const upNextQuery = trpc.upNext.list.useQuery()
  const isPinned = (upNextQuery.data ?? []).some((u) => u.goalId === goal.id)
  const upNextAdd = trpc.upNext.add.useMutation({ onSettled: () => void utils.upNext.list.invalidate() })
  const upNextRemove = trpc.upNext.remove.useMutation({ onSettled: () => void utils.upNext.list.invalidate() })

  // Drag-to-reorder among sibling goals — the whole card is the handle.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: goal.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="group">
      <div
        {...attributes}
        {...listeners}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        style={{
          boxShadow: selected ? 'var(--shadow-pop)' : 'var(--shadow-card)',
          borderLeftColor: isDone
            ? 'var(--color-line-strong)'
            : isFuture
              ? 'var(--color-purple)'
              : 'var(--color-blue)',
        }}
        className={cn(
          'w-full cursor-pointer rounded-[calc(var(--radius)-2px)] border border-border border-l-4 bg-card p-3 text-left',
          'transition-[background-color,border-color,box-shadow,transform] duration-150',
          selected
            ? 'border-[color:var(--color-blue)] bg-[color:var(--color-blue)]/10'
            : 'hover:border-[color:var(--color-blue)] hover:-translate-y-px hover:[box-shadow:var(--shadow-pop)]',
          isDone && 'opacity-60',
        )}
      >
        {/* Title row */}
        <div className="mb-2 flex items-start gap-2">
          {/* Complete checkbox (amber/blue, never green) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (isDone) uncompleteMutation.mutate({ id: goal.id })
              else completeMutation.mutate({ id: goal.id })
            }}
            className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-primary"
            aria-label={isDone ? `Mark goal not done: ${goal.title}` : `Complete goal: ${goal.title}`}
          >
            {isDone ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
          </button>

          <span
            className={cn(
              'flex-1 text-sm font-medium leading-snug text-foreground',
              isDone && 'line-through text-muted-foreground',
            )}
          >
            {goal.title}
          </span>

          <div className="flex shrink-0 items-center gap-1.5">
            {isFuture && <Badge variant="secondary">future</Badge>}
            {isDone && <Badge variant="outline">archived</Badge>}
            {goal.isBlocked && <Badge variant="warning">blocked</Badge>}

            {/* Deadline */}
            {dl && (
              <span
                className={cn(
                  'flex items-center gap-0.5 text-[11px]',
                  dl.overdue ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                <Clock className="h-3 w-3 shrink-0" />
                {dl.txt}
              </span>
            )}

            {/* ⚙ details modal */}
            <GhostAction
              onClick={(e) => { e.stopPropagation(); setDetailOpen((v) => !v) }}
              label="Edit all details"
              title="Edit all details"
            >
              <Settings className="h-3 w-3" />
            </GhostAction>

            {/* ★ pin — only on non-done goals */}
            {!isDone && (
              <PinButton
                pinned={isPinned}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isPinned) upNextRemove.mutate({ kind: 'goal', id: goal.id })
                  else upNextAdd.mutate({ kind: 'goal', id: goal.id })
                }}
              />
            )}
          </div>
        </div>

        {/* Progress bar + count */}
        <div className="flex items-center gap-2">
          <Progress value={pct} className="h-1 flex-1" />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {done}/{total}
          </span>
        </div>
      </div>

      {detailOpen && (
        <ItemDetailModal kind="goal" id={goal.id} onClose={() => setDetailOpen(false)} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN 3 — Tasks
// ─────────────────────────────────────────────────────────────────────────────

interface TasksPanelProps {
  area: Area | null
  goal: GoalNode | null
  index: PursuitsIndex
  showArchive: boolean
  toggleArchive: () => void
  shakeId: string | null
  shakeMsg: string | null
}

function TasksPanel({ area, goal, index, showArchive, toggleArchive, shakeId, shakeMsg }: TasksPanelProps) {
  const { rootsByOwner, allTasks } = index
  const [addingTask, setAddingTask] = useState(false)

  const utils = trpc.useUtils()
  const createTaskMutation = trpc.task.create.useMutation({
    onSuccess: () => { setAddingTask(false); void utils.task.tree.invalidate() },
  })

  if (!area && !goal) {
    return (
      <Panel>
        <ColHeader>Tasks</ColHeader>
        <EmptyState
          icon={<CheckSquare className="h-5 w-5" />}
          label="Pick a goal"
          hint="Select a goal in the middle column to see its tasks."
        />
      </Panel>
    )
  }

  const rawTasks: TaskNode[] = goal
    ? (rootsByOwner.get(goal.id) ?? [])
    : area
      ? (rootsByOwner.get(area.id) ?? [])
      : []

  const shown = visibleTasks(rawTasks, showArchive)
  const { done: doneCount } = countTasks(rawTasks)

  // id of the first not-done task → "▶ next" badge
  const nextId = nextActionOf(shown)?.id ?? null

  // Breadcrumb
  const crumb = goal
    ? [area?.name, goal.title].filter(Boolean).join(' › ')
    : area
      ? `${area.name} › loose tasks`
      : ''

  return (
    <Panel className="flex flex-col overflow-y-auto">
      {/* Breadcrumb */}
      {crumb && (
        <p className="mb-1 text-[11px] text-muted-foreground">{crumb}</p>
      )}

      {/* Goal head */}
      {goal ? (
        <GoalHead
          goal={goal}
          showArchive={showArchive}
          toggleArchive={toggleArchive}
          doneCount={doneCount}
          onAddTask={() => setAddingTask(true)}
        />
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <h3 className="flex-1 text-base font-semibold text-foreground">
            {area ? 'Loose tasks' : 'No goal'}
          </h3>
          <GhostAction onClick={() => setAddingTask(true)} label="Add task">+ task</GhostAction>
          <ArchiveSwitch
            showArchive={showArchive}
            toggleArchive={toggleArchive}
            label={`Archive (${doneCount})`}
          />
        </div>
      )}

      {/* Divider */}
      <div className="mb-3 border-t border-border" />

      {/* Inline add-task form — shown when triggered from the header */}
      {addingTask && (
        <div className="mb-2">
          <InlineAdd
            placeholder="New task…"
            onSubmit={(title) =>
              createTaskMutation.mutate({
                title,
                goalId: goal?.id ?? undefined,
                areaId: goal ? undefined : area?.id ?? undefined,
              })
            }
            onClose={() => setAddingTask(false)}
          />
        </div>
      )}

      {/* Task list */}
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {showArchive
            ? 'No tasks here.'
            : 'Nothing open here — toggle the archive to see finished tasks.'}
        </p>
      ) : (
        <SortableContext items={shown.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-0.5">
            {shown.map((task) => (
              <TaskRowV2
                key={task.id}
                task={task}
                isNext={task.id === nextId && task.status !== 'done'}
                depth={0}
                showArchive={showArchive}
                goalNextId={nextId}
                allTasks={allTasks}
                shakeId={shakeId}
                shakeMsg={shakeMsg}
              />
            ))}
          </div>
        </SortableContext>
      )}

      {/* Archive hint */}
      {!showArchive && doneCount > 0 && (
        <p className="mt-3 border-t border-border pt-3 text-center text-xs text-muted-foreground">
          {doneCount} finished task{doneCount > 1 ? 's' : ''} in the archive
        </p>
      )}
    </Panel>
  )
}

function GoalHead({
  goal,
  showArchive,
  toggleArchive,
  doneCount,
  onAddTask,
}: {
  goal: GoalNode
  showArchive: boolean
  toggleArchive: () => void
  doneCount: number
  onAddTask: () => void
}) {
  const isFuture = goal.status === 'planning'
  const dl = deadlineLabel(goal.deadline)

  const [showDetails, setShowDetails] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [why, setWhy] = useState(goal.description ?? '')
  const [criteria, setCriteria] = useState(goal.finishCriteria ?? '')
  const [depError, setDepError] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const updateMutation = trpc.goal.update.useMutation({ onSettled: () => void utils.goal.tree.invalidate() })
  const addDepMutation = trpc.goal.addDependency.useMutation({
    onSuccess: () => { setDepError(null); void utils.goal.tree.invalidate() },
    onError: (err) => setDepError(err.message),
  })
  const removeDepMutation = trpc.goal.removeDependency.useMutation({
    onSettled: () => void utils.goal.tree.invalidate(),
  })

  const goalListQuery = trpc.goal.list.useQuery(undefined, { enabled: showDetails })
  const allGoals = goalListQuery.data ?? []
  const depCandidates = allGoals.filter((g) => g.id !== goal.id && !(goal.dependsOn ?? []).includes(g.id))
  const titleOfGoal = (id: string) => allGoals.find((g) => g.id === id)?.title ?? id

  function saveWhy() {
    const trimmed = why.trim()
    if ((trimmed || null) !== (goal.description ?? null)) {
      updateMutation.mutate({ id: goal.id, description: trimmed || null })
    }
  }
  function saveCriteria() {
    const trimmed = criteria.trim()
    if ((trimmed || null) !== (goal.finishCriteria ?? null)) {
      updateMutation.mutate({ id: goal.id, finishCriteria: trimmed || null })
    }
  }

  return (
    <div className="mb-1">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug text-foreground">{goal.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isFuture && <Badge variant="secondary">future</Badge>}
            {dl && (
              <span
                className={cn(
                  'flex items-center gap-0.5 text-xs',
                  dl.overdue ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                <Clock className="h-3 w-3 shrink-0" />
                {dl.txt}
              </span>
            )}
            <GhostAction onClick={() => setShowDetails((v) => !v)}>details</GhostAction>
            <GhostAction onClick={() => setDetailOpen((v) => !v)} label="Edit all details" title="Edit all details">
              <Settings className="h-3 w-3" />
            </GhostAction>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <GhostAction onClick={onAddTask} label="Add task">+ task</GhostAction>
          <ArchiveSwitch
            showArchive={showArchive}
            toggleArchive={toggleArchive}
            label={`Archive (${doneCount})`}
          />
        </div>
      </div>

      {detailOpen && (
        <ItemDetailModal kind="goal" id={goal.id} onClose={() => setDetailOpen(false)} />
      )}

      {showDetails && (
        <div className="mt-2 flex flex-col gap-2">
          {/* Why / motivation (saves on blur). */}
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onBlur={saveWhy}
            placeholder="Why this matters…"
            rows={2}
            className="resize-none rounded-[calc(var(--radius)-3px)] border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />

          {/* Finish criteria (saves on blur). */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Finish criteria</span>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              onBlur={saveCriteria}
              placeholder="Done when…"
              rows={2}
              className="resize-none rounded-[calc(var(--radius)-3px)] border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
          </div>

          {/* Metric / deadline read-only context. */}
          {(goal.targetMetric || goal.targetValue != null || goal.deadline) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {(goal.targetMetric || goal.targetValue != null) && (
                <span>
                  Metric: {goal.targetMetric ?? '—'}
                  {goal.targetValue != null ? ` (target ${goal.targetValue})` : ''}
                </span>
              )}
              {goal.deadline && <span>Deadline: {new Date(goal.deadline).toLocaleDateString()}</span>}
            </div>
          )}

          {/* Future-goal toggle. */}
          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={isFuture}
              onChange={(e) => updateMutation.mutate({ id: goal.id, status: e.target.checked ? 'planning' : 'active' })}
              className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--primary)]"
            />
            Future goal (not started yet)
          </label>

          {/* Dependencies. */}
          <div className="flex flex-col gap-1">
            {(goal.dependsOn ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(goal.dependsOn ?? []).map((pid) => (
                  <span key={pid} className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                    blocked by: {titleOfGoal(pid)}
                    <button
                      type="button"
                      onClick={() => removeDepMutation.mutate({ dependentId: goal.id, prerequisiteId: pid })}
                      className="hover:text-foreground"
                      aria-label="Remove dependency"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {depCandidates.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addDepMutation.mutate({ dependentId: goal.id, prerequisiteId: e.target.value })
                }}
                className="w-fit rounded-[calc(var(--radius)-3px)] border border-input bg-background px-2 py-1 text-xs text-muted-foreground focus:border-ring focus:outline-none"
              >
                <option value="">+ blocked by another goal…</option>
                {depCandidates.map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            )}
            {depError && <p className="text-xs text-destructive">{depError}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Task row (recursive for subtasks) — V2 visuals + full interactions.
// ─────────────────────────────────────────────────────────────────────────────

function TaskRowV2({
  task,
  isNext,
  depth,
  showArchive,
  goalNextId,
  allTasks,
  shakeId,
  shakeMsg,
}: {
  task: TaskNode
  isNext: boolean
  depth: number
  showArchive: boolean
  goalNextId: string | null
  allTasks: FlatTask[]
  shakeId: string | null
  shakeMsg: string | null
}) {
  const isDone = task.status === 'done'

  const [showDetails, setShowDetails] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [criteria, setCriteria] = useState(task.finishCriteria ?? '')
  const [depError, setDepError] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const invalidate = () => {
    void utils.task.tree.invalidate()
    void utils.task.todayList.invalidate()
  }
  const completeMutation = trpc.task.complete.useMutation({ onSettled: invalidate })
  const uncompleteMutation = trpc.task.uncomplete.useMutation({ onSettled: invalidate })
  const createMutation = trpc.task.create.useMutation({
    onSuccess: () => { setAdding(false); invalidate() },
  })
  const updateMutation = trpc.task.update.useMutation({ onSettled: invalidate })
  const addDepMutation = trpc.task.addDependency.useMutation({
    onSuccess: () => { setDepError(null); invalidate() },
    onError: (err) => setDepError(err.message),
  })
  const removeDepMutation = trpc.task.removeDependency.useMutation({ onSettled: invalidate })

  // ★ pin — reads upNext.list, matches by taskId.
  const upNextQuery = trpc.upNext.list.useQuery()
  const isPinned = (upNextQuery.data ?? []).some((u) => u.taskId === task.id)
  const upNextAdd = trpc.upNext.add.useMutation({ onSettled: () => void utils.upNext.list.invalidate() })
  const upNextRemove = trpc.upNext.remove.useMutation({ onSettled: () => void utils.upNext.list.invalidate() })

  const dl = deadlineLabel(task.deadline ?? null)
  const visibleChildren = visibleTasks(task.children, showArchive)
  const indentPx = depth * 20

  // Drag-to-reorder among siblings — the whole row is the handle.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }
  const isShaking = shakeId === task.id

  const candidates = allTasks.filter((t) => t.id !== task.id && !task.dependsOn.includes(t.id))
  const titleOf = (id: string) => allTasks.find((t) => t.id === id)?.title ?? id

  function saveNotes() {
    const trimmed = notes.trim()
    if ((trimmed || null) !== (task.notes ?? null)) {
      updateMutation.mutate({ id: task.id, notes: trimmed || null })
    }
  }
  function saveCriteria() {
    const trimmed = criteria.trim()
    if ((trimmed || null) !== (task.finishCriteria ?? null)) {
      updateMutation.mutate({ id: task.id, finishCriteria: trimmed || null })
    }
  }

  return (
    <div ref={setNodeRef} style={{ ...style, paddingLeft: indentPx }} className={isShaking ? 'task-shake' : undefined}>
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'group flex items-start gap-2 rounded-[calc(var(--radius)-4px)] px-2.5 py-1.5 transition-colors',
          'cursor-grab active:cursor-grabbing hover:bg-secondary',
          isDone && 'opacity-60',
        )}
      >
        {/* Checkbox — complete / uncomplete */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (isDone) uncompleteMutation.mutate({ id: task.id })
            else completeMutation.mutate({ id: task.id })
          }}
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-primary"
          aria-label={isDone ? `Mark incomplete: ${task.title}` : `Complete: ${task.title}`}
        >
          {isDone ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
        </button>

        {/* Title */}
        <span
          className={cn(
            'flex-1 text-sm leading-snug text-foreground',
            isDone && 'line-through text-muted-foreground',
          )}
        >
          {task.title}
        </span>

        {/* Chips + actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {isNext && (
            <Badge variant="default" className="text-[10px]">
              ▶ next
            </Badge>
          )}

          {task.priority != null && task.priority <= 2 && (
            <Badge variant="warning" className="text-[10px]">
              P{task.priority}
            </Badge>
          )}

          {task.isBlocked && !isDone && (
            <Badge variant="warning" className="text-[10px]">blocked</Badge>
          )}

          {dl && (
            <span
              className={cn(
                'flex items-center gap-0.5 text-[10px]',
                dl.overdue ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <Clock className="h-2.5 w-2.5 shrink-0" />
              {dl.txt}
            </span>
          )}

          {/* Hover actions */}
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <GhostAction onClick={(e) => { e.stopPropagation(); setShowDetails((v) => !v) }}>details</GhostAction>
            <GhostAction onClick={(e) => { e.stopPropagation(); setDetailOpen((v) => !v) }} label="Edit all details" title="Edit all details">
              <Settings className="h-3 w-3" />
            </GhostAction>
            <GhostAction onClick={(e) => { e.stopPropagation(); setAdding(true) }}>+ subtask</GhostAction>
          </span>

          {/* ★ pin */}
          {!isDone && (
            <PinButton
              pinned={isPinned}
              onClick={(e) => {
                e.stopPropagation()
                if (isPinned) upNextRemove.mutate({ kind: 'task', id: task.id })
                else upNextAdd.mutate({ kind: 'task', id: task.id })
              }}
            />
          )}
        </div>
      </div>

      {/* Dependency-guard shake message */}
      {isShaking && shakeMsg && (
        <p className="px-2.5 text-xs text-destructive">{shakeMsg}</p>
      )}

      {/* Detail panel — notes / criteria / dependencies */}
      {showDetails && (
        <div className="mb-1 mt-1 flex flex-col gap-2 px-2.5">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Context notes…"
            rows={2}
            className="resize-none rounded-[calc(var(--radius)-3px)] border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Finish criteria</span>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              onBlur={saveCriteria}
              placeholder="Done when…"
              rows={2}
              className="resize-none rounded-[calc(var(--radius)-3px)] border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            {task.dependsOn.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {task.dependsOn.map((pid) => (
                  <span key={pid} className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                    depends on: {titleOf(pid)}
                    <button
                      type="button"
                      onClick={() => removeDepMutation.mutate({ dependentId: task.id, prerequisiteId: pid })}
                      className="hover:text-foreground"
                      aria-label="Remove dependency"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {candidates.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addDepMutation.mutate({ dependentId: task.id, prerequisiteId: e.target.value })
                }}
                className="w-fit rounded-[calc(var(--radius)-3px)] border border-input bg-background px-2 py-1 text-xs text-muted-foreground focus:border-ring focus:outline-none"
              >
                <option value="">+ add dependency…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            )}
            {depError && <p className="text-xs text-destructive">{depError}</p>}
          </div>
        </div>
      )}

      {/* Inline add-subtask */}
      {adding && (
        <div className="px-2.5">
          <InlineAdd
            placeholder="New subtask…"
            onSubmit={(title) => createMutation.mutate({ title, parentTaskId: task.id, goalId: task.goalId })}
            onClose={() => setAdding(false)}
          />
        </div>
      )}

      {detailOpen && (
        <div className="px-2.5">
          <ItemDetailModal kind="task" id={task.id} onClose={() => setDetailOpen(false)} />
        </div>
      )}

      {/* Subtasks (recursive, own sortable group) */}
      {visibleChildren.length > 0 && (
        <div className="mt-0.5">
          <SortableContext items={visibleChildren.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {visibleChildren.map((child) => (
              <TaskRowV2
                key={child.id}
                task={child}
                isNext={child.id === goalNextId && child.status !== 'done'}
                depth={depth + 1}
                showArchive={showArchive}
                goalNextId={goalNextId}
                allTasks={allTasks}
                shakeId={shakeId}
                shakeMsg={shakeMsg}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  )
}

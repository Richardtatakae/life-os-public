import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'
import type { Prisma, Task, TaskDependency } from '@prisma/client'

// ── Enums (match Prisma schema) ────────────────────────────────────────────
const TaskStatusEnum = z.enum(['inbox', 'todo', 'scheduled', 'in_progress', 'blocked', 'done', 'deferred'])
const EnergyEnum = z.enum(['high', 'medium', 'low'])

// ── Status machine: permissive in v1 ─────────────────────────────────────
// Any status → any status is allowed. Guards can be added in v2 once
// real usage reveals the desired constraints. Documented in decisions.md.

// ── Task tree node (v2 §2.4) ─────────────────────────────────────────────
// A task plus its nested subtasks and dependency edges, ready for the UI.
export interface TaskTreeNode {
  id: string
  title: string
  status: string
  goalId: string | null
  areaId: string | null
  parentTaskId: string | null
  position: number
  priority: number | null
  energy: string | null
  estimateMin: number | null
  deadline: Date | null
  notes: string | null
  finishCriteria: string | null
  createdAt: Date
  completedAt: Date | null
  /** Ids of tasks this one depends on (its prerequisites). */
  dependsOn: string[]
  /** Ids of tasks that depend on this one. */
  blocks: string[]
  /** True when at least one prerequisite is not yet done. */
  isBlocked: boolean
  children: TaskTreeNode[]
}

// Sort a sibling group for display: undone first (by position asc, then
// createdAt asc → oldest→newest), done last (also by position). Done items
// sink regardless of their position number.
function compareSiblings(a: TaskTreeNode, b: TaskTreeNode): number {
  const aDone = a.status === 'done' ? 1 : 0
  const bDone = b.status === 'done' ? 1 : 0
  if (aDone !== bDone) return aDone - bDone
  if (a.position !== b.position) return a.position - b.position
  return a.createdAt.getTime() - b.createdAt.getTime()
}

function buildTaskTree(tasks: Task[], deps: TaskDependency[]): TaskTreeNode[] {
  const doneById = new Map(tasks.map((t) => [t.id, t.status === 'done']))

  // prerequisites[dependentId] = [prerequisiteId, …]
  const prereqsOf = new Map<string, string[]>()
  const blocksOf = new Map<string, string[]>()
  for (const d of deps) {
    if (!prereqsOf.has(d.dependentId)) prereqsOf.set(d.dependentId, [])
    prereqsOf.get(d.dependentId)!.push(d.prerequisiteId)
    if (!blocksOf.has(d.prerequisiteId)) blocksOf.set(d.prerequisiteId, [])
    blocksOf.get(d.prerequisiteId)!.push(d.dependentId)
  }

  const map = new Map<string, TaskTreeNode>()
  for (const t of tasks) {
    const dependsOn = prereqsOf.get(t.id) ?? []
    map.set(t.id, {
      id: t.id,
      title: t.title,
      status: t.status,
      goalId: t.goalId,
      areaId: t.areaId,
      parentTaskId: t.parentTaskId,
      position: t.position,
      priority: t.priority,
      energy: t.energy,
      estimateMin: t.estimateMin,
      deadline: t.deadline,
      notes: t.notes,
      finishCriteria: t.finishCriteria,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      dependsOn,
      blocks: blocksOf.get(t.id) ?? [],
      isBlocked: dependsOn.some((pid) => doneById.get(pid) === false),
      children: [],
    })
  }

  const roots: TaskTreeNode[] = []
  for (const t of tasks) {
    const node = map.get(t.id)!
    if (t.parentTaskId == null) {
      roots.push(node)
    } else {
      const parent = map.get(t.parentTaskId)
      if (parent) parent.children.push(node)
      else roots.push(node) // orphaned (parent deleted) — treat as root
    }
  }

  // Sort every sibling group recursively.
  const sortRec = (nodes: TaskTreeNode[]) => {
    nodes.sort(compareSiblings)
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)
  return roots
}

// Cycle check for "dependentId depends on prerequisiteId": adding this edge
// creates a loop iff prerequisiteId already reaches dependentId by following
// prerequisite edges. Walk the prereq graph from prerequisiteId; if we hit
// dependentId, reject.
async function wouldCreateCycle(dependentId: string, prerequisiteId: string): Promise<boolean> {
  if (dependentId === prerequisiteId) return true
  const visited = new Set<string>()
  let frontier = [prerequisiteId]
  while (frontier.length > 0) {
    const edges = await prisma.taskDependency.findMany({
      where: { dependentId: { in: frontier } },
      select: { prerequisiteId: true },
    })
    const next: string[] = []
    for (const e of edges) {
      if (e.prerequisiteId === dependentId) return true
      if (!visited.has(e.prerequisiteId)) {
        visited.add(e.prerequisiteId)
        next.push(e.prerequisiteId)
      }
    }
    frontier = next
  }
  return false
}

// Walk UP the parent chain from `newParentId`. If we reach `taskId`, then making
// `newParentId` this task's parent would create a loop (a task can't end up as a
// descendant of itself). Used to guard parent-task reassignment.
async function wouldCreateParentCycle(taskId: string, newParentId: string): Promise<boolean> {
  let cursor: string | null = newParentId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === taskId) return true
    if (seen.has(cursor)) break // safety: bail if the data already has a loop
    seen.add(cursor)
    const parent: { parentTaskId: string | null } | null = await prisma.task.findUnique({
      where: { id: cursor },
      select: { parentTaskId: true },
    })
    cursor = parent?.parentTaskId ?? null
  }
  return false
}

export const taskRouter = router({
  // ── Queries ──────────────────────────────────────────────────────────────

  list: publicProcedure
    .input(z.object({
      status: TaskStatusEnum.optional(),
      goalId: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      return prisma.task.findMany({
        where: {
          ...(input?.status ? { status: input.status } : {}),
          ...(input?.goalId ? { goalId: input.goalId } : {}),
        },
        orderBy: [
          { priority: 'asc' },
          { createdAt: 'desc' },
        ],
        take: input?.limit ?? 200,
      })
    }),

  // Nested task forest grouped by parent, modeled on goal.tree. Returns root
  // tasks (parentTaskId == null), each with nested children + dependency info.
  // The UI groups roots by goalId to render them under their goal.
  tree: publicProcedure
    .input(z.object({ goalId: z.string().optional() }).optional())
    .query(async ({ input }): Promise<TaskTreeNode[]> => {
      const [tasks, deps] = await Promise.all([
        prisma.task.findMany({
          where: input?.goalId ? { goalId: input.goalId } : undefined,
        }),
        prisma.taskDependency.findMany(),
      ])
      return buildTaskTree(tasks, deps)
    }),

  byStatus: publicProcedure
    .input(z.object({ statuses: z.array(TaskStatusEnum).min(1) }))
    .query(async ({ input }) => {
      return prisma.task.findMany({
        where: { status: { in: input.statuses } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      })
    }),

  todayList: publicProcedure
    .query(async () => {
      // Tasks relevant today:
      //   status in (todo, scheduled, in_progress)
      //   OR completedAt falls within today's calendar day (UTC)
      const now = new Date()
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

      return prisma.task.findMany({
        where: {
          OR: [
            { status: { in: ['todo', 'scheduled', 'in_progress'] } },
            {
              completedAt: {
                gte: startOfDay,
                lt: endOfDay,
              },
            },
          ],
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      })
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const task = await prisma.task.findUnique({
        where: { id: input.id },
        include: { dependsOn: { select: { prerequisiteId: true } } },
      })
      if (!task) return null
      // Flatten dependency edges to a plain id[] so the detail modal can render
      // them without knowing the join-table shape.
      const { dependsOn, ...rest } = task
      return { ...rest, dependsOn: dependsOn.map((d) => d.prerequisiteId) }
    }),

  // Direct children of a task, in display order. Used by Focus mode's subtask
  // checklist (break the task into smaller steps). Query-only — adding /
  // checking subtasks goes through `create` / `complete` / `update`, which
  // already write Events.
  subtasks: publicProcedure
    .input(z.object({ parentId: z.string() }))
    .query(async ({ input }) => {
      return prisma.task.findMany({
        where: { parentTaskId: input.parentId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, title: true, status: true, position: true },
      })
    }),

  stale: publicProcedure
    .input(z.object({ thresholdDays: z.number().int().min(1).max(365).default(7) }).optional())
    .query(async ({ input }) => {
      const t = input?.thresholdDays ?? 7
      const cutoff = new Date(Date.now() - t * 24 * 60 * 60 * 1000)
      return prisma.task.findMany({
        where: {
          status: { in: ['todo', 'scheduled', 'blocked'] },
          createdAt: { lt: cutoff },
        },
        orderBy: { createdAt: 'asc' },
      })
    }),

  // ── Mutations ────────────────────────────────────────────────────────────

  create: publicProcedure
    .input(z.object({
      title: z.string().min(1),
      status: TaskStatusEnum.optional(),
      category: z.string().optional().nullable(),
      priority: z.number().int().min(1).max(5).optional().nullable(),
      energy: EnergyEnum.optional().nullable(),
      estimateMin: z.number().int().min(0).optional().nullable(),
      deadline: z.date().optional().nullable(),
      softDeadline: z.date().optional().nullable(),
      notes: z.string().optional().nullable(),
      goalId: z.string().optional().nullable(),
      // A loose task attached directly to an Area (no goal). Null = no area.
      areaId: z.string().optional().nullable(),
      // v2: nest under a parent task (subtask / sub-subtask). Null/undefined = top-level.
      parentTaskId: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      // A subtask inherits its parent's goal AND area unless explicit ones are
      // given, so the whole branch stays under the same owner in the tree.
      let goalId = input.goalId ?? null
      let areaId = input.areaId ?? null
      if (input.parentTaskId) {
        const parent = await prisma.task.findUniqueOrThrow({ where: { id: input.parentTaskId } })
        goalId = input.goalId ?? parent.goalId
        areaId = input.areaId ?? parent.areaId
      }

      // Position = bottom of the *undone* sibling group. A sibling group is the
      // set of tasks sharing the same parentTaskId AND owner. Top-level tasks
      // have parentTaskId = null, so the owner (goalId, else areaId) separates
      // groups: each goal and each area gets its own loose-task group.
      const lastUndone = await prisma.task.findFirst({
        where: {
          parentTaskId: input.parentTaskId ?? null,
          goalId,
          areaId,
          status: { not: 'done' },
        },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const position = lastUndone ? lastUndone.position + 1 : 0

      const task = await prisma.task.create({
        data: {
          title: input.title,
          status: input.status ?? 'todo',
          category: input.category ?? null,
          priority: input.priority ?? null,
          energy: input.energy ?? null,
          estimateMin: input.estimateMin ?? null,
          deadline: input.deadline ?? null,
          softDeadline: input.softDeadline ?? null,
          notes: input.notes ?? null,
          goalId,
          areaId,
          parentTaskId: input.parentTaskId ?? null,
          position,
        },
      })
      // Sequential awaits — SQLite is local-only, no network latency, no
      // distributed atomicity risk. Simpler than a transaction here.
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: task.id,
        action: 'create',
        payload: { title: task.title, status: task.status, parentTaskId: task.parentTaskId, position: task.position },
      })
      return task
    }),

  // Drag-reorder a sibling group: rewrite positions to the given order
  // (0,1,2,…). Done items still sort last at display time regardless.
  reorder: publicProcedure
    .input(z.object({
      parentTaskId: z.string().nullable().optional(),
      orderedIds: z.array(z.string()).min(1),
    }))
    .mutation(async ({ input }) => {
      const { orderedIds } = input
      const indexOf = new Map(orderedIds.map((id, i) => [id, i]))

      // Defensive server-side guard for the ordering constraint: a dependent
      // may not be placed above one of its prerequisites within this group.
      // (The UI blocks such drops too — this protects the data either way.)
      const deps = await prisma.taskDependency.findMany({
        where: { dependentId: { in: orderedIds }, prerequisiteId: { in: orderedIds } },
      })
      for (const d of deps) {
        const depIdx = indexOf.get(d.dependentId)!
        const preIdx = indexOf.get(d.prerequisiteId)!
        if (depIdx < preIdx) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A task cannot be ordered above a task it depends on.',
          })
        }
      }

      await prisma.$transaction(
        orderedIds.map((id, i) =>
          prisma.task.update({ where: { id }, data: { position: i } })
        )
      )
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: input.parentTaskId ?? 'root',
        action: 'reorder',
        payload: { parentTaskId: input.parentTaskId ?? null, orderedIds },
      })
      return { success: true }
    }),

  // Add "dependentId depends on prerequisiteId". Rejects self-links and any
  // edge that would close a dependency cycle (A→B→…→A).
  addDependency: publicProcedure
    .input(z.object({ dependentId: z.string(), prerequisiteId: z.string() }))
    .mutation(async ({ input }) => {
      const { dependentId, prerequisiteId } = input
      if (dependentId === prerequisiteId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A task cannot depend on itself.' })
      }
      if (await wouldCreateCycle(dependentId, prerequisiteId)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'That dependency would create a cycle.',
        })
      }
      const dep = await prisma.taskDependency.upsert({
        where: { dependentId_prerequisiteId: { dependentId, prerequisiteId } },
        create: { dependentId, prerequisiteId },
        update: {},
      })
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: dependentId,
        action: 'add_dependency',
        payload: { prerequisiteId },
      })
      return dep
    }),

  removeDependency: publicProcedure
    .input(z.object({ dependentId: z.string(), prerequisiteId: z.string() }))
    .mutation(async ({ input }) => {
      const { dependentId, prerequisiteId } = input
      await prisma.taskDependency.delete({
        where: { dependentId_prerequisiteId: { dependentId, prerequisiteId } },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: dependentId,
        action: 'remove_dependency',
        payload: { prerequisiteId },
      })
      return { success: true }
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      status: TaskStatusEnum.optional(),
      category: z.string().optional().nullable(),
      priority: z.number().int().min(1).max(5).optional().nullable(),
      energy: EnergyEnum.optional().nullable(),
      estimateMin: z.number().int().min(0).optional().nullable(),
      deadline: z.date().optional().nullable(),
      softDeadline: z.date().optional().nullable(),
      notes: z.string().optional().nullable(),
      finishCriteria: z.string().optional().nullable(),
      goalId: z.string().optional().nullable(),
      areaId: z.string().optional().nullable(),
      parentTaskId: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input

      // Guard parent-task reassignment: no self-parenting, no cycles.
      if (fields.parentTaskId !== undefined && fields.parentTaskId !== null) {
        if (fields.parentTaskId === id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'A task cannot be its own parent.' })
        }
        if (await wouldCreateParentCycle(id, fields.parentTaskId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: "That parent is one of this task's own subtasks." })
        }
      }

      // Fetch current task to compute diff for the event payload
      const before = await prisma.task.findUniqueOrThrow({ where: { id } })

      const updated = await prisma.task.update({
        where: { id },
        data: { ...fields },
      })

      // Build a diff payload — only include changed fields
      const diff: Record<string, { from: unknown; to: unknown }> = {}
      for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
        const prev = before[key as keyof typeof before]
        const next = fields[key]
        if (next !== undefined && String(prev) !== String(next)) {
          diff[key] = { from: prev, to: next }
        }
      }

      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: id,
        action: 'update',
        payload: { diff } as Prisma.InputJsonValue,
      })

      return updated
    }),

  complete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const task = await prisma.task.update({
        where: { id: input.id },
        data: {
          status: 'done',
          completedAt: new Date(),
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: input.id,
        action: 'complete',
        payload: { completedAt: task.completedAt?.toISOString() },
      })
      return task
    }),

  // Reverse of complete() — for un-checking a task ticked by accident.
  // Returns it to 'todo' and clears completedAt. We don't track the pre-done
  // status, so 'todo' is the sensible landing state for a re-opened task.
  uncomplete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const task = await prisma.task.update({
        where: { id: input.id },
        data: {
          status: 'todo',
          completedAt: null,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: input.id,
        action: 'uncomplete',
        payload: {},
      })
      return task
    }),

  defer: publicProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const task = await prisma.task.update({
        where: { id: input.id },
        data: {
          status: 'deferred',
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: input.id,
        action: 'defer',
        payload: { reason: input.reason ?? null },
      })
      return task
    }),

  // Focus mode: entering the single-task overlay marks the task in-progress and
  // stamps startedAt the first time (the main `update` doesn't expose startedAt).
  beginFocus: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const before = await prisma.task.findUniqueOrThrow({ where: { id: input.id } })
      const task = await prisma.task.update({
        where: { id: input.id },
        data: {
          status: before.status === 'done' ? before.status : 'in_progress',
          startedAt: before.startedAt ?? new Date(),
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: input.id,
        action: 'focus_start',
        payload: { prevStatus: before.status },
      })
      return task
    }),

  // Focus mode: leaving the overlay. Records the session totals on the event log;
  // does not change task status (the user decides done/in-progress at session end).
  endFocus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        workedMs: z.number().int().optional(),
        sessions: z.number().int().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: input.id,
        action: 'focus_end',
        payload: { workedMs: input.workedMs ?? null, sessions: input.sessions ?? null },
      })
      return { ok: true }
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await writeEvent({
        actor: 'user',
        entityType: 'task',
        entityId: input.id,
        action: 'delete',
        payload: {},
      })
      return prisma.task.delete({ where: { id: input.id } })
    }),
})

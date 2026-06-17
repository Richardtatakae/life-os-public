import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'
import { computeGoalProgress, DEFAULT_TARGET_STREAK } from '@/server/domain/goal-progress'
import type { Goal } from '@prisma/client'

// ─────────────────── Zod enums + types ───────────────────

const GoalStatusEnum = z.enum(['planning', 'active', 'paused', 'completed', 'archived'])

// ─────────────────── Tree builder ───────────────────

interface GoalNode {
  id: string
  title: string
  status: string
  lifeArea: string | null
  areaId: string | null
  projectId: string | null
  deadline: Date | null
  parentId: string | null
  description: string | null
  finishCriteria: string | null
  targetMetric: string | null
  targetValue: number | null
  createdAt: Date
  completedAt: Date | null
  /** Ids of goals this goal is blocked by (must be completed first). */
  dependsOn: string[]
  /** True if any prerequisite goal is not yet completed. */
  isBlocked: boolean
  children: GoalNode[]
}

function buildTree(goals: Goal[], deps: { dependentId: string; prerequisiteId: string }[]): GoalNode[] {
  const map = new Map<string, GoalNode>()
  const roots: GoalNode[] = []

  // dependentId → list of prerequisite goal ids
  const prereqsOf = new Map<string, string[]>()
  for (const d of deps) {
    if (!prereqsOf.has(d.dependentId)) prereqsOf.set(d.dependentId, [])
    prereqsOf.get(d.dependentId)!.push(d.prerequisiteId)
  }
  const completedById = new Map(goals.map((g) => [g.id, g.status === 'completed']))

  for (const g of goals) {
    const dependsOn = prereqsOf.get(g.id) ?? []
    map.set(g.id, {
      id: g.id,
      title: g.title,
      status: g.status,
      lifeArea: g.lifeArea,
      areaId: g.areaId,
      projectId: g.projectId,
      deadline: g.deadline,
      parentId: g.parentId,
      description: g.description,
      finishCriteria: g.finishCriteria,
      targetMetric: g.targetMetric,
      targetValue: g.targetValue,
      createdAt: g.createdAt,
      completedAt: g.completedAt,
      dependsOn,
      isBlocked: dependsOn.some((pid) => completedById.get(pid) === false),
      children: [],
    })
  }

  for (const g of goals) {
    const node = map.get(g.id)!
    if (g.parentId == null) {
      roots.push(node)
    } else {
      const parent = map.get(g.parentId)
      if (parent) {
        parent.children.push(node)
      } else {
        // Orphaned node (parent archived/deleted) — treat as root
        roots.push(node)
      }
    }
  }

  return roots
}

// ─────────────────── Progress computation ───────────────────

interface ProgressResult {
  goalId: string
  progress: number
  contributions: {
    habits: Array<{ habitId: string; contribution: number; weight: number }>
    tasks: Array<{ taskId: string; contribution: number }>
    children: Array<{ goalId: string; progress: number }>
  }
}

async function computeProgressForGoal(goalId: string): Promise<ProgressResult> {
  // Fetch goal's linked habits (with StreakState) and linked tasks
  const [goalHabits, linkedTasks, children] = await Promise.all([
    prisma.goalHabit.findMany({
      where: { goalId },
      include: { habit: true },
    }),
    prisma.task.findMany({ where: { goalId } }),
    prisma.goal.findMany({ where: { parentId: goalId } }),
  ])

  // Fetch StreakState for each linked habit
  const habitIds = goalHabits.map((gh) => gh.habitId)
  const streakStates = habitIds.length > 0
    ? await prisma.streakState.findMany({ where: { habitId: { in: habitIds } } })
    : []

  const streakMap = new Map(streakStates.map((s) => [s.habitId, s]))

  // Recurse children depth-first
  const childResults = await Promise.all(
    children.map((child) => computeProgressForGoal(child.id))
  )

  // Build contributions
  const habitContribs = goalHabits.map((gh) => {
    const ss = streakMap.get(gh.habitId)
    const currentStreak = ss?.currentStreak ?? 0
    const contribution = Math.min(currentStreak / DEFAULT_TARGET_STREAK, 1)
    return { habitId: gh.habitId, contribution, weight: gh.weight }
  })

  const taskContribs = linkedTasks.map((t) => ({
    taskId: t.id,
    contribution: t.status === 'done' ? 1 : 0,
  }))

  const childContribs = childResults.map((cr) => ({
    goalId: cr.goalId,
    progress: cr.progress,
  }))

  const progress = computeGoalProgress({
    habits: goalHabits.map((gh) => {
      const ss = streakMap.get(gh.habitId)
      return {
        currentStreak: ss?.currentStreak ?? 0,
        targetStreak: DEFAULT_TARGET_STREAK,
        weight: gh.weight,
      }
    }),
    tasks: linkedTasks.map((t) => ({ status: t.status, weight: 1 })),
    children: childResults.map((cr) => ({ progress: cr.progress, weight: 1 })),
  })

  return {
    goalId,
    progress,
    contributions: {
      habits: habitContribs,
      tasks: taskContribs,
      children: childContribs,
    },
  }
}

// ─────────────────── Router ───────────────────

export const goalRouter = router({
  tree: publicProcedure.query(async () => {
    const [goals, deps] = await Promise.all([
      // position first (manual drag order), createdAt as the stable tiebreak.
      prisma.goal.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      prisma.goalDependency.findMany(),
    ])
    return buildTree(goals, deps)
  }),

  list: publicProcedure
    .input(z.object({ status: GoalStatusEnum.optional() }).optional())
    .query(async ({ input }) => {
      return prisma.goal.findMany({
        where: input?.status ? { status: input.status } : undefined,
        orderBy: { createdAt: 'asc' },
      })
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const goal = await prisma.goal.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          habitLinks: {
            include: { habit: true },
          },
          tasks: true,
          children: true,
          parent: true,
          dependsOn: { select: { prerequisiteId: true } },
        },
      })

      // Fetch StreakState for linked habits
      const habitIds = goal.habitLinks.map((hl) => hl.habitId)
      const streakStates = habitIds.length > 0
        ? await prisma.streakState.findMany({ where: { habitId: { in: habitIds } } })
        : []

      return {
        ...goal,
        // Flatten dependency edges to a plain id[] for the detail modal.
        dependsOn: goal.dependsOn.map((d) => d.prerequisiteId),
        habitLinks: goal.habitLinks.map((hl) => ({
          ...hl,
          streakState: streakStates.find((s) => s.habitId === hl.habitId) ?? null,
        })),
      }
    }),

  create: publicProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional().nullable(),
      lifeArea: z.string().optional().nullable(),
      areaId: z.string().optional().nullable(),
      projectId: z.string().optional().nullable(),
      targetMetric: z.string().optional().nullable(),
      targetValue: z.number().optional().nullable(),
      deadline: z.date().optional().nullable(),
      parentId: z.string().optional().nullable(),
      status: GoalStatusEnum.optional(),
    }))
    .mutation(async ({ input }) => {
      // Append to the end of its sibling group: a sub-goal sits among its
      // parent's children; a top-level goal sits among the goals sharing the
      // same area + project. position = current max in that group + 1.
      const siblingWhere = input.parentId
        ? { parentId: input.parentId }
        : { parentId: null, areaId: input.areaId ?? null, projectId: input.projectId ?? null }
      const last = await prisma.goal.findFirst({
        where: siblingWhere,
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const goal = await prisma.goal.create({
        data: {
          title: input.title,
          description: input.description ?? null,
          lifeArea: input.lifeArea ?? null,
          areaId: input.areaId ?? null,
          projectId: input.projectId ?? null,
          targetMetric: input.targetMetric ?? null,
          targetValue: input.targetValue ?? null,
          deadline: input.deadline ?? null,
          parentId: input.parentId ?? null,
          position: (last?.position ?? -1) + 1,
          status: input.status ?? 'planning',
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: goal.id,
        action: 'create',
        payload: { title: goal.title, parentId: goal.parentId ?? null },
      })
      return goal
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional().nullable(),
      finishCriteria: z.string().optional().nullable(),
      lifeArea: z.string().optional().nullable(),
      areaId: z.string().optional().nullable(),
      projectId: z.string().optional().nullable(),
      targetMetric: z.string().optional().nullable(),
      targetValue: z.number().optional().nullable(),
      deadline: z.date().optional().nullable(),
      parentId: z.string().optional().nullable(),
      status: GoalStatusEnum.optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input
      const goal = await prisma.goal.update({
        where: { id },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.finishCriteria !== undefined && { finishCriteria: data.finishCriteria }),
          ...(data.lifeArea !== undefined && { lifeArea: data.lifeArea }),
          ...(data.areaId !== undefined && { areaId: data.areaId }),
          ...(data.projectId !== undefined && { projectId: data.projectId }),
          ...(data.targetMetric !== undefined && { targetMetric: data.targetMetric }),
          ...(data.targetValue !== undefined && { targetValue: data.targetValue }),
          ...(data.deadline !== undefined && { deadline: data.deadline }),
          ...(data.parentId !== undefined && { parentId: data.parentId }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.status === 'completed' && { completedAt: new Date() }),
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: goal.id,
        action: 'update',
        payload: { fields: Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined) },
      })
      return goal
    }),

  // Tick a goal as done. Mirror of task.complete — sets status=completed and
  // stamps completedAt. Writes an Event (project convention).
  complete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const goal = await prisma.goal.update({
        where: { id: input.id },
        data: { status: 'completed', completedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: goal.id,
        action: 'complete',
        payload: { completedAt: goal.completedAt?.toISOString() },
      })
      return goal
    }),

  // Reverse of complete() — for un-checking a goal ticked by accident.
  // Returns it to 'active' and clears completedAt.
  uncomplete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const goal = await prisma.goal.update({
        where: { id: input.id },
        data: { status: 'active', completedAt: null },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: goal.id,
        action: 'uncomplete',
        payload: {},
      })
      return goal
    }),

  archive: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const goal = await prisma.goal.update({
        where: { id: input.id },
        data: { status: 'archived' },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: goal.id,
        action: 'archive',
        payload: {},
      })
      return goal
    }),

  // Drag-reorder a sibling group of goals: rewrite positions to the given order
  // (0,1,2,…). The caller passes only the ids of one visible group (e.g. the
  // goals directly under one area), so unrelated goals are untouched.
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await prisma.$transaction(
        input.orderedIds.map((id, position) =>
          prisma.goal.update({ where: { id }, data: { position } }),
        ),
      )
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: 'batch',
        action: 'reorder',
        payload: { orderedIds: input.orderedIds },
      })
      return { success: true }
    }),

  linkHabit: publicProcedure
    .input(z.object({
      goalId: z.string(),
      habitId: z.string(),
      weight: z.number().int().min(1).max(10).default(1),
    }))
    .mutation(async ({ input }) => {
      const link = await prisma.goalHabit.upsert({
        where: { goalId_habitId: { goalId: input.goalId, habitId: input.habitId } },
        create: { goalId: input.goalId, habitId: input.habitId, weight: input.weight },
        update: { weight: input.weight },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: input.goalId,
        action: 'link_habit',
        payload: { habitId: input.habitId, weight: input.weight },
      })
      return link
    }),

  unlinkHabit: publicProcedure
    .input(z.object({ goalId: z.string(), habitId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.goalHabit.delete({
        where: { goalId_habitId: { goalId: input.goalId, habitId: input.habitId } },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: input.goalId,
        action: 'unlink_habit',
        payload: { habitId: input.habitId },
      })
      return { success: true }
    }),

  // ── Goal-to-goal dependencies ──────────────────────────────────────────────

  addDependency: publicProcedure
    .input(z.object({ dependentId: z.string(), prerequisiteId: z.string() }))
    .mutation(async ({ input }) => {
      const { dependentId, prerequisiteId } = input
      if (await wouldCreateGoalCycle(dependentId, prerequisiteId)) {
        throw new Error('That would create a circular dependency between goals.')
      }
      const dep = await prisma.goalDependency.create({
        data: { dependentId, prerequisiteId },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: dependentId,
        action: 'add_dependency',
        payload: { prerequisiteId },
      })
      return dep
    }),

  removeDependency: publicProcedure
    .input(z.object({ dependentId: z.string(), prerequisiteId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.goalDependency.delete({
        where: {
          dependentId_prerequisiteId: {
            dependentId: input.dependentId,
            prerequisiteId: input.prerequisiteId,
          },
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'goal',
        entityId: input.dependentId,
        action: 'remove_dependency',
        payload: { prerequisiteId: input.prerequisiteId },
      })
      return { success: true }
    }),

  progress: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return computeProgressForGoal(input.id)
    }),
})

// Cycle check for "dependentId depends on prerequisiteId": adding the edge
// creates a loop iff prerequisiteId already reaches dependentId by following
// prerequisite edges. Mirrors task.ts wouldCreateCycle.
async function wouldCreateGoalCycle(dependentId: string, prerequisiteId: string): Promise<boolean> {
  if (dependentId === prerequisiteId) return true
  const visited = new Set<string>()
  let frontier = [prerequisiteId]
  while (frontier.length > 0) {
    const edges = await prisma.goalDependency.findMany({
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

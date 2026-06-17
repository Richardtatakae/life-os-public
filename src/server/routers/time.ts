import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'

// Rolled-up focus time across the Pursuits hierarchy.
//
// Time is recorded per completed Pomodoro, attributed to exactly one target
// (task / goal / project / area). It then rolls UP the containment tree so a
// goal's total includes every subtask under it, a project's total includes its
// goals, and an area's total includes everything beneath it.
//
// Containment parent (single parent → a true tree → no double-counting):
//   task    → parentTaskId ?? goalId ?? areaId
//   goal    → parentId    ?? projectId ?? areaId
//   project → areaId
//   area    → (root)
//
// Duration of one completed session: endedAt - startedAt - pausedMs
// (same formula as pomodoro.statsForTask).

type Kind = 'task' | 'goal' | 'project' | 'area'
type Totals = {
  tasks: Record<string, number>
  goals: Record<string, number>
  projects: Record<string, number>
  areas: Record<string, number>
}

function bucketFor(t: Totals, kind: Kind): Record<string, number> {
  return kind === 'task' ? t.tasks : kind === 'goal' ? t.goals : kind === 'project' ? t.projects : t.areas
}

// Compute the full rolled-up totals from all completed pomodoros + the entity
// trees. Returns one map per kind, each value = own time + all descendants.
async function computeTotals(): Promise<Totals> {
  const [pomos, tasks, goals, projects] = await Promise.all([
    prisma.pomodoro.findMany({
      where: { status: 'completed', endedAt: { not: null } },
      select: { taskId: true, goalId: true, projectId: true, areaId: true, startedAt: true, endedAt: true, pausedMs: true },
    }),
    prisma.task.findMany({ select: { id: true, parentTaskId: true, goalId: true, areaId: true } }),
    prisma.goal.findMany({ select: { id: true, parentId: true, projectId: true, areaId: true } }),
    prisma.project.findMany({ select: { id: true, areaId: true } }),
  ])

  // Parent lookup per kind, applying the precedence rules above.
  const taskParent = new Map<string, { kind: Kind; id: string } | null>()
  for (const t of tasks) {
    taskParent.set(
      t.id,
      t.parentTaskId
        ? { kind: 'task', id: t.parentTaskId }
        : t.goalId
          ? { kind: 'goal', id: t.goalId }
          : t.areaId
            ? { kind: 'area', id: t.areaId }
            : null,
    )
  }
  const goalParent = new Map<string, { kind: Kind; id: string } | null>()
  for (const g of goals) {
    goalParent.set(
      g.id,
      g.parentId
        ? { kind: 'goal', id: g.parentId }
        : g.projectId
          ? { kind: 'project', id: g.projectId }
          : g.areaId
            ? { kind: 'area', id: g.areaId }
            : null,
    )
  }
  const projectParent = new Map<string, { kind: Kind; id: string } | null>()
  for (const p of projects) {
    projectParent.set(p.id, p.areaId ? { kind: 'area', id: p.areaId } : null)
  }

  function parentOf(kind: Kind, id: string): { kind: Kind; id: string } | null {
    if (kind === 'task') return taskParent.get(id) ?? null
    if (kind === 'goal') return goalParent.get(id) ?? null
    if (kind === 'project') return projectParent.get(id) ?? null
    return null // area is root
  }

  const totals: Totals = { tasks: {}, goals: {}, projects: {}, areas: {} }

  // Add `ms` to the target and every ancestor in its containment chain.
  function addUp(kind: Kind, id: string, ms: number) {
    let cur: { kind: Kind; id: string } | null = { kind, id }
    const guard = new Set<string>() // cycle guard (defensive; data is a tree)
    while (cur) {
      const key = `${cur.kind}:${cur.id}`
      if (guard.has(key)) break
      guard.add(key)
      const bucket = bucketFor(totals, cur.kind)
      bucket[cur.id] = (bucket[cur.id] ?? 0) + ms
      cur = parentOf(cur.kind, cur.id)
    }
  }

  for (const p of pomos) {
    const ms = Math.max(0, p.endedAt!.getTime() - p.startedAt.getTime() - p.pausedMs)
    if (ms <= 0) continue
    if (p.taskId) addUp('task', p.taskId, ms)
    else if (p.goalId) addUp('goal', p.goalId, ms)
    else if (p.projectId) addUp('project', p.projectId, ms)
    else if (p.areaId) addUp('area', p.areaId, ms)
  }

  return totals
}

export const timeRouter = router({
  // Rolled-up focus time for every task / goal / project / area.
  totals: publicProcedure.query(async () => computeTotals()),

  // Rolled-up total for a single target (own + descendants) plus the count of
  // sessions attributed DIRECTLY to it — used by the Focus-mode tally.
  statsForTarget: publicProcedure
    .input(z.object({ kind: z.enum(['task', 'goal', 'project', 'area']), id: z.string() }))
    .query(async ({ input }) => {
      const totals = await computeTotals()
      const totalMs = bucketFor(totals, input.kind)[input.id] ?? 0
      const field =
        input.kind === 'task'
          ? { taskId: input.id }
          : input.kind === 'goal'
            ? { goalId: input.id }
            : input.kind === 'project'
              ? { projectId: input.id }
              : { areaId: input.id }
      const count = await prisma.pomodoro.count({
        where: { ...field, status: 'completed', endedAt: { not: null } },
      })
      return { totalMs, count }
    }),
})

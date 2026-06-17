/**
 * pursuitsDerived pure-logic tests.
 * No DB, no React. Plain object literals cast to node types.
 * ≥12 cases covering recursion, deadline labels, suggestion ranking,
 * pinned exclusion + cap, and visibleTasks nesting.
 */

import { describe, it, expect } from 'vitest'
import {
  countTasks,
  goalProgress,
  nextActionOf,
  deadlineLabel,
  deadlineItems,
  suggestions,
  visibleTasks,
  type DeadlineItem,
  type SuggestionEntry,
} from '@/lib/pursuitsDerived'
import type { TaskNode } from '@/components/tasks/TaskTreeNode'
import type { GoalNode } from '@/stores/goalStore'
import type { Area, PursuitsIndex } from '@/components/tasks/pursuitsShared'

// ── helpers ────────────────────────────────────────────────────────────────

function makeTask(
  id: string,
  status: 'todo' | 'done' | 'in-progress',
  overrides: Partial<TaskNode> = {},
): TaskNode {
  return {
    id,
    title: `Task ${id}`,
    status,
    goalId: null,
    areaId: null,
    parentTaskId: null,
    position: 0,
    priority: null,
    energy: null,
    estimateMin: null,
    deadline: null,
    notes: null,
    finishCriteria: null,
    createdAt: new Date('2026-01-01'),
    completedAt: null,
    dependsOn: [],
    blocks: [],
    isBlocked: false,
    children: [],
    ...overrides,
  } as TaskNode
}

function makeGoal(
  id: string,
  areaId: string | null,
  overrides: Partial<GoalNode> = {},
): GoalNode {
  return {
    id,
    title: `Goal ${id}`,
    status: 'active',
    lifeArea: null,
    areaId,
    projectId: null,
    deadline: null,
    parentId: null,
    description: null,
    finishCriteria: null,
    targetMetric: null,
    targetValue: null,
    createdAt: new Date('2026-01-01'),
    completedAt: null,
    dependsOn: [],
    isBlocked: false,
    children: [],
    ...overrides,
  }
}

function makeArea(id: string, name: string): Area {
  return { id, name, color: null }
}

function daysFromNow(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

// ── countTasks ──────────────────────────────────────────────────────────────

describe('countTasks', () => {
  it('returns zeros for empty array', () => {
    expect(countTasks([])).toEqual({ done: 0, total: 0 })
  })

  it('counts flat list correctly', () => {
    const tasks = [
      makeTask('a', 'done'),
      makeTask('b', 'todo'),
      makeTask('c', 'done'),
    ]
    expect(countTasks(tasks)).toEqual({ done: 2, total: 3 })
  })

  it('recurses into nested children', () => {
    const child1 = makeTask('c1', 'done')
    const child2 = makeTask('c2', 'todo')
    const parent = makeTask('p', 'todo', { children: [child1, child2] })
    // parent=todo, c1=done, c2=todo → total=3, done=1
    expect(countTasks([parent])).toEqual({ done: 1, total: 3 })
  })

  it('recurses multiple levels deep', () => {
    const level3 = makeTask('l3', 'done')
    const level2 = makeTask('l2', 'done', { children: [level3] })
    const level1 = makeTask('l1', 'todo', { children: [level2] })
    // l1=todo, l2=done, l3=done → total=3, done=2
    expect(countTasks([level1])).toEqual({ done: 2, total: 3 })
  })
})

// ── goalProgress ──────────────────────────────────────────────────────────

describe('goalProgress', () => {
  it('returns 0 for empty', () => {
    expect(goalProgress([])).toBe(0)
  })

  it('returns 0 when nothing done', () => {
    expect(goalProgress([makeTask('a', 'todo'), makeTask('b', 'todo')])).toBe(0)
  })

  it('returns 100 when all done', () => {
    expect(goalProgress([makeTask('a', 'done'), makeTask('b', 'done')])).toBe(100)
  })

  it('rounds to nearest integer', () => {
    // 1 done out of 3 = 33.33... → 33
    const tasks = [makeTask('a', 'done'), makeTask('b', 'todo'), makeTask('c', 'todo')]
    expect(goalProgress(tasks)).toBe(33)
  })
})

// ── nextActionOf ──────────────────────────────────────────────────────────

describe('nextActionOf', () => {
  it('returns null for empty array', () => {
    expect(nextActionOf([])).toBeNull()
  })

  it('returns null when all done', () => {
    expect(nextActionOf([makeTask('a', 'done'), makeTask('b', 'done')])).toBeNull()
  })

  it('returns first not-done task', () => {
    const tasks = [makeTask('a', 'done'), makeTask('b', 'todo'), makeTask('c', 'todo')]
    expect(nextActionOf(tasks)?.id).toBe('b')
  })

  it('descends into children to find not-done task', () => {
    const child = makeTask('child', 'todo')
    const parent = makeTask('parent', 'done', { children: [child] })
    // parent is done but child is not → should find child
    expect(nextActionOf([parent])?.id).toBe('child')
  })
})

// ── deadlineLabel ─────────────────────────────────────────────────────────

describe('deadlineLabel', () => {
  it('returns null for null input', () => {
    expect(deadlineLabel(null)).toBeNull()
  })

  it('returns "today" for today', () => {
    const result = deadlineLabel(new Date())
    expect(result?.txt).toBe('today')
    expect(result?.overdue).toBe(false)
  })

  it('returns "tomorrow" for tomorrow', () => {
    const result = deadlineLabel(daysFromNow(1))
    expect(result?.txt).toBe('tomorrow')
    expect(result?.overdue).toBe(false)
  })

  it('returns "in Nd" for future dates', () => {
    const result = deadlineLabel(daysFromNow(5))
    expect(result?.txt).toBe('in 5d')
    expect(result?.overdue).toBe(false)
  })

  it('returns "Nd overdue" for past dates', () => {
    const result = deadlineLabel(daysFromNow(-3))
    expect(result?.txt).toBe('3d overdue')
    expect(result?.overdue).toBe(true)
  })

  it('accepts string date input', () => {
    // A date 10 days in the future
    const future = daysFromNow(10)
    const str = future.toISOString()
    const result = deadlineLabel(str)
    expect(result?.overdue).toBe(false)
    expect(result?.txt).toMatch(/^in \d+d$/)
  })
})

// ── deadlineItems ─────────────────────────────────────────────────────────

describe('deadlineItems', () => {
  it('returns empty array when no deadlines exist', () => {
    const area = makeArea('a1', 'Work')
    const goal = makeGoal('g1', 'a1')
    const task = makeTask('t1', 'todo')
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', task]]),
      rootsByOwner: new Map([['g1', [task]]]),
      allTasks: [{ id: 't1', title: 'Task t1' }],
      goalsByArea: new Map([['a1', [goal]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', goal]]),
    }
    expect(deadlineItems({ areas: [area], index })).toHaveLength(0)
  })

  it('collects tasks with deadlines and sorts ascending', () => {
    const area = makeArea('a1', 'Work')
    const goal = makeGoal('g1', 'a1')
    const t1 = makeTask('t1', 'todo', { deadline: daysFromNow(5) })
    const t2 = makeTask('t2', 'todo', { deadline: daysFromNow(2) })
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', t1], ['t2', t2]]),
      rootsByOwner: new Map([['g1', [t1, t2]]]),
      allTasks: [{ id: 't1', title: 'Task t1' }, { id: 't2', title: 'Task t2' }],
      goalsByArea: new Map([['a1', [goal]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', goal]]),
    }
    const items = deadlineItems({ areas: [area], index })
    expect(items).toHaveLength(2)
    // sorted ascending: t2 (2d) before t1 (5d)
    expect(items[0].id).toBe('t2')
    expect(items[1].id).toBe('t1')
  })

  it('excludes done tasks', () => {
    const area = makeArea('a1', 'Work')
    const goal = makeGoal('g1', 'a1')
    const doneTask = makeTask('t1', 'done', { deadline: daysFromNow(1) })
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', doneTask]]),
      rootsByOwner: new Map([['g1', [doneTask]]]),
      allTasks: [{ id: 't1', title: 'Task t1' }],
      goalsByArea: new Map([['a1', [goal]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', goal]]),
    }
    expect(deadlineItems({ areas: [area], index })).toHaveLength(0)
  })

  it('sets crumb as "Area › Goal" for tasks within a goal', () => {
    const area = makeArea('a1', 'Work')
    const goal = makeGoal('g1', 'a1', { title: 'My Goal' })
    const t1 = makeTask('t1', 'todo', { deadline: daysFromNow(3) })
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', t1]]),
      rootsByOwner: new Map([['g1', [t1]]]),
      allTasks: [{ id: 't1', title: 'Task t1' }],
      goalsByArea: new Map([['a1', [goal]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', goal]]),
    }
    const items = deadlineItems({ areas: [area], index })
    expect(items[0].crumb).toBe('Work › My Goal')
  })

  it('marks overdue items correctly', () => {
    const area = makeArea('a1', 'Work')
    const goal = makeGoal('g1', 'a1')
    const overdueTask = makeTask('t1', 'todo', { deadline: daysFromNow(-2) })
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', overdueTask]]),
      rootsByOwner: new Map([['g1', [overdueTask]]]),
      allTasks: [{ id: 't1', title: 'Task t1' }],
      goalsByArea: new Map([['a1', [goal]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', goal]]),
    }
    const items = deadlineItems({ areas: [area], index })
    expect(items[0].overdue).toBe(true)
  })
})

// ── suggestions ───────────────────────────────────────────────────────────

describe('suggestions', () => {
  it('returns empty when no goals', () => {
    const index: PursuitsIndex = {
      idToNode: new Map(),
      rootsByOwner: new Map(),
      allTasks: [],
      goalsByArea: new Map(),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map(),
    }
    const result = suggestions({
      areas: [],
      index,
      pinnedTaskIds: new Set(),
      pinnedGoalIds: new Set(),
    })
    expect(result).toHaveLength(0)
  })

  it('returns one entry per active goal with a next action', () => {
    const area = makeArea('a1', 'Health')
    const goal1 = makeGoal('g1', 'a1')
    const goal2 = makeGoal('g2', 'a1')
    const t1 = makeTask('t1', 'todo')
    const t2 = makeTask('t2', 'todo')
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', t1], ['t2', t2]]),
      rootsByOwner: new Map([['g1', [t1]], ['g2', [t2]]]),
      allTasks: [{ id: 't1', title: 'Task t1' }, { id: 't2', title: 'Task t2' }],
      goalsByArea: new Map([['a1', [goal1, goal2]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', goal1], ['g2', goal2]]),
    }
    const result = suggestions({
      areas: [area],
      index,
      pinnedTaskIds: new Set(),
      pinnedGoalIds: new Set(),
    })
    expect(result).toHaveLength(2)
  })

  it('caps results at 3', () => {
    const area = makeArea('a1', 'Health')
    const goals = ['g1', 'g2', 'g3', 'g4'].map((id) => makeGoal(id, 'a1'))
    const tasks = ['t1', 't2', 't3', 't4'].map((id) => makeTask(id, 'todo'))
    const rootsByOwner = new Map(goals.map((g, i) => [g.id, [tasks[i]]]))
    const index: PursuitsIndex = {
      idToNode: new Map(tasks.map((t) => [t.id, t])),
      rootsByOwner,
      allTasks: tasks.map((t) => ({ id: t.id, title: t.title })),
      goalsByArea: new Map([['a1', goals]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map(goals.map((g) => [g.id, g])),
    }
    const result = suggestions({
      areas: [area],
      index,
      pinnedTaskIds: new Set(),
      pinnedGoalIds: new Set(),
    })
    expect(result).toHaveLength(3)
  })

  it('excludes pinned tasks', () => {
    const area = makeArea('a1', 'Health')
    const goal = makeGoal('g1', 'a1')
    const t1 = makeTask('t1', 'todo')
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', t1]]),
      rootsByOwner: new Map([['g1', [t1]]]),
      allTasks: [{ id: 't1', title: 'Task t1' }],
      goalsByArea: new Map([['a1', [goal]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', goal]]),
    }
    const result = suggestions({
      areas: [area],
      index,
      pinnedTaskIds: new Set(['t1']),
      pinnedGoalIds: new Set(),
    })
    expect(result).toHaveLength(0)
  })

  it('excludes pinned goals', () => {
    const area = makeArea('a1', 'Health')
    const goal = makeGoal('g1', 'a1')
    const t1 = makeTask('t1', 'todo')
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', t1]]),
      rootsByOwner: new Map([['g1', [t1]]]),
      allTasks: [{ id: 't1', title: 'Task t1' }],
      goalsByArea: new Map([['a1', [goal]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', goal]]),
    }
    const result = suggestions({
      areas: [area],
      index,
      pinnedTaskIds: new Set(),
      pinnedGoalIds: new Set(['g1']),
    })
    expect(result).toHaveLength(0)
  })

  it('sorts by task deadline then goal deadline then max date', () => {
    const area = makeArea('a1', 'Health')
    // g1: task has deadline in 10d
    // g2: task has deadline in 2d
    // g3: no deadline (goes last)
    const g1 = makeGoal('g1', 'a1')
    const g2 = makeGoal('g2', 'a1')
    const g3 = makeGoal('g3', 'a1')
    const t1 = makeTask('t1', 'todo', { deadline: daysFromNow(10) })
    const t2 = makeTask('t2', 'todo', { deadline: daysFromNow(2) })
    const t3 = makeTask('t3', 'todo')
    const rootsByOwner = new Map([['g1', [t1]], ['g2', [t2]], ['g3', [t3]]])
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', t1], ['t2', t2], ['t3', t3]]),
      rootsByOwner,
      allTasks: [t1, t2, t3].map((t) => ({ id: t.id, title: t.title })),
      goalsByArea: new Map([['a1', [g1, g2, g3]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', g1], ['g2', g2], ['g3', g3]]),
    }
    const result = suggestions({
      areas: [area],
      index,
      pinnedTaskIds: new Set(),
      pinnedGoalIds: new Set(),
    })
    // t2 (2d) < t1 (10d) < t3 (no deadline = max)
    expect(result[0].task.id).toBe('t2')
    expect(result[1].task.id).toBe('t1')
    expect(result[2].task.id).toBe('t3')
  })

  it('skips planning and completed goals', () => {
    const area = makeArea('a1', 'Health')
    const planning = makeGoal('g1', 'a1', { status: 'planning' })
    const completed = makeGoal('g2', 'a1', { status: 'completed' })
    const t1 = makeTask('t1', 'todo')
    const t2 = makeTask('t2', 'todo')
    const index: PursuitsIndex = {
      idToNode: new Map([['t1', t1], ['t2', t2]]),
      rootsByOwner: new Map([['g1', [t1]], ['g2', [t2]]]),
      allTasks: [t1, t2].map((t) => ({ id: t.id, title: t.title })),
      goalsByArea: new Map([['a1', [planning, completed]]]),
      goalsByProject: new Map(),
      projectsByArea: new Map(),
      goalById: new Map([['g1', planning], ['g2', completed]]),
    }
    const result = suggestions({
      areas: [area],
      index,
      pinnedTaskIds: new Set(),
      pinnedGoalIds: new Set(),
    })
    expect(result).toHaveLength(0)
  })
})

// ── visibleTasks ──────────────────────────────────────────────────────────

describe('visibleTasks', () => {
  it('returns all tasks when showArchive is true', () => {
    const tasks = [makeTask('a', 'done'), makeTask('b', 'todo')]
    expect(visibleTasks(tasks, true)).toHaveLength(2)
  })

  it('filters out done tasks at root level when showArchive is false', () => {
    const tasks = [makeTask('a', 'done'), makeTask('b', 'todo'), makeTask('c', 'done')]
    const result = visibleTasks(tasks, false)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('filters out done tasks recursively in children', () => {
    const doneChild = makeTask('dc', 'done')
    const liveChild = makeTask('lc', 'todo')
    const parent = makeTask('p', 'todo', { children: [doneChild, liveChild] })
    const result = visibleTasks([parent], false)
    expect(result).toHaveLength(1)
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children[0].id).toBe('lc')
  })

  it('removes done parent and its children when showArchive is false', () => {
    const child = makeTask('c', 'todo') // live child under done parent
    const doneParent = makeTask('p', 'done', { children: [child] })
    const result = visibleTasks([doneParent], false)
    // done parent is excluded entirely — children don't appear either
    expect(result).toHaveLength(0)
  })
})

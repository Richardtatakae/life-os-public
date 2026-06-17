'use client'
import { create } from 'zustand'

export interface GoalNode {
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
  dependsOn: string[]
  isBlocked: boolean
  children: GoalNode[]
}

interface GoalState {
  /** Full goal tree loaded from tRPC goal.tree */
  tree: GoalNode[]
  setTree: (t: GoalNode[]) => void

  /** Progress cache keyed by goalId → 0..1 value */
  progressByGoalId: Record<string, number>
  setProgress: (goalId: string, value: number) => void

  /** Expanded nodes in the tree UI */
  expandedIds: Set<string>
  toggleExpanded: (id: string) => void
  setExpanded: (id: string, expanded: boolean) => void
}

export const useGoalStore = create<GoalState>((set) => ({
  tree: [],
  setTree: (t) => set({ tree: t }),

  progressByGoalId: {},
  setProgress: (goalId, value) =>
    set((state) => ({
      progressByGoalId: { ...state.progressByGoalId, [goalId]: value },
    })),

  expandedIds: new Set<string>(),
  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { expandedIds: next }
    }),
  setExpanded: (id, expanded) =>
    set((state) => {
      const next = new Set(state.expandedIds)
      if (expanded) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return { expandedIds: next }
    }),
}))

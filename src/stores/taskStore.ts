'use client'
import { create } from 'zustand'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TaskListItem {
  id: string
  title: string
  status: string
  category: string | null
  priority: number | null
  energy: string | null
  estimateMin: number | null
  deadline: Date | null
  softDeadline: Date | null
  goalId: string | null
  createdAt: Date
  completedAt: Date | null
}

interface TaskState {
  todayTasks: TaskListItem[]
  staleTasks: TaskListItem[]

  // Setters (used by tRPC query results)
  setTodayTasks: (tasks: TaskListItem[]) => void
  setStaleTasks: (tasks: TaskListItem[]) => void

  // Optimistic complete: marks task done locally; rollback on error
  optimisticComplete: (id: string) => void
  rollback: (id: string, prev: TaskListItem) => void

  // Optimistic defer: marks task deferred locally; rollback on error
  optimisticDefer: (id: string) => void

  // ── v2 Tasks-revamp tree (§2.4) ──────────────────────────────────────────
  // Which task rows are expanded (shows notes, subtasks, dependency editor).
  expandedTaskIds: Set<string>
  toggleTaskExpanded: (id: string) => void
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useTaskStore = create<TaskState>((set) => ({
  todayTasks: [],
  staleTasks: [],

  setTodayTasks: (tasks) => set({ todayTasks: tasks }),
  setStaleTasks: (tasks) => set({ staleTasks: tasks }),

  optimisticComplete: (id) =>
    set((state) => ({
      todayTasks: state.todayTasks.map((t) =>
        t.id === id
          ? { ...t, status: 'done', completedAt: new Date() }
          : t
      ),
      staleTasks: state.staleTasks.map((t) =>
        t.id === id
          ? { ...t, status: 'done', completedAt: new Date() }
          : t
      ),
    })),

  rollback: (id, prev) =>
    set((state) => ({
      todayTasks: state.todayTasks.map((t) => (t.id === id ? prev : t)),
      staleTasks: state.staleTasks.map((t) => (t.id === id ? prev : t)),
    })),

  optimisticDefer: (id) =>
    set((state) => ({
      todayTasks: state.todayTasks.filter((t) => t.id !== id),
      staleTasks: state.staleTasks.filter((t) => t.id !== id),
    })),

  expandedTaskIds: new Set<string>(),
  toggleTaskExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedTaskIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedTaskIds: next }
    }),
}))

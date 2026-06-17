'use client'
/**
 * pursuitsStore — selection, archive, and arrange state for the Pursuits panels.
 * No persist middleware — state resets on reload (navigation state, not data).
 */

import { create } from 'zustand'

interface PursuitsState {
  /** Selected area id, or null for "all areas". */
  selAreaId: string | null
  /** Selected goal id within the current area. */
  selGoalId: string | null
  /** Whether to show archived/done items. */
  showArchive: boolean
  /** Whether arrange (drag-reorder) mode is active. */
  arrangeMode: boolean

  /** Set the active area. Also clears selGoalId (area change resets goal selection). */
  setSelArea: (id: string | null) => void
  /** Set the active goal within the current area. */
  setSelGoal: (id: string | null) => void
  /** Jump directly to a specific area + goal combination. */
  jumpTo: (areaId: string | null, goalId: string | null) => void
  /** Toggle showArchive on/off. */
  toggleArchive: () => void
  /** Set arrange mode explicitly (true = drag handles visible). */
  setArrangeMode: (v: boolean) => void
}

export const usePursuitsStore = create<PursuitsState>((set) => ({
  selAreaId: null,
  selGoalId: null,
  showArchive: false,
  arrangeMode: false,

  setSelArea: (id) => set({ selAreaId: id, selGoalId: null }),

  setSelGoal: (id) => set({ selGoalId: id }),

  jumpTo: (areaId, goalId) => set({ selAreaId: areaId, selGoalId: goalId }),

  toggleArchive: () => set((s) => ({ showArchive: !s.showArchive })),

  setArrangeMode: (v) => set({ arrangeMode: v }),
}))

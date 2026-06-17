'use client'

/**
 * vowStore.ts — global Vow Mode UI state (Zustand, NOT persisted).
 *
 * The database (via trpc.vow.active) is the source of truth. This store
 * is hydrated on mount by VowBar. It exposes signal slots for sibling
 * components built in Wave 2/3:
 *   - activationTaskId  → VowActivationModal (Task 4) opens when non-null
 *   - exitIntent        → Wave 3 exit flow opens when non-null
 */

import { create } from 'zustand'
import type { VowSnapshot } from '@/server/routers/vow'

export type VowUiState = {
  vow: VowSnapshot | null
  keptCount: number
  setVow(v: VowSnapshot | null): void
  setKeptCount(n: number): void
  /** Task 4's modal opens when non-null */
  activationTaskId: string | null
  setActivationTaskId(id: string | null): void
  /** Wave 3's exit flow opens when non-null */
  exitIntent: 'complete' | 'break' | null
  setExitIntent(i: 'complete' | 'break' | null): void
}

export const useVowStore = create<VowUiState>()((set) => ({
  vow: null,
  keptCount: 0,
  setVow: (v) => set({ vow: v }),
  setKeptCount: (n) => set({ keptCount: n }),
  activationTaskId: null,
  setActivationTaskId: (id) => set({ activationTaskId: id }),
  exitIntent: null,
  setExitIntent: (i) => set({ exitIntent: i }),
}))

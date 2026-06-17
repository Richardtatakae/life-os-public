'use client'

/**
 * breakStore.ts — the active Focus-mode BREAK, lifted out of the FocusOverlay so
 * it survives the overlay closing.
 *
 * A break is a client-side countdown (per the Focus design spine, breaks are
 * never persisted as Pomodoro rows). It used to live as local state inside
 * FocusSession, which meant closing the overlay during a break threw the timer
 * away. Now it lives here: while a break is active you can leave Focus mode and a
 * floating box (see BreakBox) keeps the countdown going and offers to take you
 * back. Re-opening Focus mode for the same task picks the break back up.
 *
 * Single active break at a time (there's only ever one running session). `until`
 * is an absolute epoch-ms timestamp, so the countdown is correct no matter which
 * component is driving the per-second re-render. In-memory only — a break is
 * ephemeral and not worth restoring across a full reload.
 */

import { create } from 'zustand'

interface BreakState {
  /** The task the break belongs to (so the box can re-open its Focus mode). */
  taskId: string | null
  /** Title of that task, for the floating box label. */
  taskTitle: string | null
  /** Epoch ms when the break ends (null = no active break). */
  until: number | null
  /**
   * Whether the end-of-break chime has fired for this break. Shared here (not a
   * per-component ref) so whichever view is on screen when the break runs out —
   * the overlay or the floating BreakBox — chimes exactly once between them.
   */
  chimed: boolean

  startBreak: (taskId: string, taskTitle: string, until: number) => void
  clearBreak: () => void
  markChimed: () => void
}

export const useBreakStore = create<BreakState>((set) => ({
  taskId: null,
  taskTitle: null,
  until: null,
  chimed: false,

  startBreak: (taskId, taskTitle, until) =>
    set({ taskId, taskTitle, until, chimed: false }),
  clearBreak: () => set({ taskId: null, taskTitle: null, until: null, chimed: false }),
  markChimed: () => set({ chimed: true }),
}))

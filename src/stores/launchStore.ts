'use client'

/**
 * launchStore.ts — the active "on-deck" launch countdown, lifted into a global
 * store so it survives closing the Focus overlay and keeps ticking while you roam
 * other tabs.
 *
 * The launch countdown is a user-defined timer that runs BEFORE a focus session:
 * you pick a task + a timer + a duration (seconds or minutes), hit "Start launch
 * countdown", and you're then free to putter around the app. A floating widget
 * (see LaunchBox) shows the remaining time bottom-right; when it hits zero it
 * plays the chime, auto-starts your chosen Pomodoro, and pulls you into Focus mode
 * (locked work phase). A soft commitment device: you can roam, but the session
 * WILL grab you.
 *
 * In-memory only (mirrors breakStore): the active countdown is ephemeral. `until`
 * is an absolute epoch-ms timestamp; `workMin` is the chosen timer's work minutes,
 * captured at start, so LaunchBox can start the real Pomodoro at zero without
 * re-reading the timer list.
 */

import { create } from 'zustand'
import type { FocusKind } from '@/stores/uiStore'

interface LaunchState {
  /** What kind of Pursuit the pending session targets. */
  targetKind: FocusKind
  /** The target entity id (null = no active launch countdown). */
  targetId: string | null
  /** Target title, for the floating widget label. */
  targetTitle: string | null
  /** Epoch ms when the countdown ends and the Pomodoro starts. */
  until: number | null
  /** Work minutes of the chosen timer — the Pomodoro target started at zero. */
  workMin: number

  startLaunch: (args: {
    kind: FocusKind
    id: string
    title: string | null
    until: number
    workMin: number
  }) => void
  clearLaunch: () => void
}

export const useLaunchStore = create<LaunchState>((set) => ({
  targetKind: 'task',
  targetId: null,
  targetTitle: null,
  until: null,
  workMin: 25,

  startLaunch: ({ kind, id, title, until, workMin }) =>
    set({ targetKind: kind, targetId: id, targetTitle: title, until, workMin }),
  clearLaunch: () =>
    set({ targetKind: 'task', targetId: null, targetTitle: null, until: null, workMin: 25 }),
}))

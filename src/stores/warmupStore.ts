'use client'

/**
 * warmupStore.ts — the "Just 2 minutes" warm-up, lifted into a global store so it
 * can be triggered from anywhere a task appears (task rows, the Pursuits tree,
 * schedule slots) and then displayed inside the FocusOverlay.
 *
 * The warm-up is a zero-commitment on-ramp: clicking "Just 2 minutes" drops you
 * straight into Focus mode with a 2-minute countdown already running — no preset
 * picker, no setup, no lock. It is a CLIENT-SIDE countdown (like the break), never
 * a persisted Pomodoro, so a 2-minute warm-up never pollutes the Pomodoro stats.
 * `task.beginFocus` still fires (the overlay's mount effect logs `focus_start`),
 * so the start is recorded — the timer itself just isn't a real interval.
 *
 * Design spine — anti-maximalist: starting at all is the win. When the 2 minutes
 * end there's a gentle chime and a "you started, that counts" prompt — no shame,
 * no streak, no "only 2 minutes?" language.
 *
 * In-memory only (mirrors breakStore): a warm-up is ephemeral and not worth
 * restoring across a full reload. `until` is an absolute epoch-ms timestamp so the
 * countdown is correct regardless of which component drives the per-second tick.
 */

import { create } from 'zustand'
import { primeChime } from '@/lib/chime'
import { openFocusMode } from '@/stores/uiStore'

/** The warm-up is a fixed 2 minutes. */
export const WARMUP_MS = 2 * 60 * 1000

interface WarmupState {
  /** The focused entity id this warm-up belongs to (any FocusKind). */
  targetId: string | null
  /** Epoch ms when the 2 minutes end (null = no active warm-up). */
  until: number | null
  /** Whether the end-of-warm-up chime has fired (so it rings exactly once). */
  chimed: boolean

  startWarmup: (targetId: string, until: number) => void
  clearWarmup: () => void
  markChimed: () => void
}

export const useWarmupStore = create<WarmupState>((set) => ({
  targetId: null,
  until: null,
  chimed: false,

  startWarmup: (targetId, until) => set({ targetId, until, chimed: false }),
  clearWarmup: () => set({ targetId: null, until: null, chimed: false }),
  markChimed: () => set({ chimed: true }),
}))

/**
 * Begin a "Just 2 minutes" warm-up for a task and drop straight into Focus mode.
 * Called from the entry-point buttons (task rows / tree / schedule slots). Primes
 * the audio context from the click gesture so the end-of-warm-up chime can play.
 */
export function beginWarmup(targetId: string): void {
  primeChime()
  useWarmupStore.getState().startWarmup(targetId, Date.now() + WARMUP_MS)
  openFocusMode(targetId)
}

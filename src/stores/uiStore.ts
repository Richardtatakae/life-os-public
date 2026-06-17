'use client'

/**
 * uiStore.ts — global UI state for Life OS.
 *
 * Plan 13: promptModal slice — controls the global <PromptModal>.
 * Any component can open the modal by calling openPromptModal() with
 * the entity kind + id (or a custom title/context for the forCustom variant).
 *
 * Redesign v2 §2.2: activeTab slice — which top-level tab is showing.
 * Persisted to localStorage so the last tab is remembered across reloads.
 * (The blueprint named AppSetting, but there is no settings router yet and
 * adding one would reach outside this track's file ownership + risk a
 * parallel-session collision on _app.ts — see decisions.md 2026-06-02.
 * activeTab is pure UI state, not source-of-truth data, so localStorage is fine.)
 *
 * Blueprint §10.13 / Plan 13 + Redesign v2 §2.2.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// ── Types ──────────────────────────────────────────────────────────────────

/** The top-level tabs in the v2 shell. Extensible (e.g. add 'goals' later). */
export type TabId =
  | 'dashboard'
  | 'habits'
  | 'tasks'
  | 'schedule'
  | 'ideas'
  | 'journal'
  | 'distilled'
  | 'progress'
  | 'routines'
  | 'projects-on-ice'

/** How a box gets minimized: click its corner dot, or drag it onto the side rail. */
export type MinimizeMode = 'dot' | 'drag'

/**
 * How the habit tracker draws each row's consistency level:
 *   • 'dial' — the level digit inside a ring that fills toward the next level
 *   • 'pips' — seven stacked segments (the level ladder, made literal)
 * Either style can be paired with the optional momentum sparkline (see
 * habitSparkline). Persisted as a view preference.
 */
export type HabitConsistencyStyle = 'dial' | 'pips'

/**
 * Dashboard information density (Clean-Modern bento):
 *   • 'focused' — show every card's secondary detail (the default)
 *   • 'calm'    — hide secondary `.detail` metadata for a quieter board
 * Persisted as a view preference.
 */
export type Density = 'calm' | 'focused'

type PromptModalSpec =
  | { open: true; kind: 'task'; entityId: string }
  | { open: true; kind: 'habit'; entityId: string }
  | { open: true; kind: 'custom'; title: string; context?: string }
  | { open: false }

/**
 * What kind of Pursuit Focus mode is running against. Focus mode is no longer
 * task-only: a goal, project, or area can be focused directly (no fake
 * auto-created task). Time still rolls up the hierarchy via the `time` router.
 */
export type FocusKind = 'task' | 'goal' | 'project' | 'area'

/** A focus target: either a bare taskId (back-compat) or an explicit {kind,id}. */
export type FocusTarget = string | { kind: FocusKind; id: string }

/**
 * Focus mode — a full-screen overlay that takes over the app for ONE Pursuit.
 * `kind` + `id` is the focused entity (task / goal / project / area); `slotId`
 * is the schedule slot it was opened from, if any (so a completed session can
 * mark that slot done — task targets only).
 */
export interface FocusModalSpec {
  open: boolean
  kind: FocusKind
  id: string | null
  slotId: string | null
}

/**
 * The rearrangeable panels in Focus mode. The user drags these into a new order
 * in "arrange" mode; the order persists. `task` is the hero (title + subtasks);
 * the timer is just one panel among the rest.
 */
export type FocusPanelId = 'task' | 'timer' | 'pace' | 'notes' | 'distractions' | 'assist'

/** Unit for the customizable "on-deck" launch countdown (see launchStore). */
export type FocusLaunchUnit = 'seconds' | 'minutes'

/** Default top→bottom / left→right order of the Focus-mode panels. */
export const DEFAULT_FOCUS_PANEL_ORDER: FocusPanelId[] = [
  'task',
  'timer',
  'pace',
  'notes',
  'distractions',
  'assist',
]

/** Default left→right order of the top-level tabs. */
export const DEFAULT_TAB_ORDER: TabId[] = [
  'dashboard',
  'habits',
  'tasks',
  'schedule',
  'ideas',
  'journal',
  'distilled',
  'progress',
  'routines',
  'projects-on-ice',
]

interface UiState {
  promptModal: PromptModalSpec
  activeTab: TabId
  /** User-chosen left→right order of the tabs (drag to reorder in the TabBar). */
  tabOrder: TabId[]
  /**
   * Tabs the user has manually forced into "More" — these stay there regardless
   * of how much bar space is available. Persisted alongside tabOrder.
   */
  moreManual: TabId[]
  /** How boxes are minimized across every tab (see MinimizeMode). Persisted. */
  minimizeMode: MinimizeMode

  // ── Habit tracker view prefs ────────────────────────────────────────────────
  /** Which consistency visual the habit rows use: 'dial' or 'pips'. Persisted. */
  habitConsistencyStyle: HabitConsistencyStyle
  /** Show the per-row momentum sparkline beside the level visual. Persisted. */
  habitSparkline: boolean

  // ── Dashboard ───────────────────────────────────────────────────────────────
  /** Dashboard bento information density ('calm' hides secondary detail). Persisted. */
  density: Density

  // ── Focus mode ────────────────────────────────────────────────────────────
  /** The full-screen single-task focus overlay (closed by default; never persisted). */
  focusModal: FocusModalSpec
  /** True while a Pomodoro work interval is actively running — locks the overlay. */
  focusLocked: boolean
  /** Hide the target-pace bar inside Focus mode (persisted pref). */
  focusPaceHidden: boolean
  /** Id of the selected FocusTimer (DB-backed). null = use the first in the list (persisted pref). */
  focusTimerId: string | null
  /** User-chosen order of the Focus-mode panels (drag to rearrange; persisted). */
  focusPanelOrder: FocusPanelId[]
  /** Duration of the customizable launch countdown (persisted pref). */
  focusLaunchValue: number
  /** Whether the launch-countdown duration is in seconds or minutes (persisted pref). */
  focusLaunchUnit: FocusLaunchUnit

  openPromptModal: (spec: Exclude<PromptModalSpec, { open: false }>) => void
  closePromptModal: () => void
  setActiveTab: (tab: TabId) => void
  setTabOrder: (order: TabId[]) => void
  setMoreManual: (ids: TabId[]) => void
  setMinimizeMode: (mode: MinimizeMode) => void
  setHabitConsistencyStyle: (style: HabitConsistencyStyle) => void
  toggleHabitSparkline: () => void
  setDensity: (density: Density) => void

  openFocusMode: (target: FocusTarget, opts?: { slotId?: string | null }) => void
  closeFocusMode: () => void
  setFocusLocked: (locked: boolean) => void
  toggleFocusPace: () => void
  setFocusTimerId: (id: string | null) => void
  setFocusPanelOrder: (order: FocusPanelId[]) => void
  setFocusLaunchValue: (value: number) => void
  setFocusLaunchUnit: (unit: FocusLaunchUnit) => void
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      promptModal: { open: false },
      activeTab: 'dashboard',
      tabOrder: DEFAULT_TAB_ORDER,
      moreManual: [],
      minimizeMode: 'dot',
      habitConsistencyStyle: 'dial',
      habitSparkline: false,
      density: 'focused',

      focusModal: { open: false, kind: 'task', id: null, slotId: null },
      focusLocked: false,
      focusPaceHidden: false,
      focusTimerId: null,
      focusPanelOrder: DEFAULT_FOCUS_PANEL_ORDER,
      focusLaunchValue: 10,
      focusLaunchUnit: 'seconds',

      openPromptModal: (spec) =>
        set({ promptModal: spec }),

      closePromptModal: () =>
        set({ promptModal: { open: false } }),

      setActiveTab: (tab) =>
        set({ activeTab: tab }),

      setTabOrder: (order) =>
        set({ tabOrder: order }),

      setMoreManual: (ids) =>
        set({ moreManual: ids }),

      setMinimizeMode: (mode) =>
        set({ minimizeMode: mode }),

      setHabitConsistencyStyle: (style) =>
        set({ habitConsistencyStyle: style }),

      toggleHabitSparkline: () =>
        set((s) => ({ habitSparkline: !s.habitSparkline })),

      setDensity: (density) =>
        set({ density }),

      openFocusMode: (target, opts) => {
        // Back-compat: a bare string means a task target.
        const { kind, id } =
          typeof target === 'string' ? { kind: 'task' as const, id: target } : target
        set({ focusModal: { open: true, kind, id, slotId: opts?.slotId ?? null }, focusLocked: false })
      },

      closeFocusMode: () =>
        set({ focusModal: { open: false, kind: 'task', id: null, slotId: null }, focusLocked: false }),

      setFocusLocked: (locked) =>
        set({ focusLocked: locked }),

      toggleFocusPace: () =>
        set((s) => ({ focusPaceHidden: !s.focusPaceHidden })),

      setFocusTimerId: (id) =>
        set({ focusTimerId: id }),

      setFocusPanelOrder: (order) =>
        set({ focusPanelOrder: order }),

      setFocusLaunchValue: (value) =>
        set({ focusLaunchValue: Math.max(1, Math.round(value)) }),

      setFocusLaunchUnit: (unit) =>
        set({ focusLaunchUnit: unit }),
    }),
    {
      // localStorage key the persisted slice lives under
      name: 'life-os-ui',
      storage: createJSONStorage(() => localStorage),
      // Persist activeTab + tabOrder + moreManual + minimizeMode + Focus-mode PREFS only.
      // The modals (promptModal, focusModal) and focusLocked are session state —
      // never remembered, so Focus mode always starts closed + unlocked on reload.
      partialize: (state) => ({
        activeTab: state.activeTab,
        tabOrder: state.tabOrder,
        moreManual: state.moreManual,
        minimizeMode: state.minimizeMode,
        habitConsistencyStyle: state.habitConsistencyStyle,
        habitSparkline: state.habitSparkline,
        density: state.density,
        focusPaceHidden: state.focusPaceHidden,
        focusTimerId: state.focusTimerId,
        focusPanelOrder: state.focusPanelOrder,
        focusLaunchValue: state.focusLaunchValue,
        focusLaunchUnit: state.focusLaunchUnit,
      }),
      // Version 1 adds `moreManual`. Old stored state (version 0 / unversioned)
      // has no moreManual — migrate by defaulting it to [].
      version: 1,
      migrate: (persisted: unknown, fromVersion: number) => {
        const state = persisted as Record<string, unknown>
        if (fromVersion < 1) {
          state.moreManual = []
        }
        return state
      },
    },
  ),
)

// ── Imperative helper (for non-React callers) ───────────────────────────────

/**
 * Switch the active tab from outside React (e.g. a dashboard pane heading's
 * onClick handler). Other v2 tracks (e.g. the custom dashboard) import this
 * to wire "click a pane heading → switch to that tab".
 *
 * Inside a React component, prefer the hook: `useUiStore((s) => s.setActiveTab)`.
 */
export function navigateToTab(tab: TabId): void {
  useUiStore.getState().setActiveTab(tab)
}

/**
 * Open Focus mode for a Pursuit from outside React (imperative callers).
 * Accepts a bare taskId (back-compat) or an explicit {kind,id} target.
 * Inside a component, prefer the hook: `useUiStore((s) => s.openFocusMode)`.
 */
export function openFocusMode(target: FocusTarget, opts?: { slotId?: string | null }): void {
  useUiStore.getState().openFocusMode(target, opts)
}

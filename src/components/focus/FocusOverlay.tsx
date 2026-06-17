'use client'

/**
 * FocusOverlay.tsx — Focus mode: a full-screen, single-task focus environment.
 *
 * Opened from anywhere a task appears (Pursuits tree, task rows, schedule slots)
 * via `useUiStore(s => s.openFocusMode)`. It takes over the screen for ONE task.
 *
 * The screen is a set of rearrangeable PANELS (see uiStore FocusPanelId):
 *   task · timer · pace · notes · distractions · assist
 * The TASK (title + finish criteria + subtasks) is the hero; the Pomodoro timer
 * is just one panel among the rest — deliberately not center stage. Toggle
 * "Arrange" to drag the panels into a new order (snaps into a grid; persisted).
 *
 * Design spine — anti-maximalist (see projects/life-os/focus-mode/):
 *  - One completed work interval = a win. No shame / streak-break copy.
 *  - Focus-lock: while a Pomodoro WORK interval is running the overlay can't be
 *    dismissed (== can't switch tabs, since it covers the screen). Pausing, a
 *    break, or no timer → dismissible.
 *  - Breaks are CLIENT-SIDE countdowns — never persisted as Pomodoro rows.
 *  - Timers are user-defined (DB-backed FocusTimer); the upper bar is editable.
 *  - Parked distractions are saved to the Ideas tab (durable, not lost on close).
 *  - "Talk to your coach" is a visible-but-inert stub — the AI backend is a
 *    next stage (see focus-mode/next-stage-ai-coaching.md).
 */

import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { trpc } from '@/lib/trpc/client'
import { usePomodoroStore, formatElapsed, formatRemaining } from '@/stores/pomodoroStore'
import { useBreakStore } from '@/stores/breakStore'
import { useWarmupStore, WARMUP_MS } from '@/stores/warmupStore'
import { useLaunchStore } from '@/stores/launchStore'
import { playChime, primeChime } from '@/lib/chime'
import {
  useUiStore,
  type FocusPanelId,
  type FocusKind,
  DEFAULT_FOCUS_PANEL_ORDER,
} from '@/stores/uiStore'
import { formatWorked } from '@/lib/formatTime'
import { FocusTimerBar } from './FocusTimerBar'
import { SubtaskList } from './SubtaskList'

// ── Mount guard ──────────────────────────────────────────────────────────────

export function FocusOverlay() {
  const focusModal = useUiStore((s) => s.focusModal)
  if (!focusModal.open || !focusModal.id) return null
  // Keyed so switching targets remounts the session with fresh local state.
  return (
    <FocusSession
      key={`${focusModal.kind}:${focusModal.id}`}
      kind={focusModal.kind}
      id={focusModal.id}
      slotId={focusModal.slotId}
    />
  )
}

// ── Reconcile persisted panel order with the known set ─────────────────────────

function resolvePanelOrder(saved: FocusPanelId[]): FocusPanelId[] {
  const known = new Set<FocusPanelId>(DEFAULT_FOCUS_PANEL_ORDER)
  const valid = saved.filter((id) => known.has(id))
  const missing = DEFAULT_FOCUS_PANEL_ORDER.filter((id) => !valid.includes(id))
  return [...valid, ...missing]
}

/**
 * Panel wrapper. MUST live at module scope — if it's defined inside
 * FocusSession, every render (e.g. the 1-second timer tick) creates a new
 * component identity, so React remounts the whole panel subtree each tick and
 * the inputs/textarea lose focus mid-typing. Keeping it here makes the identity
 * stable so typing survives ticks.
 */
function PanelShell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/40 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">{heading}</h2>
      {children}
    </section>
  )
}

// ── Session ──────────────────────────────────────────────────────────────────

function FocusSession({ kind, id }: { kind: FocusKind; id: string; slotId: string | null }) {
  const isTask = kind === 'task'
  const store = usePomodoroStore()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const beganRef = useRef(false)
  // Guard so the work timer chimes exactly once when it crosses zero, not every
  // tick. (The break's guard lives in breakStore so it's shared with BreakBox.)
  const workChimedRef = useRef(false)

  // UI prefs + actions
  const closeFocusMode = useUiStore((s) => s.closeFocusMode)
  const setFocusLocked = useUiStore((s) => s.setFocusLocked)
  const paceHidden = useUiStore((s) => s.focusPaceHidden)
  const toggleFocusPace = useUiStore((s) => s.toggleFocusPace)
  const focusTimerId = useUiStore((s) => s.focusTimerId)
  const setFocusTimerId = useUiStore((s) => s.setFocusTimerId)
  const savedPanelOrder = useUiStore((s) => s.focusPanelOrder)
  const setFocusPanelOrder = useUiStore((s) => s.setFocusPanelOrder)

  // Data — load only the entity matching this session's kind.
  const utils = trpc.useUtils()
  const { data: task } = trpc.task.get.useQuery({ id }, { enabled: kind === 'task' })
  const { data: goal } = trpc.goal.get.useQuery({ id }, { enabled: kind === 'goal' })
  const { data: project } = trpc.project.get.useQuery({ id }, { enabled: kind === 'project' })
  const { data: area } = trpc.area.get.useQuery({ id }, { enabled: kind === 'area' })
  const { data: current, isLoading: currentLoading } = trpc.pomodoro.current.useQuery(undefined, {
    refetchInterval: 5000,
  })
  // Rolled-up focus time for this target (own + descendants).
  const { data: stats } = trpc.time.statsForTarget.useQuery({ kind, id })
  const { data: timers } = trpc.focusTimer.list.useQuery()

  // Common entity fields, normalised across kinds.
  const title =
    kind === 'task' ? task?.title
    : kind === 'goal' ? goal?.title
    : kind === 'project' ? project?.name
    : area?.name
  const finishCriteria =
    kind === 'task' ? task?.finishCriteria
    : kind === 'goal' ? goal?.finishCriteria
    : null
  const kindLabel =
    kind === 'task' ? 'Task' : kind === 'goal' ? 'Goal' : kind === 'project' ? 'Project' : 'Area'

  // Mutations
  const beginFocus = trpc.task.beginFocus.useMutation()
  const endFocus = trpc.task.endFocus.useMutation()
  const updateTask = trpc.task.update.useMutation()
  const completeTask = trpc.task.complete.useMutation()
  const createIdea = trpc.idea.create.useMutation({
    onSuccess: () => utils.idea.list.invalidate(),
  })
  const startPomodoro = trpc.pomodoro.start.useMutation({
    onSuccess: () => utils.pomodoro.current.invalidate(),
  })
  const pausePomodoro = trpc.pomodoro.pause.useMutation({
    onSuccess: () => utils.pomodoro.current.invalidate(),
  })
  const resumePomodoro = trpc.pomodoro.resume.useMutation({
    onSuccess: () => utils.pomodoro.current.invalidate(),
  })
  const completePomodoro = trpc.pomodoro.complete.useMutation({
    onSuccess: () => {
      store.clear()
      utils.pomodoro.current.invalidate()
      utils.time.statsForTarget.invalidate({ kind, id })
      utils.time.totals.invalidate()
    },
  })
  const abandonPomodoro = trpc.pomodoro.abandon.useMutation({
    onSuccess: () => {
      store.clear()
      utils.pomodoro.current.invalidate()
    },
  })

  // The break lives in a global store so it survives closing the overlay (a
  // floating box keeps it running). This session only shows a break that belongs
  // to its own task.
  const breakTaskId = useBreakStore((s) => s.taskId)
  const breakUntilRaw = useBreakStore((s) => s.until)
  const breakChimed = useBreakStore((s) => s.chimed)
  const startBreakStore = useBreakStore((s) => s.startBreak)
  const clearBreakStore = useBreakStore((s) => s.clearBreak)
  const markBreakChimed = useBreakStore((s) => s.markChimed)
  // The break store keys on the focused entity's id (works for any kind).
  const breakUntil = breakTaskId === id ? breakUntilRaw : null

  // "Just 2 minutes" warm-up — a client-side countdown (never a Pomodoro) that
  // only shows for the entity it belongs to. See warmupStore.
  const warmupTargetId = useWarmupStore((s) => s.targetId)
  const warmupUntilRaw = useWarmupStore((s) => s.until)
  const warmupChimed = useWarmupStore((s) => s.chimed)
  const startWarmupStore = useWarmupStore((s) => s.startWarmup)
  const clearWarmupStore = useWarmupStore((s) => s.clearWarmup)
  const markWarmupChimed = useWarmupStore((s) => s.markChimed)
  const warmupUntil = warmupTargetId === id ? warmupUntilRaw : null

  // Launch ("on-deck") countdown — configured here, fires globally (see LaunchBox).
  const launchValue = useUiStore((s) => s.focusLaunchValue)
  const launchUnit = useUiStore((s) => s.focusLaunchUnit)
  const setLaunchValue = useUiStore((s) => s.setFocusLaunchValue)
  const setLaunchUnit = useUiStore((s) => s.setFocusLaunchUnit)
  const startLaunchStore = useLaunchStore((s) => s.startLaunch)
  const launchActiveUntil = useLaunchStore((s) => s.until)

  // Local session state
  const [nowTick, setNowTick] = useState<number>(() => Date.now())
  const [sessionsDone, setSessionsDone] = useState(0)
  const [notesDraft, setNotesDraft] = useState('')
  const [distractions, setDistractions] = useState<string[]>([])
  const [distractionInput, setDistractionInput] = useState('')
  const [sliceInput, setSliceInput] = useState('')
  const [estimateInput, setEstimateInput] = useState('')
  const [showResistance, setShowResistance] = useState(false)
  const [feeling, setFeeling] = useState<Feeling | null>(null)
  const [depleted, setDepleted] = useState(false)
  const [showEnd, setShowEnd] = useState(false)
  const [bridge, setBridge] = useState('')
  const [arranging, setArranging] = useState(false)

  // Seed notes once the task loads (task targets only).
  const seededRef = useRef(false)
  useEffect(() => {
    if (kind === 'task' && task && !seededRef.current) {
      seededRef.current = true
      setNotesDraft(task.notes ?? '')
    }
  }, [kind, task])

  // Mark the task in-progress the first time the overlay opens for it.
  // Only tasks have a begin/end-focus lifecycle; goal/project/area targets skip it.
  useEffect(() => {
    if (!beganRef.current) {
      beganRef.current = true
      if (kind === 'task') beginFocus.mutate({ id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Sync server pomodoro → store (copied from PomodoroWidget)
  useEffect(() => {
    if (current) {
      store.setCurrent({
        id: current.id,
        startedAt: new Date(current.startedAt),
        status: current.status as 'running' | 'paused',
        targetMin: current.targetMin,
        pausedMs: current.pausedMs,
        taskId: current.taskId ?? null,
      })
    } else if (!currentLoading) {
      store.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, currentLoading])

  // Tick the running pomodoro every second
  useEffect(() => {
    if (store.status === 'running') {
      intervalRef.current = setInterval(() => store.tick(), 1000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.status])

  // Drive the client-side break countdown
  useEffect(() => {
    if (breakUntil === null) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [breakUntil])

  // Drive the client-side "Just 2 minutes" warm-up countdown
  useEffect(() => {
    if (warmupUntil === null) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [warmupUntil])

  // Chime once when the warm-up runs out. Guard shared via warmupStore.
  useEffect(() => {
    if (warmupUntil === null || warmupChimed) return
    if (nowTick >= warmupUntil) {
      markWarmupChimed()
      playChime()
    }
  }, [warmupUntil, warmupChimed, nowTick, markWarmupChimed])

  // Chime when the WORK timer reaches its target. Reset the guard per interval
  // (currentId changes when a new pomodoro starts / the old one clears).
  useEffect(() => {
    workChimedRef.current = false
  }, [store.currentId])
  useEffect(() => {
    if (store.status !== 'running' || !store.targetMin) return
    if (store.elapsedMs >= store.targetMin * 60000 && !workChimedRef.current) {
      workChimedRef.current = true
      playChime()
    }
  }, [store.status, store.elapsedMs, store.targetMin])

  // Chime when the BREAK timer runs out while the overlay is open. The guard is
  // shared via breakStore so this and the floating BreakBox never double-fire.
  useEffect(() => {
    if (breakUntil === null || breakChimed) return
    if (nowTick >= breakUntil) {
      markBreakChimed()
      playChime()
    }
  }, [breakUntil, breakChimed, nowTick, markBreakChimed])

  // Focus-lock mirrors the running state
  const locked = store.status === 'running'
  useEffect(() => {
    setFocusLocked(locked)
  }, [locked, setFocusLocked])

  // ── Derived ────────────────────────────────────────────────────────────────

  const timerList = timers ?? []
  const selectedTimer =
    timerList.find((t) => t.id === focusTimerId) ?? timerList[0] ?? null
  const selectedId = selectedTimer?.id ?? null
  const workMin = selectedTimer?.workMin ?? 25
  const breakMin = selectedTimer?.breakMin ?? 5

  const isRunning = store.status === 'running'
  const isPaused = store.status === 'paused'
  const hasActive = isRunning || isPaused
  const breakRemainingMs = breakUntil !== null ? Math.max(0, breakUntil - nowTick) : 0
  const phase: 'idle' | 'work' | 'break' = hasActive
    ? 'work'
    : breakUntil !== null
      ? 'break'
      : 'idle'

  const estimateMin = isTask ? (task?.estimateMin ?? null) : null
  const liveTotalMs = (stats?.totalMs ?? 0) + (store.status ? store.elapsedMs : 0)
  // All-time completed focus sessions on this target (server-backed, persists).
  const totalSessions = stats?.count ?? 0
  const targetMs = (estimateMin ?? 0) * 60000
  const pacePct = targetMs > 0 ? Math.min(150, (liveTotalMs / targetMs) * 100) : 0
  const paceLabel = pacePct < 85 ? 'on pace' : pacePct <= 100 ? 'closing in' : 'over target'

  // Warm-up: active while a 2-minute countdown is running for this entity;
  // "done" once it crosses zero (show the gentle "you started" prompt).
  const warmupActive = warmupUntil !== null
  const warmupRemainingMs = warmupUntil !== null ? Math.max(0, warmupUntil - nowTick) : 0
  const warmupDone = warmupActive && warmupRemainingMs <= 0

  const panelOrder = resolvePanelOrder(savedPanelOrder)
  // The notes panel writes task.notes, so it only applies to task targets.
  const visibleOrder = panelOrder.filter((pid) => isTask || pid !== 'notes')

  // ── Actions ──────────────────────────────────────────────────────────────────

  function handleClose() {
    if (locked) return // can't leave a running work interval
    if (kind === 'task') {
      endFocus.mutate({ id, workedMs: Math.round(liveTotalMs), sessions: sessionsDone })
    }
    closeFocusMode()
  }

  // Esc closes (when unlocked + not mid-arrange)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (arranging) setArranging(false)
        else handleClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, liveTotalMs, sessionsDone, arranging])

  function startInterval() {
    primeChime() // unlock audio from this gesture so the end-of-timer sound can play
    clearBreakStore()
    // Attribute the session to whichever Pursuit kind this is.
    const target =
      kind === 'task' ? { taskId: id }
      : kind === 'goal' ? { goalId: id }
      : kind === 'project' ? { projectId: id }
      : { areaId: id }
    startPomodoro.mutate({ ...target, targetMin: Math.max(1, Math.min(180, workMin)) })
  }

  // Start a "Just 2 minutes" warm-up from inside the overlay (idle screen).
  function startWarmupHere() {
    primeChime() // unlock audio so the end-of-warm-up chime can play
    startWarmupStore(id, Date.now() + WARMUP_MS)
  }

  // Start the customizable "on-deck" launch countdown. It then runs globally
  // (LaunchBox) so the user can close Focus mode and roam until it fires.
  function startLaunchCountdown() {
    primeChime() // unlock audio so the end-of-countdown chime can play
    const ms = launchValue * (launchUnit === 'minutes' ? 60000 : 1000)
    startLaunchStore({ kind, id, title: title ?? null, until: Date.now() + ms, workMin })
  }

  function endInterval() {
    if (!current) return
    primeChime() // unlock audio so the end-of-break sound can play
    // Hand the break to the global store so leaving Focus mode keeps it ticking.
    startBreakStore(id, title ?? 'this', Date.now() + breakMin * 60000)
    setSessionsDone((n) => n + 1)
    completePomodoro.mutate({ id: current.id })
  }

  function saveNotes() {
    if (kind === 'task' && task && notesDraft !== (task.notes ?? '')) {
      updateTask.mutate({ id, notes: notesDraft })
    }
  }

  function parkDistraction() {
    const v = distractionInput.trim()
    if (!v) return
    createIdea.mutate({ text: v }) // durable → Ideas tab
    setDistractions((list) => [...list, v])
    setDistractionInput('')
  }

  function setEstimate() {
    if (kind !== 'task') return
    const n = parseInt(estimateInput, 10)
    if (Number.isFinite(n) && n > 0) {
      updateTask.mutate({ id, estimateMin: n })
      utils.task.get.invalidate({ id })
    }
  }

  function finishTask(markDone: boolean) {
    if (kind === 'task') {
      const bridgeText = bridge.trim()
      if (bridgeText) {
        const next = `▶ Next: ${bridgeText}${notesDraft ? `\n\n${notesDraft}` : ''}`
        updateTask.mutate({ id, notes: next })
      } else {
        saveNotes()
      }
      if (markDone) completeTask.mutate({ id })
      endFocus.mutate({ id, workedMs: Math.round(liveTotalMs), sessions: sessionsDone })
    }
    closeFocusMode()
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const accent = isRunning ? 'text-emerald' : isPaused ? 'text-amber' : 'text-ink'
  const timeDisplay = hasActive
    ? store.targetMin
      ? formatRemaining(store.elapsedMs, store.targetMin)
      : formatElapsed(store.elapsedMs)
    : phase === 'break'
      ? formatElapsed(breakRemainingMs)
      : `${workMin}:00`

  function renderPanel(panelId: FocusPanelId) {
    switch (panelId) {
      case 'task':
        return (
          <PanelShell heading={kindLabel}>
            <div>
              <h1 className="text-2xl font-bold leading-tight text-ink">{title ?? 'Loading…'}</h1>
              {finishCriteria && (
                <p className="mt-1 text-sm text-muted">Done when: {finishCriteria}</p>
              )}
            </div>
            {isTask && (
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-wide text-faint">Break it into steps</p>
                <SubtaskList parentId={id} />
              </div>
            )}
          </PanelShell>
        )

      case 'timer':
        return (
          <PanelShell heading="Timer">
            <div className="flex flex-col items-center gap-3">
              <FocusTimerBar
                timers={timerList}
                selectedId={selectedId}
                onSelect={setFocusTimerId}
                disabled={phase !== 'idle'}
              />
              <div className={`font-mono text-4xl font-bold ${phase === 'break' ? 'text-purple-400' : accent}`}>
                {timeDisplay}
              </div>
              {phase === 'break' && (
                <div className="text-xs text-purple-300">
                  {breakRemainingMs > 0 ? 'Break — step away from the screen' : "Break's up"}
                </div>
              )}

              {/* All-time tally for this task: completed sessions + total time. */}
              <div className="flex items-center gap-1.5 text-xs text-faint">
                <span className="font-semibold text-muted">{totalSessions}</span>
                <span>session{totalSessions === 1 ? '' : 's'}</span>
                <span>·</span>
                <span className="font-semibold text-muted">{formatWorked(liveTotalMs)}</span>
                <span>total on this {kind}</span>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {phase === 'idle' && (
                  <div className="flex w-full flex-col items-center gap-3">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={startInterval}
                        disabled={startPomodoro.isPending}
                        className="rounded-xl bg-emerald px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all"
                      >
                        Start focus · {workMin} min
                      </button>
                      {!warmupActive && (
                        <button
                          onClick={startWarmupHere}
                          title="A 2-minute, no-pressure warm-up — just start"
                          className="rounded-xl border border-emerald/40 px-4 py-2.5 text-sm font-medium text-emerald hover:bg-emerald/10 active:scale-95 transition-all"
                        >
                          Just 2 minutes
                          <span className="ml-1.5 text-[10px] text-faint">no pressure</span>
                        </button>
                      )}
                    </div>

                    {/* Customizable "on-deck" launch countdown. */}
                    {launchActiveUntil !== null ? (
                      <p className="text-center text-xs text-emerald">
                        On-deck countdown running — you can close Focus and move around; it&apos;ll pull you back in.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted">
                        <span>or set an on-deck countdown:</span>
                        <input
                          type="number"
                          min={1}
                          value={launchValue}
                          onChange={(e) => setLaunchValue(Number(e.target.value) || 1)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') startLaunchCountdown()
                          }}
                          className="w-16 rounded border border-line bg-base px-2 py-1 text-ink focus:border-emerald focus:outline-none"
                        />
                        <div className="inline-flex overflow-hidden rounded-lg border border-line">
                          <button
                            onClick={() => setLaunchUnit('seconds')}
                            className={`px-2 py-1 transition-colors ${
                              launchUnit === 'seconds' ? 'bg-emerald text-white' : 'text-muted hover:bg-ink/10'
                            }`}
                          >
                            sec
                          </button>
                          <button
                            onClick={() => setLaunchUnit('minutes')}
                            className={`px-2 py-1 transition-colors ${
                              launchUnit === 'minutes' ? 'bg-emerald text-white' : 'text-muted hover:bg-ink/10'
                            }`}
                          >
                            min
                          </button>
                        </div>
                        <button
                          onClick={startLaunchCountdown}
                          className="rounded-lg bg-surface px-3 py-1 font-medium text-ink hover:bg-ink/10 active:scale-95 transition-colors"
                        >
                          Start launch countdown
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {phase === 'work' && (
                  <>
                    {isRunning ? (
                      <button
                        onClick={() => current && pausePomodoro.mutate({ id: current.id })}
                        className="rounded-xl bg-amber px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-95 transition-all"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        onClick={() => current && resumePomodoro.mutate({ id: current.id })}
                        className="rounded-xl bg-emerald px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-95 transition-all"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      onClick={endInterval}
                      className="rounded-xl bg-surface px-5 py-2.5 text-sm font-medium text-ink hover:bg-ink/10 active:scale-95 transition-all"
                    >
                      End interval →
                    </button>
                    <button
                      onClick={() => current && abandonPomodoro.mutate({ id: current.id })}
                      className="rounded-xl px-3 py-2.5 text-sm text-faint hover:text-muted transition-colors"
                      title="Stop without recording — you started, that counts"
                    >
                      Stop
                    </button>
                  </>
                )}

                {phase === 'break' && (
                  <>
                    <button
                      onClick={startInterval}
                      className="rounded-xl bg-emerald px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-95 transition-all"
                    >
                      Start next interval
                    </button>
                    <button
                      onClick={() => clearBreakStore()}
                      className="rounded-xl bg-surface px-5 py-2.5 text-sm font-medium text-muted hover:bg-ink/10 active:scale-95 transition-all"
                    >
                      Skip break
                    </button>
                  </>
                )}
              </div>
            </div>
          </PanelShell>
        )

      case 'pace':
        return (
          <PanelShell heading="Pace">
            <div className="mb-1 flex items-center justify-between text-xs text-faint">
              <span>
                Worked on this: {formatElapsed(liveTotalMs)}
                {sessionsDone > 0 ? ` · ${sessionsDone} interval${sessionsDone > 1 ? 's' : ''} now` : ''}
              </span>
              <button onClick={toggleFocusPace} className="hover:text-muted transition-colors">
                {paceHidden ? 'show pace' : 'hide pace'}
              </button>
            </div>
            {!paceHidden &&
              isTask &&
              (estimateMin ? (
                <div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pacePct > 100 ? 'bg-amber' : 'bg-emerald'
                      }`}
                      style={{ width: `${Math.min(100, pacePct)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-right text-xs text-faint">
                    {paceLabel} · target {estimateMin} min
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>Set a target time:</span>
                  <input
                    type="number"
                    min={1}
                    value={estimateInput}
                    onChange={(e) => setEstimateInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setEstimate()
                    }}
                    placeholder="min"
                    className="w-16 rounded border border-line bg-surface px-2 py-1 text-ink"
                  />
                  <button onClick={setEstimate} className="text-emerald hover:underline">
                    set
                  </button>
                </div>
              ))}
          </PanelShell>
        )

      case 'notes':
        return (
          <PanelShell heading="Task notes">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={saveNotes}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="Working context for this task (saved when you click away)…"
              rows={5}
              className="w-full resize-none rounded-xl border border-line bg-base p-3 text-sm text-ink placeholder:text-faint focus:border-emerald focus:outline-none"
            />
          </PanelShell>
        )

      case 'distractions':
        return (
          <PanelShell heading="Park a distraction">
            <input
              value={distractionInput}
              onChange={(e) => setDistractionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') parkDistraction()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="Type it, hit Enter — saved to Ideas, get back to work"
              className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-emerald focus:outline-none"
            />
            {distractions.length > 0 && (
              <ul className="space-y-1">
                {distractions.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-ink/5 px-2 py-1 text-xs text-muted"
                  >
                    <span className="truncate">{d}</span>
                    <span className="ml-2 shrink-0 text-[10px] text-emerald">→ Ideas</span>
                  </li>
                ))}
              </ul>
            )}
          </PanelShell>
        )

      case 'assist':
        return (
          <PanelShell heading="Resistance / low energy">
            <button
              onClick={() => setShowResistance((v) => !v)}
              className="self-start text-sm text-amber hover:opacity-80 transition-colors"
            >
              {showResistance ? '▾ Hide assist' : '▸ Feeling resistance? Low energy?'}
            </button>
            {showResistance && (
              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  {FEELINGS.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setFeeling(f)
                        setDepleted(false)
                      }}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${
                        feeling === f ? 'bg-amber text-white' : 'bg-ink/10 text-muted hover:bg-ink/20'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                {feeling && (
                  <div className="space-y-2 text-sm text-muted">
                    {feeling === 'Tired' && (
                      <>
                        <label className="flex items-center gap-2 text-xs text-faint">
                          <input
                            type="checkbox"
                            checked={depleted}
                            onChange={(e) => setDepleted(e.target.checked)}
                          />
                          I&apos;m really depleted
                        </label>
                        <ul className="list-disc space-y-1 pl-5">
                          {(depleted ? DEPLETED_LADDER : FATIGUE_MENU).map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {(feeling === 'Overwhelmed' || feeling === 'Unclear') && (
                      <div className="space-y-2">
                        <p>What&apos;s the smallest 5-minute next action? Name it — then just do that one slice.</p>
                        <input
                          value={sliceInput}
                          onChange={(e) => setSliceInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const v = sliceInput.trim()
                              if (v) setNotesDraft((n) => `▶ Next slice: ${v}${n ? `\n${n}` : ''}`)
                              setSliceInput('')
                            }
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          placeholder="the 5-minute slice…"
                          className="w-full rounded border border-line bg-base px-2 py-1 text-xs text-ink"
                        />
                      </div>
                    )}
                    {feeling === 'Bored' && (
                      <ul className="list-disc space-y-1 pl-5">
                        <li>Shrink it: sprint just 10 minutes, then decide.</li>
                        <li>Add novelty — change spot, music, or method.</li>
                        <li>Temptation-bundle: pair it with something you enjoy.</li>
                      </ul>
                    )}
                    {feeling === 'Anxious' && (
                      <ul className="list-disc space-y-1 pl-5">
                        <li>Physiological sigh: two inhales through the nose, long exhale. ×5.</li>
                        <li>Name the single most concrete next step and shrink it.</li>
                      </ul>
                    )}
                    <p className="border-t border-line pt-2 text-xs text-faint">
                      It&apos;s conditions, not character. Starting at all is the win.
                    </p>
                  </div>
                )}

                <button
                  disabled
                  title="AI coaching — next stage"
                  className="mt-3 w-full cursor-not-allowed rounded-lg border border-dashed border-line py-2 text-xs text-faint"
                >
                  🗣 Talk to your coach (coming soon)
                </button>
              </div>
            )}
          </PanelShell>
        )
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[200] flex flex-col overflow-y-auto bg-base/98 backdrop-blur-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-faint">Focus mode</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setArranging((v) => !v)}
            className={`text-xs transition-colors ${
              arranging ? 'text-emerald hover:opacity-80' : 'text-muted hover:text-ink'
            }`}
            title="Drag the panels to rearrange them"
          >
            {arranging ? '✓ Done arranging' : '⤢ Arrange'}
          </button>
          {locked ? (
            <span className="text-xs text-faint">🔒 locked — pause or finish the interval to exit</span>
          ) : (
            <button
              onClick={() => setShowEnd(true)}
              className="text-xs text-muted hover:text-ink transition-colors"
            >
              {isTask ? 'Done with this task' : 'Done for now'}
            </button>
          )}
          <button
            onClick={handleClose}
            disabled={locked}
            title={locked ? 'Locked while focusing' : 'Close (Esc)'}
            className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-ink/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body — the rearrangeable panel grid */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {/* "Just 2 minutes" warm-up banner — a no-pressure on-ramp. */}
        {warmupActive && (
          <div className="mb-6 rounded-2xl border border-emerald/40 bg-emerald/10 p-5 text-center">
            {!warmupDone ? (
              <>
                <div className="text-xs font-semibold uppercase tracking-widest text-emerald">
                  Just 2 minutes · no pressure
                </div>
                <div className="mt-2 font-mono text-5xl font-bold text-emerald">
                  {formatElapsed(warmupRemainingMs)}
                </div>
                <p className="mx-auto mt-3 max-w-md text-sm text-muted">
                  Spend two minutes with this — open it, poke at it, or just think about it. You
                  don&apos;t have to produce anything. Starting is the whole goal.
                </p>
              </>
            ) : (
              <>
                <div className="text-lg font-bold text-ink">Nice — you started. That counts.</div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => clearWarmupStore()}
                    className="rounded-xl bg-emerald px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-95 transition-all"
                  >
                    Keep going
                  </button>
                  <button
                    onClick={() => {
                      clearWarmupStore()
                      handleClose()
                    }}
                    className="rounded-xl bg-ink/10 px-5 py-2.5 text-sm font-medium text-muted hover:bg-ink/20 active:scale-95 transition-all"
                  >
                    I&apos;m done for now
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {arranging && (
          <p className="mb-4 text-center text-xs text-emerald">
            Drag any panel to rearrange. Controls are paused while arranging.
          </p>
        )}
        {arranging ? (
          <ArrangeGrid
            order={visibleOrder}
            onReorder={setFocusPanelOrder}
            renderPanel={renderPanel}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visibleOrder.map((pid) => (
              <div key={pid}>{renderPanel(pid)}</div>
            ))}
          </div>
        )}
      </div>

      {/* Session-end summary */}
      {showEnd && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-base/80 p-6">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-lg font-bold text-ink">Nice — one session done</h2>
            <p className="mt-1 text-sm text-muted">
              You put in {formatElapsed(liveTotalMs)}
              {sessionsDone > 0 ? ` across ${sessionsDone} interval${sessionsDone > 1 ? 's' : ''}` : ''}. That counts.
            </p>
            {isTask && (
              <>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-widest text-faint">
                  Next I&apos;ll… (a bridge for next time)
                </label>
                <input
                  value={bridge}
                  onChange={(e) => setBridge(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishTask(false)
                  }}
                  placeholder="the very next step"
                  className="mt-1 w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-emerald focus:outline-none"
                />
              </>
            )}
            <div className="mt-5 flex flex-col gap-2">
              {isTask && (
                <button
                  onClick={() => finishTask(true)}
                  className="rounded-xl bg-emerald px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-colors"
                >
                  Mark task done
                </button>
              )}
              <button
                onClick={() => finishTask(false)}
                className="rounded-xl bg-ink/10 px-4 py-2 text-sm font-medium text-muted hover:bg-ink/20 transition-colors"
              >
                {isTask ? 'Leave in progress & exit' : 'Exit'}
              </button>
              <button
                onClick={() => setShowEnd(false)}
                className="px-4 py-2 text-xs text-faint hover:text-muted transition-colors"
              >
                Keep going
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Arrange grid (snap-to-grid panel reordering) ───────────────────────────────

function ArrangeGrid({
  order,
  onReorder,
  renderPanel,
}: {
  order: FocusPanelId[]
  onReorder: (order: FocusPanelId[]) => void
  renderPanel: (id: FocusPanelId) => React.ReactNode
}) {
  // 4px activation so a stray click never starts a drag (see SortableList).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(active.id as FocusPanelId)
    const newIndex = order.indexOf(over.id as FocusPanelId)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(order, oldIndex, newIndex))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {order.map((id) => (
            <SortablePanel key={id} id={id}>
              {renderPanel(id)}
            </SortablePanel>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortablePanel({ id, children }: { id: FocusPanelId; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded-2xl ring-1 ring-emerald/40 active:cursor-grabbing"
    >
      {/* Controls are inert while arranging so a drag never triggers them. */}
      <div className="pointer-events-none select-none">{children}</div>
    </div>
  )
}

// ── Static assist content ─────────────────────────────────────────────────────

type Feeling = 'Overwhelmed' | 'Bored' | 'Tired' | 'Anxious' | 'Unclear'
const FEELINGS: Feeling[] = ['Overwhelmed', 'Bored', 'Tired', 'Anxious', 'Unclear']

const FATIGUE_MENU = [
  'Caffeine nap — coffee, then 20 minutes lying down.',
  'Cold water on the face/wrists, 30 seconds.',
  'Step outside into daylight, 10–20 minutes.',
  '10 minutes of movement to raise your heart rate.',
  'Physiological sigh, 5 rounds.',
]

const DEPLETED_LADDER = [
  'Sit up.',
  'Drink a glass of water.',
  'Cold splash on the face.',
  'Two minutes outside. Then reassess — stopping is allowed.',
]

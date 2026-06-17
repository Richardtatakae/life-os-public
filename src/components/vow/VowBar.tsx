'use client'

/**
 * VowBar.tsx — always-visible top bar while a Vow is active.
 *
 * Fixed at the top of the viewport (z-[150]). Amber-accented — never red/green.
 * Renders null when no vow is active.
 *
 * Responsibilities:
 *  1. Hydrates vowStore from tRPC (vow.active) — this component is the
 *     single hydration point so siblings can trust the store.
 *  2. Syncs tray (setTrayVow / clearTrayVow) on vow transitions.
 *  3. Fires a 40-minute heartbeat notification while a vow is active.
 *  4. Applies/removes the `vow-active` class on <html> for the gold frame + dim.
 */

import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { useVowStore } from '@/stores/vowStore'
import { useUiStore } from '@/stores/uiStore'
import { setTrayVow, clearTrayVow, notifyVow } from '@/lib/vowShell'
// VOW_RULES is being created by a sibling agent — import without creating.
import { VOW_RULES } from '@/components/vow/vowRules'

// ── Elapsed helpers ────────────────────────────────────────────────────────

function formatElapsedVow(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime()
  const totalMinutes = Math.floor(ms / 60_000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0) return `${h}h ${m}m under vow`
  if (m > 0) return `${m}m under vow`
  return 'just started'
}

// ── VowBar ────────────────────────────────────────────────────────────────

export function VowBar() {
  const vow = useVowStore((s) => s.vow)
  const keptCount = useVowStore((s) => s.keptCount)
  const setVow = useVowStore((s) => s.setVow)
  const setKeptCount = useVowStore((s) => s.setKeptCount)
  const setExitIntent = useVowStore((s) => s.setExitIntent)
  const openFocusMode = useUiStore((s) => s.openFocusMode)
  const activeTab = useUiStore((s) => s.activeTab)

  const [rulesOpen, setRulesOpen] = useState(false)
  const [, setTick] = useState(0)

  // ── Hydration: tRPC query ────────────────────────────────────────────────
  const { data } = trpc.vow.active.useQuery(undefined, {
    refetchInterval: 30_000, // stay in sync, 30s poll
    staleTime: 20_000,
  })

  // Previous vow id ref for detecting transitions
  const prevVowIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!data) return
    setVow(data.vow)
    setKeptCount(data.keptCount)

    const newId = data.vow?.id ?? null
    const prevId = prevVowIdRef.current

    // Detect transition: nothing → vow (activate tray)
    if (prevId !== undefined && prevId !== newId) {
      if (newId && data.vow) {
        void setTrayVow(data.vow.taskTitle)
      } else if (prevId && !newId) {
        void clearTrayVow()
      }
    }
    prevVowIdRef.current = newId
  }, [data, setVow, setKeptCount])

  // ── Tray sync on first load (app restart with active vow) ───────────────
  useEffect(() => {
    if (vow) {
      void setTrayVow(vow.taskTitle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally only on mount

  // ── Tray clear on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      void clearTrayVow()
    }
  }, [])

  // ── Elapsed timer: tick every minute ────────────────────────────────────
  useEffect(() => {
    if (!vow) return
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [vow])

  // ── Heartbeat: notify every 40 minutes ──────────────────────────────────
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    if (!vow) return
    const title = vow.taskTitle
    heartbeatRef.current = setInterval(() => {
      void notifyVow(`Still under vow: ${title}`)
    }, 40 * 60 * 1000)
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [vow?.id, vow?.taskTitle]) // restart only when vow changes

  // ── Apply/remove vow-active on <html> ───────────────────────────────────
  useEffect(() => {
    const html = document.documentElement
    if (vow) {
      html.classList.add('vow-active')
    } else {
      html.classList.remove('vow-active')
    }
    return () => {
      html.classList.remove('vow-active')
    }
  }, [vow])

  // ── Dim non-tasks content when vow is active ────────────────────────────
  // Adds/removes `vow-dim-content` on the body based on the active tab.
  useEffect(() => {
    const body = document.body
    if (vow && activeTab !== 'tasks') {
      body.classList.add('vow-dim-content')
    } else {
      body.classList.remove('vow-dim-content')
    }
    return () => {
      body.classList.remove('vow-dim-content')
    }
  }, [vow, activeTab])

  if (!vow) return null

  const elapsed = formatElapsedVow(new Date(vow.startedAt))

  return (
    <>
      {/* ── The bar ─────────────────────────────────────────────────────── */}
      <div
        role="banner"
        aria-label="Vow Mode — active"
        className="fixed inset-x-0 top-0 z-[150] flex h-10 items-center gap-3 border-b border-amber/60 bg-surface/96 px-4 shadow-[0_2px_16px_rgba(245,158,11,0.18)] backdrop-blur"
        style={{ boxShadow: '0 2px 16px rgba(245,158,11,0.15)' }}
      >
        {/* Chain + label */}
        <span className="shrink-0 text-[13px] font-bold tracking-widest text-amber-light">
          ⛓ UNDER VOW:
        </span>

        {/* Task title — truncated, full criteria on hover */}
        <span
          className="max-w-[260px] truncate text-[13px] font-semibold text-amber"
          title={vow.finishCriteria}
        >
          {vow.taskTitle}
        </span>

        {/* Elapsed */}
        <span className="ml-1 shrink-0 text-[11px] text-muted">
          {elapsed}
        </span>

        {/* Kept count */}
        <span className="ml-auto shrink-0 text-[11px] text-muted">
          Vows kept:{' '}
          <span className="font-semibold text-amber-light">{keptCount}</span>
        </span>

        {/* Focus button */}
        <button
          onClick={() => openFocusMode({ kind: 'task', id: vow.taskId })}
          className="shrink-0 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber transition-colors hover:bg-amber/20 hover:border-amber/70"
        >
          Focus
        </button>

        {/* Done button */}
        <button
          onClick={() => setExitIntent('complete')}
          className="shrink-0 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber transition-colors hover:bg-amber/20 hover:border-amber/70"
        >
          Done
        </button>

        {/* Break button — subtle/muted, not alarming */}
        <button
          onClick={() => setExitIntent('break')}
          className="shrink-0 rounded-md border border-line px-2.5 py-0.5 text-[11px] text-muted transition-colors hover:text-ink hover:border-line-strong"
        >
          Break
        </button>

        {/* Rules button + popover */}
        <div className="relative shrink-0">
          <button
            onClick={() => setRulesOpen((o) => !o)}
            className="rounded-md border border-line px-2.5 py-0.5 text-[11px] text-muted transition-colors hover:text-ink hover:border-line-strong"
            aria-expanded={rulesOpen}
            aria-haspopup="true"
          >
            Rules
          </button>

          {rulesOpen && (
            <>
              {/* Click-away backdrop */}
              <div
                className="fixed inset-0 z-[155]"
                onClick={() => setRulesOpen(false)}
              />
              {/* Popover */}
              <div className="absolute right-0 top-full z-[160] mt-1 w-72 rounded-xl border border-line bg-surface shadow-2xl">
                <div className="border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-amber">
                  Vow Rules
                </div>
                <ul className="divide-y divide-line">
                  {VOW_RULES.map((rule, i) => {
                    // VOW_RULES items may be strings or {title, body} objects —
                    // handle both shapes so we stay compatible with the sibling.
                    const isObj = typeof rule === 'object' && rule !== null
                    const title = isObj ? (rule as { title: string }).title : String(rule)
                    const body = isObj ? (rule as { body?: string }).body : undefined
                    return (
                      <li key={i} className="px-3 py-2 text-[12px] text-muted leading-relaxed">
                        <span className="font-medium text-ink/80">{title}</span>
                        {body && <span className="block text-[11px] mt-0.5">{body}</span>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Content-push spacer (so bar never covers content) ────────────── */}
      {/* Injected via CSS (.vow-active body main/[data-main]) instead of here
          to avoid coupling — see globals.css vow-active rules. */}
    </>
  )
}

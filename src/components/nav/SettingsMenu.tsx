'use client'

/**
 * SettingsMenu.tsx — the global ⚙ settings menu in the top-right of the shell.
 *
 * A gear button that opens a small dropdown panel of app-wide preferences. It is
 * built to GROW: each preference is its own <section>, so future settings drop in
 * below without touching the existing ones.
 *
 * First setting — "Minimize boxes by": choose whether a box is minimized by
 * clicking the amber dot in its corner, or by dragging it onto the left side
 * rail. The choice lives in uiStore.minimizeMode and drives BoxBoard.
 */

import { useEffect, useRef, useState } from 'react'
import { useUiStore, type MinimizeMode } from '@/stores/uiStore'
import { trpc } from '@/lib/trpc/client'

// localStorage keys that can hold private content (unsaved journal drafts +
// theme). Cleared when entering demo mode so nothing personal lingers on screen.
const SENSITIVE_LOCAL_KEYS = [
  'journal-draft',
]

export function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const minimizeMode = useUiStore((s) => s.minimizeMode)
  const setMinimizeMode = useUiStore((s) => s.setMinimizeMode)

  // ── Demo mode ───────────────────────────────────────────────────────────
  const demoQuery = trpc.demo.getMode.useQuery()
  const demoOn = demoQuery.data?.enabled ?? false
  const demoReady = demoQuery.data?.ready ?? false
  const setDemo = trpc.demo.setMode.useMutation({
    onSuccess: (res) => {
      // Entering demo: wipe any unsaved private drafts before the page reloads.
      if (res.enabled) {
        for (const k of SENSITIVE_LOCAL_KEYS) window.localStorage.removeItem(k)
      }
      // Full reload so every cached query refetches against the now-active DB.
      window.location.reload()
    },
  })

  // Close the panel on an outside click or the Escape key.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        aria-expanded={open}
        title="Settings"
        className="rounded-lg border border-ink/10 px-2.5 py-1.5 text-xl leading-none
                   text-muted transition-colors hover:bg-ink/10 hover:text-ink"
      >
        ⚙
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-ink/10
                     bg-surface p-3 shadow-xl"
        >
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Settings
          </h3>

          {/* ── Minimize mode ───────────────────────────────────────────── */}
          <section className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink">Minimize boxes by</span>
            <SegToggle
              value={minimizeMode}
              onChange={setMinimizeMode}
              options={[
                { id: 'dot', label: 'Clicking the dot' },
                { id: 'drag', label: 'Dragging to side' },
              ]}
            />
            <span className="text-[10px] leading-snug text-faint">
              {minimizeMode === 'dot'
                ? 'Hover a box and click the amber dot in its top-left corner.'
                : 'Drag a box onto the left rail and let go to minimize it.'}
            </span>
          </section>

          {/* ── Demo mode ───────────────────────────────────────────────── */}
          <section className="mt-3 flex flex-col gap-1.5 border-t border-ink/10 pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink">Demo mode</span>
              <button
                type="button"
                role="switch"
                aria-checked={demoOn}
                disabled={setDemo.isPending || demoQuery.isLoading || (!demoOn && !demoReady)}
                onClick={() => setDemo.mutate({ enabled: !demoOn })}
                className={
                  'relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-40 ' +
                  (demoOn ? 'border-amber/40 bg-amber' : 'border-control-border bg-control')
                }
                title={demoOn ? 'Switch back to your real data' : 'Show fake data for demos'}
              >
                <span
                  className={
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ' +
                    (demoOn ? 'left-[18px]' : 'left-0.5')
                  }
                />
              </button>
            </div>
            <span className="text-[10px] leading-snug text-faint">
              {!demoReady
                ? 'Demo database not built yet — run “npm run db:seed-demo”.'
                : demoOn
                  ? 'Showing fake sample data. Your real data is safe — toggle off to return to it.'
                  : 'Swap in fake sample data so you can show Life OS without exposing private data.'}
            </span>
            {setDemo.error && (
              <span className="text-[10px] leading-snug text-amber">{setDemo.error.message}</span>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

/** A two-option segmented toggle styled with the app tokens. */
function SegToggle({
  value,
  onChange,
  options,
}: {
  value: MinimizeMode
  onChange: (v: MinimizeMode) => void
  options: { id: MinimizeMode; label: string }[]
}) {
  return (
    <div className="flex rounded-lg border border-control-border bg-control p-0.5">
      {options.map((opt) => {
        const active = opt.id === value
        return (
          <button
            key={opt.id}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={
              'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ' +
              (active ? 'bg-emerald/20 text-emerald' : 'text-muted hover:bg-ink/10 hover:text-ink')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

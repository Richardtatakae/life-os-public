'use client'

/**
 * ProjectsOnIce — the "Projects on Ice" tab.
 *
 * Two states:
 *   • Overview — a grid of square "window" cards, one per parked project. Click
 *     a square to open it.
 *   • Project dashboard — a back button + the project's own BoxBoard, showing
 *     every element associated with that project (each draggable/resizable and
 *     minimisable to the board's left dock, exactly like any other tab).
 *
 * Projects are defined in `iceProjects.tsx`.
 */

import { useState } from 'react'
import { BoxBoard } from '@/components/shared/BoxBoard'
import { trpc } from '@/lib/trpc/client'
import { ICE_PROJECTS } from './iceProjects'

// Parked projects that are private and must not be shown when demoing Life OS
// to other people.
const DEMO_HIDDEN_PROJECT_IDS = new Set<string>([])

export function ProjectsOnIce() {
  const [openId, setOpenId] = useState<string | null>(null)

  // In demo mode, drop private parked projects from the list (and block opening
  // one by id, in case it was the last-open project before demo was turned on).
  const demoMode = trpc.demo.getMode.useQuery().data?.enabled ?? false
  const projects = demoMode
    ? ICE_PROJECTS.filter((p) => !DEMO_HIDDEN_PROJECT_IDS.has(p.id))
    : ICE_PROJECTS

  const open = projects.find((p) => p.id === openId) ?? null

  // ── Open project → its dashboard ──────────────────────────────────────────
  if (open) {
    return (
      <div>
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="flex items-center gap-1.5 rounded-lg border border-faint/40 bg-surface px-3 py-1.5
                       text-sm text-muted transition-colors hover:border-ink/30 hover:text-ink
                       focus:outline-none focus:ring-1 focus:ring-ink/30"
          >
            <span aria-hidden>←</span> Projects on Ice
          </button>
          <span className="flex h-7 w-7 items-center justify-center" style={{ color: open.accent }}>
            <span className="[&>svg]:h-5 [&>svg]:w-5">{open.icon}</span>
          </span>
          <h1 className="text-lg font-semibold text-ink">{open.title}</h1>
        </div>

        <BoxBoard storageKey={open.storageKey} panes={open.panes} defaultLayout={open.defaultLayout} />
      </div>
    )
  }

  // ── Overview → the grid of project squares ────────────────────────────────
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-lg font-semibold text-ink">Projects on Ice</h1>
        <p className="mt-1 text-sm text-muted">
          Parked projects, one click away. Open a square to see all of its elements.
        </p>
      </header>

      {projects.length === 0 && (
        <p className="text-sm text-faint">No parked projects.</p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpenId(p.id)}
            title={`Open ${p.title}`}
            className="group flex aspect-square flex-col items-start justify-between rounded-2xl border
                       border-faint/30 bg-surface p-4 text-left transition-all
                       hover:-translate-y-0.5 hover:border-[color:var(--accent)] hover:shadow-lg
                       focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]"
            style={{ ['--accent' as string]: p.accent }}
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-faint/30 bg-base
                         transition-colors group-hover:border-[color:var(--accent)]"
              style={{ color: p.accent }}
            >
              {p.icon}
            </span>
            <div className="w-full">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">{p.title}</h2>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                  {p.panes.length} elements
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{p.blurb}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

'use client'

/**
 * DeadlinesPanelV2 — visual rebuild of DeadlinesPanel on the new design system.
 *
 * Data wiring is identical to DeadlinesPanel (same tRPC queries, buildPursuitsIndex,
 * deadlineItems, deadlineLabel, modal state). Only the visual layer changes:
 * — Panel primitive replaces the raw <div className="panel dl-panel">
 * — Tailwind token utilities replace all .pmc/.dl-* scoped CSS classes
 * — Lucide icons replace the ◎/☐ glyphs
 *
 * Colour rule (non-negotiable, red-green safe):
 *   Overdue → text-[color:var(--destructive)] (amber in the token system)
 *   Icons   → text-primary (blue)
 *   Never red, never green.
 */

import { useState } from 'react'
import { Target, Square } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { buildPursuitsIndex } from '@/components/tasks/pursuitsShared'
import { deadlineItems, deadlineLabel } from '@/lib/pursuitsDerived'
import { ItemDetailModal, type DetailKind } from '@/components/shared/ItemDetailModal'
import { Panel } from '@/components/ui/panel'
import { cn } from '@/lib/utils'

/** Format a Date as a short absolute date, e.g. "Jun 15". */
function shortDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
}

export function DeadlinesPanelV2() {
  const [modal, setModal] = useState<{ kind: DetailKind; id: string } | null>(null)

  const taskTreeQuery = trpc.task.tree.useQuery()
  const goalTreeQuery = trpc.goal.tree.useQuery()
  const areasQuery = trpc.area.list.useQuery()
  const projectsQuery = trpc.project.list.useQuery()

  const taskRoots = taskTreeQuery.data ?? []
  const goalRoots = goalTreeQuery.data ?? []
  const areas = areasQuery.data ?? []
  const projects = projectsQuery.data ?? []

  const index = buildPursuitsIndex(taskRoots, goalRoots, projects)
  const items = deadlineItems({ areas, index })

  const isLoading =
    taskTreeQuery.isLoading ||
    goalTreeQuery.isLoading ||
    areasQuery.isLoading

  return (
    <Panel>
      {/* Header */}
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Deadlines
      </h3>

      {/* Loading state */}
      {isLoading && (
        <p className="py-4 text-center text-xs text-muted-foreground animate-pulse">
          Loading…
        </p>
      )}

      {/* Empty state */}
      {!isLoading && items.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No upcoming deadlines — all clear.
        </p>
      )}

      {/* Deadline rows */}
      {!isLoading && items.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            const label = deadlineLabel(item.deadline)
            const Icon = item.kind === 'goal' ? Target : Square

            return (
              <div
                key={`${item.kind}:${item.id}`}
                role="button"
                tabIndex={0}
                onClick={() => setModal({ kind: item.kind, id: item.id })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setModal({ kind: item.kind, id: item.id })
                  }
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-[calc(var(--radius)-4px)] px-2 py-1.5 text-sm transition-colors hover:bg-secondary"
              >
                {/* Icon */}
                <Icon className="size-4 shrink-0 text-primary" aria-hidden />

                {/* Body — title + crumb */}
                <span className="min-w-0 flex-1 flex flex-col">
                  <span className="truncate text-foreground">{item.title}</span>
                  {item.crumb && (
                    <span className="block truncate text-[10.5px] text-muted-foreground">
                      {item.crumb}
                    </span>
                  )}
                </span>

                {/* When — relative label + absolute date */}
                {label && (
                  <span
                    className={cn(
                      'ml-auto shrink-0 text-right text-xs',
                      item.overdue
                        ? 'text-[color:var(--destructive)]'
                        : 'text-muted-foreground',
                    )}
                  >
                    <b
                      className={cn(
                        'block text-[11px] font-bold',
                        item.overdue && 'font-extrabold',
                      )}
                    >
                      {label.txt}
                    </b>
                    {shortDate(item.deadline)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Inline item detail modal */}
      {modal && (
        <div className="px-2 pb-3">
          <ItemDetailModal
            kind={modal.kind}
            id={modal.id}
            onClose={() => setModal(null)}
          />
        </div>
      )}
    </Panel>
  )
}

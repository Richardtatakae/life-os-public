'use client'

/**
 * TabBar.tsx — the top-level tab navigation for the v2 shell.
 *
 * Renders one button per tab and drives `activeTab` in the uiStore. Switching is
 * instant client-side state — no page reload — and the last tab is remembered
 * (uiStore persists it).
 *
 * Responsive overflow: a ResizeObserver on the bar container measures available
 * width and automatically moves tabs that don't fit into the "More ▾" dropdown.
 * As the window grows, tabs are auto-restored to the bar. Tabs in `moreManual`
 * are ALWAYS in More regardless of space (user-pinned). Dragging works in both
 * directions: bar → bar (reorder), More → bar (unpin + reorder), bar → More
 * (pin). Vow guard applies to all navigation paths.
 *
 * Redesign v2 §2.2 (Track A — Tab shell) + Calm-Modern redesign Phase C1.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useUiStore, type TabId, DEFAULT_TAB_ORDER } from '@/stores/uiStore'
import { useVowStore } from '@/stores/vowStore'
import { ThemeSwitcher } from '@/components/nav/ThemeSwitcher'
import { SettingsMenu } from '@/components/nav/SettingsMenu'
import { VowInterstitial } from '@/components/vow/VowInterstitial'

/** Human-readable label for each tab id. */
const TAB_LABELS: Record<TabId, string> = {
  dashboard: 'Dashboard',
  habits: 'Habits',
  tasks: 'Pursuits',
  schedule: 'Schedule',
  ideas: 'Ideas',
  journal: 'Journal',
  distilled: 'Distilled',
  progress: 'Progress',
  routines: 'Routines',
  'projects-on-ice': 'Projects on Ice',
}

/**
 * Estimated px width per tab character (font-size 14px / font-medium).
 * Tabs use px-3.5 (14px each side) + approx 7.5px per char at text-sm.
 * This is used only as the first-pass estimate — real widths are measured
 * from the DOM once the bar has rendered.
 */
const CHAR_WIDTH_EST = 7.5
const TAB_PADDING_EST = 28 // px-3.5 = 14px each side

/** Width reserved for the More button (text + gap + chevron, px). */
const MORE_BTN_WIDTH = 72

/** Gap between each tab (gap-1.5 = 6px). */
const TAB_GAP = 6

/** Move `dragId` to sit where `targetId` currently is in the list. */
function moveTo(order: TabId[], dragId: TabId, targetId: TabId): TabId[] {
  if (dragId === targetId) return order
  const without = order.filter((id) => id !== dragId)
  const idx = without.indexOf(targetId)
  if (idx === -1) return order
  return [...without.slice(0, idx), dragId, ...without.slice(idx)]
}

/** Estimate px width for a tab label. */
function estimateTabWidth(id: TabId): number {
  return TAB_LABELS[id].length * CHAR_WIDTH_EST + TAB_PADDING_EST
}

export function TabBar() {
  // Subscribe to just the slices we need (re-renders only on change).
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const tabOrder = useUiStore((s) => s.tabOrder)
  const setTabOrder = useUiStore((s) => s.setTabOrder)
  const moreManual = useUiStore((s) => s.moreManual)
  const setMoreManual = useUiStore((s) => s.setMoreManual)

  // Vow guard — when a vow is active, navigating away from 'tasks' is intercepted.
  const vow = useVowStore((s) => s.vow)
  const [pendingTab, setPendingTab] = useState<TabId | null>(null)

  /**
   * Central navigation guard. Both the tab-button click path and the overflow
   * menu path route through here. If a vow is active and the destination is
   * neither the current tab nor the protected 'tasks' tab, we show the
   * interstitial instead of switching immediately.
   */
  function requestTab(id: TabId) {
    if (vow && id !== 'tasks' && id !== activeTab) {
      setPendingTab(id)
    } else {
      setActiveTab(id)
    }
  }

  // Resolve the canonical order: persisted order + forward-compat append.
  const known = new Set(DEFAULT_TAB_ORDER)
  const order: TabId[] = [
    ...tabOrder.filter((id) => known.has(id)),
    ...DEFAULT_TAB_ORDER.filter((id) => !tabOrder.includes(id)),
  ]

  // ── Responsive overflow measurement ──────────────────────────────────────
  /**
   * `autoOverflow` is the set of tabs that don't fit based on measured/estimated
   * widths. It is DERIVED (computed from `availableWidth` + `order`) — never
   * stored in the store. `moreManual` is the user-pinned set (store-persisted).
   * The union of both sets = what goes into More.
   */
  const barRef = useRef<HTMLElement | null>(null)
  const tabWidthsRef = useRef<Partial<Record<TabId, number>>>({})
  const [availableWidth, setAvailableWidth] = useState<number>(0)

  // ResizeObserver keeps availableWidth up-to-date.
  const observerRef = useRef<ResizeObserver | null>(null)
  const barCallbackRef = useCallback((node: HTMLElement | null) => {
    barRef.current = node
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (node) {
      const measure = () => {
        // Available width = total bar width minus right-side controls reserve.
        // ThemeSwitcher + SettingsMenu take ~88px; we subtract that plus an extra 8px gap.
        const total = node.getBoundingClientRect().width
        setAvailableWidth(total - 96)
      }
      measure()
      const ro = new ResizeObserver(measure)
      ro.observe(node)
      observerRef.current = ro
    }
  }, [])

  // After first render, snapshot real tab widths from the DOM so subsequent
  // re-computes are exact rather than estimated.
  useEffect(() => {
    if (!barRef.current) return
    const buttons = barRef.current.querySelectorAll<HTMLElement>('[data-tabid]')
    buttons.forEach((btn) => {
      const id = btn.dataset.tabid as TabId
      if (id) tabWidthsRef.current[id] = btn.getBoundingClientRect().width
    })
  })

  /**
   * Compute which tabs auto-overflow (won't fit on bar at `availableWidth`).
   * - moreManual tabs are excluded from the bar regardless (counted separately).
   * - We always reserve MORE_BTN_WIDTH if any tab will be in More.
   */
  const moreManualSet = new Set(moreManual)

  // Tabs eligible for the bar (not manually forced to More).
  const eligible = order.filter((id) => !moreManualSet.has(id))

  const autoOverflowSet = new Set<TabId>()
  if (availableWidth > 0) {
    // Reserve More button width if there are any manually-pinned tabs OR if
    // we'll auto-overflow anything — we'll determine this iteratively.
    let reserved = moreManual.length > 0 ? MORE_BTN_WIDTH + TAB_GAP : 0
    let used = reserved

    for (const id of eligible) {
      const w = tabWidthsRef.current[id] ?? estimateTabWidth(id)
      const withGap = used === reserved ? w : w + TAB_GAP
      if (used + withGap > availableWidth) {
        // From this tab onwards, all go to auto-overflow.
        // Check if we need to reserve More button space for the first time.
        if (reserved === 0) {
          // Need to add More button reservation — recalculate from scratch.
          reserved = MORE_BTN_WIDTH + TAB_GAP
          used = reserved
          // Re-scan from beginning with the new reservation.
          for (const id2 of eligible) {
            autoOverflowSet.delete(id2) // clear previous passes
            const w2 = tabWidthsRef.current[id2] ?? estimateTabWidth(id2)
            const wg2 = used === reserved ? w2 : w2 + TAB_GAP
            if (used + wg2 > availableWidth) {
              // This and all remaining go to overflow.
              for (let k = eligible.indexOf(id2); k < eligible.length; k++) {
                autoOverflowSet.add(eligible[k])
              }
              break
            }
            used += wg2
          }
        } else {
          // Already reserved space — from id onwards to More.
          for (let k = eligible.indexOf(id); k < eligible.length; k++) {
            autoOverflowSet.add(eligible[k])
          }
        }
        break
      }
      used += withGap
    }
  }

  // Final split: primary = on bar, overflow = in More.
  const primary = order.filter(
    (id) => !moreManualSet.has(id) && !autoOverflowSet.has(id)
  )
  const overflow = order.filter(
    (id) => moreManualSet.has(id) || autoOverflowSet.has(id)
  )
  const overflowActive = overflow.includes(activeTab)

  // ── Drag state ────────────────────────────────────────────────────────────
  const dragId = useRef<TabId | null>(null)
  /** Where the drag originated — 'bar' or 'more'. */
  const dragSource = useRef<'bar' | 'more'>('bar')
  const [overId, setOverId] = useState<TabId | null>(null)
  /** When dragging over the More button itself (to pin a bar tab into More). */
  const [overMore, setOverMore] = useState(false)
  /**
   * Bar insertion placeholder: the index in `primary` where the dragged tab
   * would be inserted. null = no drag in progress on the bar.
   * The placeholder renders as a slim vertical marker BEFORE the tab at this index
   * (or AFTER the last tab when equal to primary.length).
   */
  const [dragOverBarIndex, setDragOverBarIndex] = useState<number | null>(null)

  function clearBarDrag() {
    setDragOverBarIndex(null)
    setOverId(null)
  }

  function onBarDrop(targetId: TabId) {
    const d = dragId.current
    if (!d) return
    if (dragSource.current === 'more') {
      // Dragged out of More → bar: remove from moreManual (if present), move in order.
      setMoreManual(moreManual.filter((id) => id !== d))
      setTabOrder(moveTo(order, d, targetId))
    } else {
      // Bar → bar reorder.
      setTabOrder(moveTo(order, d, targetId))
    }
    dragId.current = null
    clearBarDrag()
  }

  /** Drop on the More button → pin the bar tab into More. */
  function onMoreDrop() {
    const d = dragId.current
    if (!d || dragSource.current === 'more') return
    if (!moreManualSet.has(d)) {
      setMoreManual([...moreManual, d])
    }
    dragId.current = null
    setOverMore(false)
  }

  /** Drop within the More list → reorder inside More (no unpin). */
  function onMoreItemDrop(targetId: TabId) {
    const d = dragId.current
    if (!d) return
    if (dragSource.current === 'bar') {
      // Dragged from bar to a specific More item slot → pin at that position.
      const newManual = moreManualSet.has(d) ? moreManual : [...moreManual, d]
      setMoreManual(newManual)
      setTabOrder(moveTo(order, d, targetId))
    } else {
      // More → More reorder.
      setTabOrder(moveTo(order, d, targetId))
    }
    dragId.current = null
    setOverId(null)
  }

  // ── More dropdown ─────────────────────────────────────────────────────────
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!moreOpen) return
    function onDown(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  function selectTab(id: TabId) {
    requestTab(id)
    setMoreOpen(false)
  }

  /** Unpin a tab from moreManual so it can flow back to the bar. */
  function unpinFromMore(id: TabId) {
    setMoreManual(moreManual.filter((m) => m !== id))
  }

  // More is always rendered (even when empty) so it's always a valid drop target.
  // We keep `showMore` for legacy reference — it's no longer used as a gate.

  return (
    <nav
      ref={barCallbackRef}
      role="tablist"
      aria-label="Main navigation"
      className="panel-bar flex h-14 items-center gap-1.5 border-b border-line bg-base px-5"
    >
      {primary.map((id, idx) => {
        const isActive = id === activeTab
        const isBeingDragged = id === dragId.current
        // Show a leading insertion marker before this tab when the placeholder
        // index equals this tab's index (and we're dragging something else).
        const showInsertBefore =
          dragOverBarIndex === idx && dragId.current !== null && !isBeingDragged
        // Show a trailing insertion marker after the last tab.
        const showInsertAfter =
          idx === primary.length - 1 &&
          dragOverBarIndex === primary.length &&
          dragId.current !== null
        return (
          <div
            key={id}
            className="relative flex shrink-0 items-center"
          >
            {/* Leading insertion placeholder — thin vertical sky bar */}
            {showInsertBefore && (
              <span
                aria-hidden
                className="mr-0.5 h-7 w-[3px] shrink-0 rounded-full bg-sky"
              />
            )}
            <button
              data-tabid={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              draggable
              onClick={() => requestTab(id)}
              onDragStart={() => {
                dragId.current = id
                dragSource.current = 'bar'
                setDragOverBarIndex(null)
              }}
              onDragEnd={() => {
                dragId.current = null
                clearBarDrag()
                setOverMore(false)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setOverId(id)
                // Determine insert-before or insert-after by pointer x position.
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const mid = rect.left + rect.width / 2
                setDragOverBarIndex(e.clientX < mid ? idx : idx + 1)
              }}
              onDrop={(e) => { e.preventDefault(); onBarDrop(id) }}
              className={
                'relative flex h-14 items-center px-3.5 text-sm transition-colors cursor-grab active:cursor-grabbing ' +
                (isActive
                  ? 'font-semibold text-emerald'
                  : 'font-medium text-muted hover:text-ink')
              }
              title="Click to switch · drag to reorder · drag to More to pin"
            >
              {TAB_LABELS[id]}
              {/* Active-tab underline — 2.5px accent bar, inset from the edges. */}
              {isActive && (
                <span className="absolute inset-x-3 bottom-0 h-[2.5px] rounded-t bg-emerald" />
              )}
            </button>
            {/* Trailing insertion placeholder — after the last tab */}
            {showInsertAfter && (
              <span
                aria-hidden
                className="ml-0.5 h-7 w-[3px] shrink-0 rounded-full bg-sky"
              />
            )}
          </div>
        )
      })}

      {/* "More ▾" overflow — always rendered so it's always a valid drop target.
          When empty it shows "No hidden tabs" in the dropdown. The button stays
          visually subordinate (text-faint) when there's nothing hidden, so it
          doesn't look like a normal tab. When overMore during a drag it shows a
          full sky-tinted "Drop to hide" affordance so the user clearly sees
          where the tab will land. */}
      <div ref={moreRef} className="relative shrink-0">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
          onDragOver={(e) => { e.preventDefault(); setOverMore(true) }}
          onDragLeave={() => setOverMore(false)}
          onDrop={(e) => { e.preventDefault(); onMoreDrop() }}
          className={
            'relative flex h-14 items-center gap-1 px-2.5 text-sm font-medium transition-colors ' +
            (overMore
              ? 'bg-sky/15 text-sky ring-1 ring-inset ring-sky/40 '
              : overflowActive
                ? 'text-emerald '
                : overflow.length > 0
                  ? 'text-faint hover:text-ink '
                  : 'text-faint/50 hover:text-faint ')
          }
          title={
            overMore
              ? 'Drop here to hide this tab'
              : overflow.length > 0
                ? 'More views · drop a tab here to pin it'
                : 'No hidden tabs · drop a tab here to hide it'
          }
        >
          {overMore ? (
            // Live drop-to-hide affordance: label changes so intent is unmistakable.
            <>
              Hide here
              <span aria-hidden className="text-[10px] leading-none">▾</span>
            </>
          ) : (
            <>
              More
              <span aria-hidden className="text-[10px] leading-none">▾</span>
            </>
          )}
          {overflowActive && !overMore && (
            <span className="absolute inset-x-3 bottom-0 h-[2.5px] rounded-t bg-emerald" />
          )}
        </button>

        {moreOpen && (
          <div
            role="menu"
            className="absolute left-1 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-line bg-surface p-1.5 shadow-lg"
          >
            {overflow.length === 0 ? (
              /* Empty-state row — shown when no tabs are hidden */
              <div className="flex items-center px-3 py-2.5 text-sm text-faint/60">
                <span aria-hidden className="mr-2 text-xs">▾</span>
                No hidden tabs — drag a tab here to hide it
              </div>
            ) : (
              overflow.map((id) => {
                const isActive = id === activeTab
                const isPinned = moreManualSet.has(id)
                const isItemOver = id === overId && dragId.current !== id
                return (
                  <div
                    key={id}
                    className={
                      'group flex items-center rounded-lg transition-colors ' +
                      (isItemOver ? 'bg-sky/10 ' : '')
                    }
                    onDragOver={(e) => { e.preventDefault(); setOverId(id) }}
                    onDrop={(e) => { e.preventDefault(); onMoreItemDrop(id) }}
                  >
                    {/* Drag handle inside More — grab to drag out onto bar */}
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation()
                        dragId.current = id
                        dragSource.current = 'more'
                      }}
                      onDragEnd={() => { dragId.current = null; setOverId(null) }}
                      className="flex h-9 cursor-grab items-center pl-2 pr-1 text-faint hover:text-ink active:cursor-grabbing"
                      title="Drag to bar to unpin"
                      aria-label={`Drag ${TAB_LABELS[id]} to bar`}
                    >
                      ⠿
                    </span>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => selectTab(id)}
                      className={
                        'flex h-9 flex-1 items-center px-2 text-left text-sm transition-colors ' +
                        (isActive
                          ? 'font-semibold text-emerald'
                          : 'font-medium text-ink/80 hover:text-ink')
                      }
                    >
                      {TAB_LABELS[id]}
                    </button>
                    {/* Unpin button — only for manually pinned tabs */}
                    {isPinned && (
                      <button
                        type="button"
                        onClick={() => unpinFromMore(id)}
                        className="flex h-9 items-center px-2 text-xs text-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                        title="Move back to bar"
                        aria-label={`Unpin ${TAB_LABELS[id]} from More`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Theme + light/dark switcher, pushed to the far right (ml-auto inside). */}
      <ThemeSwitcher />

      {/* Global settings menu (⚙) — sits at the far-right corner. */}
      <SettingsMenu />

      {/* Vow interstitial — shown when a vow is active and the user clicks a non-task tab. */}
      {pendingTab !== null && (
        <VowInterstitial pendingTab={pendingTab} onClose={() => setPendingTab(null)} />
      )}
    </nav>
  )
}

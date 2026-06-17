'use client'

/**
 * BoxBoard — the shared draggable/resizable "box" primitive for every tab.
 *
 * Extracted from PursuitsMosaic so that EVERY tab's elements behave like the
 * Pursuits box: each pane is a free-floating card you can
 *   • MOVE by grabbing its own title bar (the element tags its header with the
 *     `box-drag-handle` class — see BOX_DRAG_HANDLE; no grip icon, so every
 *     button/checkbox inside the box stays clickable), and
 *   • RESIZE by dragging ANY side or corner (the side handles are stretched to
 *     span the whole edge, so you can grab anywhere along a side).
 *
 * Built on `react-grid-layout` with `noCompactor`, so boxes stay exactly where
 * you drop them (no snap-back). The {x,y,w,h} layout is persisted to the SQLite
 * AppSetting table via the `settings` router under `storageKey`, and restored on
 * load. A missing/corrupt value — or one whose pane ids no longer match the
 * current panes — falls back to `defaultLayout`.
 *
 * Each consumer passes its panes + a default layout; one BoxBoard renders per
 * tab (page.tsx mounts only the active tab), so the scoped <style> block below
 * never collides across tabs.
 */

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import GridLayout, {
  useContainerWidth,
  noCompactor,
  type Layout,
  type ResizeHandleAxis,
} from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { trpc } from '@/lib/trpc/client'
import { useUiStore } from '@/stores/uiStore'

/** CSS class an element puts on its title bar to make it the drag handle. */
export const BOX_DRAG_HANDLE = 'box-drag-handle'

const COLS = 12
const ROW_HEIGHT = 40

// ── Custom resize handle ─────────────────────────────────────────────────────
// We render our OWN resize-handle element instead of relying on react-grid-
// layout's default ones. The default handles inherit `top/right/bottom/left`
// insets from the bundled stylesheet; combined with our size overrides they got
// over-constrained (e.g. a "north" handle ended up with BOTH top:0 and bottom:0,
// so it stretched to the FULL box height and swallowed every click → the box was
// unusable). By giving each handle ALL FOUR insets explicitly inline, the
// cascade can't over-constrain it: every handle is a thin strip on exactly one
// edge (or a small square at a corner), leaving the whole interior clickable.
// The `react-resizable-handle` class is kept ONLY so RGL's drag `cancel`
// selector still stops a move-drag from starting when you grab a resize edge.

const ALL_HANDLES: readonly ResizeHandleAxis[] = ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne']

/** Edge strip thickness / corner square size, in px. */
const EDGE = 10
const CORNER = 18

const HANDLE_BASE: CSSProperties = {
  position: 'absolute',
  margin: 0,
  padding: 0,
  background: 'transparent',
  opacity: 1,
  transform: 'none',
  zIndex: 3,
  touchAction: 'none',
  // The pane wrapper carries `[&>*]:min-h-full` to stretch its CONTENT; that
  // utility also targets these handles (they're direct children of the grid
  // item too) and would force min-height:100%, blowing every strip up to the
  // full box height. Reset it inline (wins over the class) so our thin EDGE
  // heights hold and the box interior stays clickable.
  minHeight: 0,
  minWidth: 0,
}

// Per-axis placement. CRUCIAL: anchor every handle from a SINGLE corner (one
// vertical + one horizontal inset) and give BOTH width and height explicitly.
// We never pin opposite insets (top+bottom or left+right) and use no `auto`
// values — doing either lets the base react-resizable stylesheet's 20px size
// win the over-constraint, or makes React/Chromium collapse the insets into a
// buggy `inset` shorthand. Both failure modes blew a handle up to the full box
// and made the whole box act as a resize target (every click resized it).
//   • n/s : top/bottom:0 + width:100% + height:EDGE → a thin full-width strip
//   • w/e : top + left/right:0 + width:EDGE + height:100% → a thin full-height strip
//   • corners: the two meeting edges + a small CORNER square
const FULL = '100%'
const HANDLE_AXIS: Record<ResizeHandleAxis, CSSProperties> = {
  n:  { top: 0, left: 0, width: FULL, height: EDGE, cursor: 'ns-resize' },
  s:  { bottom: 0, left: 0, width: FULL, height: EDGE, cursor: 'ns-resize' },
  w:  { top: 0, left: 0, width: EDGE, height: FULL, cursor: 'ew-resize' },
  e:  { top: 0, right: 0, width: EDGE, height: FULL, cursor: 'ew-resize' },
  nw: { top: 0, left: 0, width: CORNER, height: CORNER, cursor: 'nwse-resize', zIndex: 4 },
  ne: { top: 0, right: 0, width: CORNER, height: CORNER, cursor: 'nesw-resize', zIndex: 4 },
  sw: { bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: 'nesw-resize', zIndex: 4 },
  se: { bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: 'nwse-resize', zIndex: 4 },
}

/** RGL/react-resizable hands us (axis, ref); we return the handle node. */
function boxResizeHandle(axis: ResizeHandleAxis, ref: Ref<HTMLElement>) {
  return (
    <span
      ref={ref as Ref<HTMLSpanElement>}
      className={`react-resizable-handle react-resizable-handle-${axis}`}
      style={{ ...HANDLE_BASE, ...HANDLE_AXIS[axis] }}
    />
  )
}

export interface BoxPane {
  /** Stable id — must match an `i` in defaultLayout. */
  key: string
  /** The element rendered inside the box. */
  node: ReactNode
  /**
   * Human label shown in the dock tooltip (and used for the fallback glyph when
   * no `icon` is given). Defaults to the key.
   */
  title?: string
  /**
   * Small glyph shown in the left dock while this box is minimized. Render at
   * ~18px, `stroke="currentColor"` / `fill` to inherit the dock colour. When
   * omitted, the dock shows the first letter of `title`.
   */
  icon?: ReactNode
  /**
   * When true the box's HEIGHT tracks its content instead of being manually
   * resizable: BoxBoard measures the pane and sets the grid item's row-span to
   * fit, so the box grows/shrinks as content is added/removed. Such a pane is
   * also marked non-resizable (no edge handles → nothing overlaps controls at
   * the box's bottom). You can still move it by its drag handle. Width stays
   * whatever the layout gives it. Used by the habit tracker.
   */
  autoHeight?: boolean
}

export interface BoxBoardProps {
  /** AppSetting key the layout JSON persists under (unique per tab). */
  storageKey: string
  panes: BoxPane[]
  /** Initial {i,x,y,w,h,minW,minH} — one entry per pane key. */
  defaultLayout: Layout
  cols?: number
  rowHeight?: number
  /**
   * Pane keys that start MINIMIZED on first load (when nothing is saved yet).
   * Used by the dashboard to open empty — every element parked in the dock until
   * the user opens it. Defaults to none (all panes visible).
   */
  defaultMinimized?: string[]
  /**
   * Dock behaviour:
   *   • 'minimized' (default) — the left rail shows ONLY minimized boxes and
   *     disappears when empty (the original behaviour every tab uses).
   *   • 'persistent' — the rail ALWAYS shows every pane's icon (open or not).
   *     Clicking an icon toggles that box open ⇄ minimized, and the icons can be
   *     dragged to reorder. Used by the dashboard.
   */
  dockMode?: 'minimized' | 'persistent'
  /**
   * Ordered groups for the persistent dock — sets the initial icon order and
   * draws a thin divider between groups (e.g. one group per source tab). Ignored
   * when dockMode is 'minimized'.
   */
  dockGroups?: { id: string; paneKeys: string[] }[]
  /**
   * Whether boxes can be moved/resized right now. When false the board is LOCKED:
   * drag + resize are disabled and the minimize dot is hidden, so every box sits
   * fixed in its saved place and its content is fully interactive (type, scroll,
   * select) with no stray controls. Flip it true for an "arrange mode". Defaults
   * to true so every existing consumer keeps the original always-arrangeable
   * behaviour. The saved layout is still rendered either way.
   */
  arrangeMode?: boolean
}

/** Geometry remembered for a box so a later restore can rebuild its layout entry. */
type Geom = { w: number; h: number; minW?: number; minH?: number }

/** Persisted board state. v2 adds the minimized list; v1 was a bare Layout.
 *  v3 adds the persistent-dock icon order (dashboard only). */
interface BoardState {
  layout: Layout
  minimized: string[]
  dockOrder?: string[]
}

/** Do two grid rectangles overlap? (touching edges do NOT count as overlap.) */
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Find the HIGHEST (smallest-y, then smallest-x) free slot for a w×h box that
 * doesn't overlap any box already on the board. Scans row by row from the top —
 * this is what makes a restored box pop in "at the highest possible place
 * without overlapping" rather than snapping back to where it was minimized from.
 */
function findHighestFreeSlot(layout: Layout, w: number, h: number, cols: number): { x: number; y: number } {
  const width = Math.min(w, cols)
  const maxY = layout.reduce((m, it) => Math.max(m, it.y + it.h), 0) + h + 1
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= cols - width; x++) {
      const candidate = { x, y, w: width, h }
      if (!layout.some((it) => rectsOverlap(candidate, it))) return { x, y }
    }
  }
  // Fallback: stack below everything.
  return { x: 0, y: maxY }
}

export function BoxBoard({
  storageKey,
  panes,
  defaultLayout,
  cols = COLS,
  rowHeight = ROW_HEIGHT,
  defaultMinimized,
  dockMode = 'minimized',
  dockGroups,
  arrangeMode = true,
}: BoxBoardProps) {
  const { width, mounted, containerRef } = useContainerWidth()

  const [layout, setLayout] = useState<Layout | null>(null)
  const [minimized, setMinimized] = useState<string[]>([])
  const [dockOrder, setDockOrder] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)
  const latest = useRef<Layout>(defaultLayout)
  const minRef = useRef<string[]>([])
  const dockOrderRef = useRef<string[]>([])
  // Last-known geometry per pane (updated on every layout change) so a box that
  // was resized before being minimized restores at the SIZE it had, not the
  // default. Seeded from defaultLayout at hydrate time.
  const geomRef = useRef<Record<string, Geom>>({})

  const paneKeys = panes.map((p) => p.key)
  const paneByKey = new Map(panes.map((p) => [p.key, p]))
  // Panes whose height tracks their content (see BoxPane.autoHeight).
  const autoKeys = new Set(panes.filter((p) => p.autoHeight).map((p) => p.key))

  // Persistent-dock helpers: the initial icon order (groups flattened, else the
  // pane order) and a key→group lookup used to draw dividers between groups.
  const initialDockOrder = dockGroups ? dockGroups.flatMap((g) => g.paneKeys) : paneKeys
  const groupOf = new Map<string, string>()
  if (dockGroups) for (const g of dockGroups) for (const k of g.paneKeys) groupOf.set(k, g.id)

  /** Keep the saved dock order valid: drop unknown keys, append any new panes. */
  function reconcileDockOrder(saved?: string[]): string[] {
    const known = new Set(paneKeys)
    const kept = (saved ?? []).filter((k) => known.has(k))
    const missing = initialDockOrder.filter((k) => !kept.includes(k))
    return [...kept, ...missing]
  }

  /**
   * Keep every box inside the visible grid: cap its width to the column count
   * (so resizing an edge can't stretch it wider than the board → no horizontal
   * overflow / off-screen sliding) and clamp its x so it never starts past the
   * right edge. `maxW` is (re-)stamped so the library's minMaxSize constraint
   * enforces the width cap on every later resize too.
   */
  function sanitize(l: Layout): Layout {
    return l.map((it) => {
      const w = Math.min(Math.max(it.w, it.minW ?? 1), cols)
      const x = Math.min(Math.max(it.x, 0), Math.max(0, cols - w))
      // Auto-height panes manage their own row-span and expose no resize handles,
      // so their bottom edge never overlaps controls inside the box.
      const auto = autoKeys.has(it.i) ? { isResizable: false } : null
      return { ...it, w, x, maxW: cols, ...auto }
    })
  }

  /** True iff every entry has numeric x/y/w/h. */
  function validLayout(value: unknown): value is Layout {
    return (
      Array.isArray(value) &&
      value.every((it) =>
        it != null &&
        typeof (it as { i?: unknown }).i === 'string' &&
        (['x', 'y', 'w', 'h'] as const).every(
          (p) => typeof (it as Record<string, unknown>)[p] === 'number',
        ),
      )
    )
  }

  /**
   * Parse the persisted value into {layout, minimized}. Accepts the v2 object
   * `{layout, minimized}` and the legacy v1 bare Layout array. Returns null
   * (→ fall back to default) unless the union of laid-out + minimized ids is
   * EXACTLY the current pane set — so adding/removing a pane safely resets.
   */
  function parseSaved(value: unknown): BoardState | null {
    let layout: Layout | null = null
    let mins: string[] = []
    let dockOrder: string[] | undefined
    if (validLayout(value)) {
      layout = value
    } else if (value && typeof value === 'object' && validLayout((value as BoardState).layout)) {
      layout = (value as BoardState).layout
      const m = (value as BoardState).minimized
      if (Array.isArray(m) && m.every((k) => typeof k === 'string')) mins = m
      const d = (value as BoardState).dockOrder
      if (Array.isArray(d) && d.every((k) => typeof k === 'string')) dockOrder = d
    }
    if (!layout) return null
    const covered = [...layout.map((it) => it.i), ...mins]
    const ok =
      covered.length === paneKeys.length &&
      paneKeys.every((k) => covered.includes(k)) &&
      mins.every((k) => paneKeys.includes(k))
    return ok ? { layout, minimized: mins, dockOrder } : null
  }

  const saved = trpc.settings.get.useQuery(
    { key: storageKey },
    { staleTime: Infinity, retry: false },
  )
  const setSetting = trpc.settings.set.useMutation()
  const utils = trpc.useUtils()

  // Seed the layout + minimized set once, when the saved value resolves.
  useEffect(() => {
    if (hydrated || saved.isLoading) return
    // Default: every defaultMinimized pane is parked in the dock; the rest are
    // laid out. (The dashboard starts with EVERY pane minimized → empty canvas.)
    const defMin = (defaultMinimized ?? []).filter((k) => paneKeys.includes(k))
    const defMinSet = new Set(defMin)
    let state: BoardState = {
      layout: defaultLayout.filter((it) => !defMinSet.has(it.i)),
      minimized: defMin,
    }
    if (saved.data) {
      try {
        const parsed = parseSaved(JSON.parse(saved.data))
        if (parsed) state = parsed
      } catch {
        /* corrupt/legacy value → default */
      }
    }
    // Seed geometry from defaults first (covers minimized panes), then overlay
    // the saved/visible sizes.
    const geom: Record<string, Geom> = {}
    for (const it of defaultLayout) geom[it.i] = { w: it.w, h: it.h, minW: it.minW, minH: it.minH }
    const safe = sanitize(state.layout)
    for (const it of safe) geom[it.i] = { w: it.w, h: it.h, minW: it.minW, minH: it.minH }
    geomRef.current = geom
    setLayout(safe)
    latest.current = safe
    setMinimized(state.minimized)
    minRef.current = state.minimized
    const order = reconcileDockOrder(state.dockOrder)
    setDockOrder(order)
    dockOrderRef.current = order
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, saved.isLoading, saved.data])

  function persist() {
    const value: BoardState = {
      layout: latest.current,
      minimized: minRef.current,
      dockOrder: dockOrderRef.current,
    }
    const json = JSON.stringify(value)
    setSetting.mutate({ key: storageKey, value: json })
    // Write the new value straight into the query cache too. Without this the
    // cached layout stays stale (the query has staleTime:Infinity and never
    // refetches), so switching tabs and back would remount with the OLD sizes
    // until a full reload. Updating the cache makes resizes survive tab switches.
    utils.settings.get.setData({ key: storageKey }, json)
  }

  /** Persist a new persistent-dock icon order (after a drag-reorder). */
  function reorderDock(next: string[]) {
    setDockOrder(next)
    dockOrderRef.current = next
    persist()
  }

  /** Pull a box out of the grid and park its icon in the left dock. */
  function minimize(key: string) {
    const next = (latest.current ?? []).filter((it) => it.i !== key)
    setLayout(next)
    latest.current = next
    const nextMin = minRef.current.includes(key) ? minRef.current : [...minRef.current, key]
    setMinimized(nextMin)
    minRef.current = nextMin
    persist()
  }

  /** Bring a minimized box back at the highest free slot, then save. */
  function restore(key: string) {
    const current = latest.current ?? []
    const g = geomRef.current[key] ??
      defaultLayout.find((it) => it.i === key) ?? { w: 4, h: 6 }
    const slot = findHighestFreeSlot(current, g.w, g.h, cols)
    const item: Layout[number] = {
      i: key, x: slot.x, y: slot.y, w: g.w, h: g.h,
      minW: g.minW, minH: g.minH, maxW: cols,
    }
    const next = sanitize([...current, item])
    setLayout(next)
    latest.current = next
    const nextMin = minRef.current.filter((k) => k !== key)
    setMinimized(nextMin)
    minRef.current = nextMin
    persist()
  }

  // ── Auto-height: size an auto-height pane's box to its content ─────────────
  // A measured content height (px) is converted to a grid row-span and written
  // back to that item's `h`. RGL row maths: an item of `h` rows is
  //   h * rowHeight + (h - 1) * marginY  px tall  (marginY = 16, see margin below),
  // so to FIT `px` we need h = ceil((px + marginY) / (rowHeight + marginY)).
  // This is derived state (recomputed from content on every mount), so we update
  // the live layout but deliberately do NOT persist it.
  const MARGIN_Y = 16
  const onAutoPx = useCallback(
    (key: string, px: number) => {
      const cur = latest.current ?? []
      const it = cur.find((i) => i.i === key)
      if (!it) return
      const minRows = it.minH ?? 3
      const rows = Math.max(minRows, Math.ceil((px + MARGIN_Y) / (rowHeight + MARGIN_Y)))
      if (it.h === rows) return
      const next = cur.map((i) => (i.i === key ? { ...i, h: rows } : i))
      latest.current = next
      setLayout(next)
      geomRef.current[key] = { w: it.w, h: rows, minW: it.minW, minH: it.minH }
    },
    [rowHeight],
  )

  // ── Drag-to-dock minimize (alternative to the corner dot) ──────────────────
  // When uiStore.minimizeMode is 'drag', dragging a box so any part of it
  // overlaps the left rail and releasing there minimizes it. We watch the live
  // drag via the grid's onDrag/onDragStop callbacks (they hand us the dragged
  // DOM element) and compare its rect to the rail's rect.
  const minimizeMode = useUiStore((s) => s.minimizeMode)
  const dragToDock = minimizeMode === 'drag'
  const [dragging, setDragging] = useState(false)
  const [overDock, setOverDock] = useState(false)
  const dockRef = useRef<HTMLDivElement | null>(null)

  /** True iff the box element's rect overlaps the left rail's rect. */
  function elementOverDock(el: HTMLElement | null): boolean {
    const dock = dockRef.current
    if (!el || !dock) return false
    const a = el.getBoundingClientRect()
    const b = dock.getBoundingClientRect()
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  }

  const visiblePanes = panes.filter((p) => !minimized.includes(p.key))
  const dockItems = minimized
    .map((key) => paneByKey.get(key))
    .filter((p): p is BoxPane => p != null)

  return (
    <div className="box-board-wrap flex w-full items-start gap-3 overflow-x-clip">
      {dockMode === 'persistent' ? (
        <PersistentDock
          railRef={dockRef}
          order={dockOrder}
          paneByKey={paneByKey}
          groupOf={groupOf}
          minimized={minimized}
          onToggle={(key) => (minimized.includes(key) ? restore(key) : minimize(key))}
          onReorder={reorderDock}
          dropActive={overDock}
        />
      ) : (
        <BoxDock
          railRef={dockRef}
          items={dockItems}
          onRestore={restore}
          dragMode={dragToDock}
          dragging={dragging}
          dropActive={overDock}
        />
      )}
      {/* During a drag-to-dock drag we drop the board's horizontal clip so the
          box can visibly slide left over the rail; the wrap's overflow-x-clip
          still stops it from spilling past the rail and scrolling the page. */}
      <div
        ref={containerRef}
        className={`box-board min-w-0 flex-1 ${dragging && dragToDock ? '' : 'overflow-x-hidden'}`}
      >
        <GridStyles />
        {hydrated && layout && mounted ? (
          <GridLayout
            width={width}
            layout={layout}
            compactor={noCompactor}
            gridConfig={{
              cols,
              rowHeight,
              margin: [16, 16],
              containerPadding: [0, 0],
            }}
            // Drag only from a `.box-drag-handle`; 4px threshold tells click from drag.
            // `enabled` is the lock switch: false (arrangeMode off) freezes every box.
            dragConfig={{ handle: `.${BOX_DRAG_HANDLE}`, threshold: 4, enabled: arrangeMode }}
            // Resize from any edge/corner, using our own thin-strip handles so the
            // box interior stays fully interactive (see boxResizeHandle above).
            resizeConfig={{ handles: ALL_HANDLES, handleComponent: boxResizeHandle, enabled: arrangeMode }}
            onLayoutChange={(next) => {
              const safe = sanitize(next)
              setLayout(safe)
              latest.current = safe
              for (const it of safe) geomRef.current[it.i] = { w: it.w, h: it.h, minW: it.minW, minH: it.minH }
            }}
            onDragStart={() => { if (dragToDock) setDragging(true) }}
            onDrag={(_l, _oldItem, _newItem, _ph, _e, element) => {
              if (!dragToDock) return
              const over = elementOverDock(element)
              setOverDock((prev) => (prev === over ? prev : over))
            }}
            onDragStop={(_l, oldItem, newItem, _ph, _e, element) => {
              setDragging(false)
              setOverDock(false)
              if (dragToDock && elementOverDock(element)) {
                const key = (oldItem ?? newItem)?.i
                if (key) { minimize(key); return }
              }
              persist()
            }}
            onResizeStop={persist}
          >
            {visiblePanes.map((pane) => {
              // Auto-height panes let their CONTENT define the height (BoxBoard
              // resizes the box to fit), so we don't pin/stretch the child to the
              // box or give it its own scroll — we measure it instead. Normal
              // panes keep the original behaviour: the element's root is pinned to
              // the box height and scrolls its OWN content, so the box's border
              // stays fixed even when shrunk smaller than its contents.
              // `group` + `relative` host the macOS-style minimize dot (top-left).
              const auto = autoKeys.has(pane.key)
              return (
                <div
                  key={pane.key}
                  className={
                    auto
                      ? 'group/box relative h-full w-full overflow-hidden'
                      : 'group/box relative h-full w-full overflow-hidden [&>*:last-child]:h-full [&>*:last-child]:overflow-auto'
                  }
                >
                  {arrangeMode && !dragToDock && <MinimizeDot onMinimize={() => minimize(pane.key)} />}
                  {auto ? (
                    <AutoHeightContent paneKey={pane.key} node={pane.node} onPx={onAutoPx} />
                  ) : (
                    pane.node
                  )}
                </div>
              )
            })}
          </GridLayout>
        ) : (
          <div className="flex min-h-[300px] w-full items-center justify-center text-sm text-faint">
            Loading layout…
          </div>
        )}
      </div>
    </div>
  )
}

// ── Auto-height content wrapper ──────────────────────────────────────────────

/**
 * Wraps an auto-height pane's content and reports its natural pixel height to
 * the board (via a ResizeObserver) whenever it changes — e.g. when a habit row
 * is added or removed. BoxBoard turns that height into the box's row-span. The
 * wrapper imposes no height of its own, so `scrollHeight` is the true content
 * height regardless of the (converging) box height around it.
 */
function AutoHeightContent({
  paneKey,
  node,
  onPx,
}: {
  paneKey: string
  node: ReactNode
  onPx: (key: string, px: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => onPx(paneKey, el.scrollHeight)
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [paneKey, onPx])
  return (
    <div ref={ref} className="w-full">
      {node}
    </div>
  )
}

// ── Minimize dot (macOS traffic-light, top-left of every box) ────────────────

/**
 * The single amber "minimize" dot pinned to the top-left corner of a box —
 * mirrors the yellow macOS window control. Hidden until you hover the box, then
 * fades in; clicking it parks the box in the left dock. Its own pointer-down
 * stops the event from reaching react-grid-layout so grabbing the dot never
 * starts a move-drag.
 */
function MinimizeDot({ onMinimize }: { onMinimize: () => void }) {
  return (
    <button
      type="button"
      aria-label="Minimize"
      title="Minimize"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onMinimize() }}
      className="absolute left-2 top-2 z-20 flex h-3.5 w-3.5 items-center justify-center
                 rounded-full bg-amber text-[9px] font-bold leading-none text-black/70
                 opacity-0 shadow transition-opacity duration-150
                 group-hover/box:opacity-100 hover:brightness-110 focus:opacity-100 focus:outline-none"
    >
      <span className="-mt-px opacity-0 group-hover/box:opacity-100">−</span>
    </button>
  )
}

// ── Left dock (where minimized boxes live) ───────────────────────────────────

/**
 * The vertical rail of minimized boxes on the left of the board. Renders nothing
 * when empty (so it costs no width until you actually minimize something). Each
 * tile shows the pane's icon (or the first letter of its title as a fallback);
 * clicking it restores the box at the highest free slot.
 */
function BoxDock({
  items,
  onRestore,
  dragMode,
  dragging,
  dropActive,
  railRef,
}: {
  items: BoxPane[]
  onRestore: (key: string) => void
  /** True when minimizeMode is 'drag'. */
  dragMode: boolean
  /** True while a box is actively being dragged. */
  dragging: boolean
  /** True while a dragged box overlaps the rail (highlights it). */
  dropActive: boolean
  railRef: Ref<HTMLDivElement>
}) {
  // Show the rail when something is parked there, OR (in drag mode) only while a
  // box is actively being dragged — so the empty drop target appears just in time.
  if (items.length === 0 && !(dragMode && dragging)) return null
  return (
    <div
      ref={railRef}
      className={
        'box-dock flex w-12 shrink-0 flex-col items-center gap-2 rounded-xl border p-2 transition-colors ' +
        (dropActive ? 'border-amber bg-amber/20' : 'border-faint/30 bg-surface/60')
      }
    >
      {items.map((pane) => {
        const label = pane.title ?? pane.key
        return (
          <button
            key={pane.key}
            type="button"
            title={`Restore ${label}`}
            aria-label={`Restore ${label}`}
            onClick={() => onRestore(pane.key)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-faint/40
                       bg-base text-muted transition-colors hover:border-amber hover:text-amber
                       focus:border-amber focus:text-amber focus:outline-none"
          >
            {pane.icon ?? (
              <span className="text-xs font-semibold uppercase">{label.charAt(0)}</span>
            )}
          </button>
        )
      })}
      {/* Empty drag-mode rail: a quiet hint so the drop target reads as one. */}
      {items.length === 0 && dragMode && dragging && (
        <div className="flex flex-col items-center gap-1 px-0.5 py-2 text-center text-faint">
          <span className="text-lg leading-none">⤓</span>
          <span className="text-[8px] leading-tight">drop here</span>
        </div>
      )}
    </div>
  )
}

// ── Persistent dock (always-visible, toggle + reorderable — dashboard) ───────

/**
 * The dashboard's left rail. Unlike BoxDock it shows EVERY pane's icon at all
 * times (open or minimized), grouped by source tab with a thin divider between
 * groups. Clicking an icon toggles that box open ⇄ minimized; an open box reads
 * "active" (emerald), a parked one reads muted. Icons can be dragged up/down to
 * reorder (native HTML5 drag, like the tab bar) and the order persists.
 */
function PersistentDock({
  railRef,
  order,
  paneByKey,
  groupOf,
  minimized,
  onToggle,
  onReorder,
  dropActive,
}: {
  railRef: Ref<HTMLDivElement>
  /** Pane keys in display order. */
  order: string[]
  paneByKey: Map<string, BoxPane>
  /** key → group id, for drawing dividers between groups. */
  groupOf: Map<string, string>
  /** Currently-minimized keys (everything else is open). */
  minimized: string[]
  onToggle: (key: string) => void
  onReorder: (next: string[]) => void
  /** True while a dragged box overlaps the rail (drag-to-dock highlight). */
  dropActive: boolean
}) {
  const dragKey = useRef<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)

  /** Move `drag` to sit where `target` currently is. */
  function move(list: string[], drag: string, target: string): string[] {
    if (drag === target) return list
    const without = list.filter((k) => k !== drag)
    const idx = without.indexOf(target)
    if (idx === -1) return list
    return [...without.slice(0, idx), drag, ...without.slice(idx)]
  }

  function onDrop(target: string) {
    const d = dragKey.current
    if (d) onReorder(move(order, d, target))
    dragKey.current = null
    setOverKey(null)
  }

  return (
    <div
      ref={railRef}
      className={
        'box-dock flex w-12 shrink-0 flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors ' +
        (dropActive ? 'border-amber bg-amber/20' : 'border-faint/30 bg-surface/60')
      }
    >
      {order.map((key, i) => {
        const pane = paneByKey.get(key)
        if (!pane) return null
        const open = !minimized.includes(key)
        const label = pane.title ?? pane.key
        const prev = order[i - 1]
        const divider = i > 0 && prev != null && groupOf.get(prev) !== groupOf.get(key)
        return (
          <Fragment key={key}>
            {divider && <div className="my-0.5 h-px w-6 shrink-0 bg-faint/30" />}
            <div className="group/dockicon relative shrink-0">
              <button
                type="button"
                draggable
                onClick={() => onToggle(key)}
                onDragStart={() => { dragKey.current = key }}
                onDragEnd={() => { dragKey.current = null; setOverKey(null) }}
                onDragOver={(e) => { e.preventDefault(); setOverKey(key) }}
                onDrop={(e) => { e.preventDefault(); onDrop(key) }}
                aria-label={`${open ? 'Minimize' : 'Open'} ${label}`}
                aria-pressed={open}
                className={
                  'flex h-8 w-8 cursor-grab items-center justify-center rounded-lg border transition-colors active:cursor-grabbing ' +
                  (overKey === key && dragKey.current ? 'ring-1 ring-amber ' : '') +
                  (open
                    ? 'border-emerald/60 bg-emerald/15 text-emerald'
                    : 'border-faint/40 bg-base text-muted hover:border-amber hover:text-amber')
                }
              >
                {pane.icon ?? (
                  <span className="text-xs font-semibold uppercase">{label.charAt(0)}</span>
                )}
              </button>
              {/* Name label — appears to the right on hover. */}
              <span
                className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2
                           whitespace-nowrap rounded-md border border-faint/30 bg-base px-2 py-1
                           text-xs text-ink opacity-0 shadow-lg transition-opacity
                           group-hover/dockicon:opacity-100"
              >
                {label}
              </span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

// ── Scoped theme overrides (lifted verbatim from the Pursuits box) ───────────

function GridStyles() {
  return (
    <style>{`
      .box-board .react-grid-item.react-grid-placeholder {
        background: var(--color-emerald);
        opacity: 0.10;
        border: 2px dashed var(--color-emerald);
        border-radius: 14px;
      }
      /* Our custom handles (boxResizeHandle) are styled inline; suppress the
         library's default triangle marker so the edges stay clean/invisible. */
      .box-board .react-grid-item > .react-resizable-handle::after { display: none; }
      /* Boxes (and any scroll area nested inside their content) still scroll via
         wheel/trackpad, but we hide every scrollbar UI — no visible bar on the
         right OR the bottom. Applied to the whole box subtree so nested lists/
         trees with their own overflow are covered too. */
      .box-board, .box-board * { scrollbar-width: none; }
      .box-board::-webkit-scrollbar,
      .box-board *::-webkit-scrollbar { width: 0; height: 0; display: none; }
    `}</style>
  )
}

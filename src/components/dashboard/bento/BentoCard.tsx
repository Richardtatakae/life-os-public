/**
 * BentoCard.tsx — shared chrome + small primitives for the dashboard bento.
 *
 * Every card uses <BentoCard> for its white surface, header (icon + title +
 * subtitle + optional action) and padded body. Chrome is Tailwind utilities on
 * design tokens, so it recolours per theme. The grid PLACEMENT comes from the
 * `area` class (`bento-habits` … defined in globals.css).
 *
 * Also exports the bits several cards share: <ChipButton> (the "+ Habit" style
 * header chip), <ProgressRing> (the habits/today ring) and <CardEmpty>.
 *
 * Clean-Modern redesign Phase C2.
 */

import type { ReactNode } from 'react'

interface BentoCardProps {
  /** Grid-placement class from globals.css: 'bento-habits' | 'bento-plan' | … */
  area: string
  icon: ReactNode
  title: string
  /** Small subtitle under the title (e.g. "5 blocks · 3 left"). */
  sub?: ReactNode
  /** Right-aligned header control (e.g. a "+ Block" chip). */
  action?: ReactNode
  className?: string
  children: ReactNode
}

export function BentoCard({ area, icon, title, sub, action, className = '', children }: BentoCardProps) {
  return (
    <section
      className={`${area} flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-line bg-surface shadow-sm ${className}`}
    >
      <header className="flex items-center gap-2.5 px-5 pb-3 pt-4">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-surface-2 text-muted">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15.5px] font-bold leading-tight tracking-tight text-ink">{title}</h2>
          {sub != null && <div className="mt-0.5 truncate text-[12.5px] leading-tight text-faint">{sub}</div>}
        </div>
        {action != null && <div className="shrink-0">{action}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-0.5">{children}</div>
    </section>
  )
}

export function ChipButton({
  onClick,
  children,
  title,
}: {
  onClick?: () => void
  children: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  )
}

export function ProgressRing({
  value,
  size = 64,
  stroke = 7,
  color = 'var(--color-emerald)',
  children,
}: {
  value: number
  size?: number
  stroke?: number
  color?: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const offset = circ * (1 - clamped)
  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      {children != null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">{children}</div>
      )}
    </div>
  )
}

export function CardEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center py-8 text-center text-[12.5px] text-faint">
      {children}
    </div>
  )
}

'use client'
import { trpc } from '@/lib/trpc/client'
import { navigateToTab } from '@/stores/uiStore'
import { todayISO } from '@/lib/lifeHabits'
import { formatWorked } from '@/lib/formatTime'
import { BentoCard } from './BentoCard'
import { FocusIcon, ArrowIcon } from './icons'

function fmt(min: number): string {
  const h = Math.floor(min / 60)
  const mm = min % 60
  return `${h < 10 ? '0' : ''}${h}:${mm < 10 ? '0' : ''}${mm}`
}

export function FocusCard() {
  const today = todayISO()
  const sessQ = trpc.pomodoro.completedForDate.useQuery({ date: today })
  const sessions = sessQ.data ?? []
  const totalMin = sessions.reduce((s, p) => s + p.durationMin, 0)

  return (
    <BentoCard
      area="bento-focus"
      icon={<FocusIcon />}
      title="Focus"
      sub={sessions.length > 0 ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} today` : 'Deep work'}
    >
      <div className="flex items-center gap-4">
        <div>
          <div className="text-[26px] font-bold leading-none tracking-tight text-ink">{formatWorked(totalMin * 60000)}</div>
          <div className="mt-1 text-[12px] text-faint">focused today</div>
        </div>
        <button
          type="button"
          onClick={() => navigateToTab('tasks')}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] font-semibold text-emerald transition-colors hover:bg-surface-2"
        >
          Start focus <ArrowIcon size={14} />
        </button>
      </div>
      {sessions.length > 0 && (
        <ul className="detail mt-3 flex flex-col border-t border-line pt-2">
          {sessions.slice(-4).reverse().map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 py-1">
              <span className="w-[42px] shrink-0 text-[11px] tabular-nums text-faint">{fmt(p.startMin)}</span>
              <span className="flex-1 truncate text-[12.5px] text-ink">{p.title ?? 'Focus session'}</span>
              <span className="text-[11px] tabular-nums text-faint">{p.durationMin}m</span>
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  )
}

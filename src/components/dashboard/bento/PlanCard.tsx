'use client'
import { useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { navigateToTab } from '@/stores/uiStore'
import { todayISO } from '@/lib/lifeHabits'
import { BentoCard, ChipButton, CardEmpty } from './BentoCard'
import { PlanIcon, PlusIcon } from './icons'

function fmt(min: number): string {
  const m = Math.round(min)
  const h = Math.floor(m / 60)
  const mm = ((m % 60) + 60) % 60
  return `${h < 10 ? '0' : ''}${h}:${mm < 10 ? '0' : ''}${mm}`
}

const energyChip: Record<string, string> = {
  high: 'bg-amber/15 text-amber',
  med: 'bg-emerald/15 text-emerald',
  low: 'bg-surface-2 text-faint',
  fun: 'bg-purple/15 text-purple',
}

export function PlanCard() {
  const today = todayISO()
  const planQ = trpc.dayPlanner.today.useQuery({ date: today })
  const blocks = useMemo(() => {
    const all = (planQ.data ?? []).filter((b) => !b.parentId)
    return [...all].sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999) || a.position - b.position)
  }, [planQ.data])
  const total = blocks.length
  const remaining = blocks.filter((b) => b.status !== 'done').length

  return (
    <BentoCard
      area="bento-plan"
      icon={<PlanIcon />}
      title="Today's Plan"
      sub={total > 0 ? `${total} block${total === 1 ? '' : 's'} · ${remaining} left` : 'Plan your day'}
      action={<ChipButton onClick={() => navigateToTab('schedule')} title="Open Schedule"><PlusIcon size={14} />Block</ChipButton>}
    >
      {planQ.isLoading ? (
        <CardEmpty>Loading…</CardEmpty>
      ) : blocks.length === 0 ? (
        <CardEmpty>No blocks planned today.</CardEmpty>
      ) : (
        <ul className="flex flex-col">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-baseline gap-2.5 py-1.5">
              <span className="w-[42px] shrink-0 text-[11.5px] tabular-nums text-faint">{b.placed && b.startMin != null ? fmt(b.startMin) : '—'}</span>
              <span className={'flex-1 truncate text-[13.5px] ' + (b.status === 'done' ? 'text-faint line-through' : 'text-ink')}>{b.title}</span>
              <span className="detail text-[11px] tabular-nums text-faint">{b.durationMin}m</span>
              <span className={'detail rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ' + (energyChip[b.energy] ?? 'bg-surface-2 text-faint')}>{b.energy}</span>
            </li>
          ))}
        </ul>
      )}
    </BentoCard>
  )
}

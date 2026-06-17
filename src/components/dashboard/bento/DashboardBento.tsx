'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { useUiStore, type Density } from '@/stores/uiStore'
import { HabitsCard } from './HabitsCard'
import { PlanCard } from './PlanCard'
import { GoalsCard } from './GoalsCard'
import { TasksCard } from './TasksCard'
import { FocusCard } from './FocusCard'
import { JournalCard } from './JournalCard'
import { WindIcon, GridIcon } from './icons'

function greetingFor(h: number): string {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardBento() {
  const density = useUiStore((s) => s.density)
  const setDensity = useUiStore((s) => s.setDensity)
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-line px-1 py-5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">Life OS</div>
          <h1 className="text-[21px] font-bold leading-tight tracking-tight text-ink">{now ? `${greetingFor(now.getHours())}` : ' '}</h1>
          <div className="mt-0.5 text-[13.5px] text-muted">{now ? `${format(now, 'EEEE, MMMM d')} · ${format(now, 'h:mm a')}` : ' '}</div>
        </div>
        <div className="ml-auto">
          <DensityToggle value={density} onChange={setDensity} />
        </div>
      </header>

      <div className="dashboard-bento py-5" data-density={density}>
        <HabitsCard />
        <PlanCard />
        <GoalsCard />
        <TasksCard />
        <FocusCard />
        <JournalCard />
      </div>
    </div>
  )
}

function DensityToggle({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  const opts: { id: Density; label: string; icon: ReactNode }[] = [
    { id: 'calm', label: 'Calm', icon: <WindIcon size={14} /> },
    { id: 'focused', label: 'Focused', icon: <GridIcon size={14} /> },
  ]
  return (
    <div role="group" aria-label="Density" className="inline-flex gap-0.5 rounded-[10px] border border-line bg-surface-2 p-[3px]">
      {opts.map((o) => {
        const on = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={'flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px] font-semibold transition-colors ' + (on ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
          >
            {o.icon}{o.label}
          </button>
        )
      })}
    </div>
  )
}

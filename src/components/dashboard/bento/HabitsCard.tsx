'use client'
import { useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { navigateToTab } from '@/stores/uiStore'
import { todayISO, isActiveDay, periodStart, cellDone, consistencyScore } from '@/lib/lifeHabits'
import { levelFor } from '@/lib/habitLevels'
import { BentoCard, ChipButton, ProgressRing, CardEmpty } from './BentoCard'
import { HabitsIcon, PlusIcon, CheckIcon } from './icons'
import type { HabitItem } from './bentoTypes'

interface Row {
  habit: HabitItem
  score: number
  color: string
  level: number
  doneToday: boolean
  dueToday: boolean
  targetDate: string
}

export function HabitsCard() {
  const today = todayISO()
  const habitsQ = trpc.lifeHabit.list.useQuery()
  const utils = trpc.useUtils()
  const setDay = trpc.lifeHabit.setDay.useMutation({ onSuccess: () => utils.lifeHabit.list.invalidate() })

  const rows = useMemo<Row[]>(() => {
    const habits = (habitsQ.data ?? []).filter((h) => !h.archivedAt)
    return habits.map((habit) => {
      const cadence = habit.cadenceDays ?? 1
      const explicit = new Map(habit.days.map((d) => [d.date, d.done] as [string, boolean]))
      const score = consistencyScore(habit.startDate, explicit, today, habit.autoSince, cadence)
      const info = levelFor(score)
      let doneToday: boolean
      let dueToday: boolean
      let targetDate: string
      if (cadence > 1) {
        const cps = periodStart(today, cadence)
        targetDate = cps
        dueToday = cps >= periodStart(habit.startDate, cadence)
        doneToday = cellDone(habit.startDate, cps, explicit.get(cps), habit.autoSince, cadence)
      } else {
        targetDate = today
        dueToday = isActiveDay(habit.startDate, today)
        doneToday = cellDone(habit.startDate, today, explicit.get(today), habit.autoSince)
      }
      return { habit, score, color: info.color, level: info.level, doneToday, dueToday, targetDate }
    })
  }, [habitsQ.data, today])

  const due = rows.filter((r) => r.dueToday)
  const doneCount = due.filter((r) => r.doneToday).length
  const totalCount = due.length
  const remaining = totalCount - doneCount

  function toggle(r: Row) {
    setDay.mutate({ habitId: r.habit.id, date: r.targetDate, done: !r.doneToday })
  }

  return (
    <BentoCard
      area="bento-habits"
      icon={<HabitsIcon />}
      title="Today's Habits"
      sub={totalCount > 0 ? `${doneCount}/${totalCount} done today` : 'Habits that improve your life'}
      action={<ChipButton onClick={() => navigateToTab('habits')} title="Open Habits"><PlusIcon size={14} />Habit</ChipButton>}
    >
      {habitsQ.isLoading ? (
        <CardEmpty>Loading…</CardEmpty>
      ) : rows.length === 0 ? (
        <CardEmpty>No habits yet — add one in the Habits tab.</CardEmpty>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3.5">
            <ProgressRing value={totalCount ? doneCount / totalCount : 0} size={66} stroke={7}>
              <span className="text-[15px] font-bold text-ink">{doneCount}/{totalCount}</span>
              <span className="mt-0.5 text-[9px] uppercase tracking-wide text-faint">today</span>
            </ProgressRing>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-ink">
                {totalCount === 0 ? 'Nothing due today' : remaining === 0 ? 'All done for today ✦' : `${remaining} to go`}
              </div>
              <div className="detail mt-0.5 text-[12px] text-faint">{rows.length} habit{rows.length === 1 ? '' : 's'} tracked</div>
            </div>
          </div>
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.habit.id} className="flex items-center gap-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  disabled={setDay.isPending}
                  aria-pressed={r.doneToday}
                  title={r.doneToday ? 'Tick off' : 'Mark done'}
                  className={'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ' + (r.doneToday ? 'border-emerald bg-emerald text-white' : 'border-line text-transparent hover:border-emerald')}
                >
                  <CheckIcon size={12} />
                </button>
                <span className={'flex-1 truncate text-[13.5px] ' + (r.doneToday ? 'text-faint' : 'text-ink')}>{r.habit.name}</span>
                <span className="detail flex items-center gap-1 text-[11px] font-semibold text-muted" title={`Level ${r.level}`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />L{r.level}
                </span>
                <span className="detail h-1.5 w-10 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full" style={{ width: `${Math.round(r.score)}%`, background: r.color }} />
                </span>
                <span className="detail w-8 text-right text-[11px] tabular-nums text-faint">{Math.round(r.score)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </BentoCard>
  )
}

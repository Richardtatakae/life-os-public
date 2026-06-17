'use client'
import { format } from 'date-fns'
import { trpc } from '@/lib/trpc/client'
import { navigateToTab } from '@/stores/uiStore'
import { todayISO } from '@/lib/lifeHabits'
import { BentoCard, CardEmpty } from './BentoCard'
import { JournalIcon, ArrowIcon } from './icons'

function localDay(d: Date | string): string {
  const date = new Date(d)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function JournalCard() {
  const today = todayISO()
  const listQ = trpc.journal.list.useQuery({ kind: 'journal', limit: 5 })
  const entries = listQ.data ?? []
  const todayEntry = entries.find((e) => localDay(e.createdAt) === today)
  const recent = entries.filter((e) => e.id !== todayEntry?.id).slice(0, 3)

  return (
    <BentoCard
      area="bento-journal"
      icon={<JournalIcon />}
      title="Journal"
      sub={todayEntry ? 'Today’s entry' : 'No entry yet today'}
      action={
        <button
          type="button"
          onClick={() => navigateToTab('journal')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] font-semibold text-emerald transition-colors hover:bg-surface-2"
        >
          {todayEntry ? 'Continue' : 'Write'} <ArrowIcon size={14} />
        </button>
      }
    >
      {listQ.isLoading ? (
        <CardEmpty>Loading…</CardEmpty>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="min-w-0">
            {todayEntry ? (
              <p className="detail line-clamp-4 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{todayEntry.text}</p>
            ) : (
              <p className="text-[13px] leading-relaxed text-faint">Nothing written today. Capture a thought while it&apos;s fresh.</p>
            )}
            {todayEntry?.mood != null && (
              <div className="detail mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-muted">
                Mood <span className="font-semibold text-ink">{todayEntry.mood > 0 ? `+${todayEntry.mood}` : todayEntry.mood}</span>
              </div>
            )}
          </div>
          <div className="min-w-0 md:border-l md:border-line md:pl-4">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Recent</div>
            {recent.length === 0 ? (
              <div className="text-[12px] text-faint">No past entries.</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {recent.map((e) => (
                  <li key={e.id} className="min-w-0">
                    <div className="text-[11px] text-faint">{format(new Date(e.createdAt), 'EEE, MMM d')}</div>
                    <div className="truncate text-[12.5px] text-muted">{e.text}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </BentoCard>
  )
}

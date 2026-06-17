'use client'
import { trpc } from '@/lib/trpc/client'
import { navigateToTab } from '@/stores/uiStore'
import { BentoCard, ChipButton, CardEmpty } from './BentoCard'
import { TasksIcon, PlusIcon, CheckIcon } from './icons'

const MAX_TASKS = 7

export function TasksCard() {
  const tasksQ = trpc.task.todayList.useQuery()
  const utils = trpc.useUtils()
  const complete = trpc.task.complete.useMutation({ onSuccess: () => utils.task.todayList.invalidate() })

  const remaining = (tasksQ.data ?? []).filter((t) => t.status !== 'done')
  const shown = remaining.slice(0, MAX_TASKS)

  return (
    <BentoCard
      area="bento-tasks"
      icon={<TasksIcon />}
      title="Tasks"
      sub={`${remaining.length} left`}
      action={<ChipButton onClick={() => navigateToTab('tasks')} title="Open Pursuits"><PlusIcon size={14} />Task</ChipButton>}
    >
      {tasksQ.isLoading ? (
        <CardEmpty>Loading…</CardEmpty>
      ) : remaining.length === 0 ? (
        <CardEmpty>All clear — nothing left today.</CardEmpty>
      ) : (
        <ul className="flex flex-col">
          {shown.map((t) => {
            const overdue = t.deadline != null && new Date(t.deadline).getTime() < Date.now()
            return (
              <li key={t.id} className="flex items-center gap-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => complete.mutate({ id: t.id })}
                  disabled={complete.isPending}
                  title="Complete task"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border border-line text-transparent transition-colors hover:border-emerald hover:text-emerald"
                >
                  <CheckIcon size={12} />
                </button>
                <span className="flex-1 truncate text-[13.5px] text-ink">{t.title}</span>
                {t.priority != null && t.priority <= 2 && <span className="detail rounded bg-amber/15 px-1.5 py-0.5 text-[10px] font-bold text-amber">P{t.priority}</span>}
                {overdue && <span className="detail rounded bg-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber">due</span>}
              </li>
            )
          })}
          {remaining.length > shown.length && <li className="pt-1.5 text-[11.5px] text-faint">+{remaining.length - shown.length} more</li>}
        </ul>
      )}
    </BentoCard>
  )
}

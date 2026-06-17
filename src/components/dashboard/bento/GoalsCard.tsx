'use client'
import { trpc } from '@/lib/trpc/client'
import { navigateToTab } from '@/stores/uiStore'
import { BentoCard, ChipButton, CardEmpty } from './BentoCard'
import { GoalsIcon, PlusIcon } from './icons'
import type { GoalNode } from './bentoTypes'

const MAX_GOALS = 6

export function GoalsCard() {
  const treeQ = trpc.goal.tree.useQuery()
  const goals = (treeQ.data ?? []).filter((g) => g.status === 'active').slice(0, MAX_GOALS)

  return (
    <BentoCard
      area="bento-goals"
      icon={<GoalsIcon />}
      title="Goals"
      sub={goals.length > 0 ? `${goals.length} active` : 'Your goals'}
      action={<ChipButton onClick={() => navigateToTab('tasks')} title="Open Pursuits"><PlusIcon size={14} />Goal</ChipButton>}
    >
      {treeQ.isLoading ? (
        <CardEmpty>Loading…</CardEmpty>
      ) : goals.length === 0 ? (
        <CardEmpty>No active goals.</CardEmpty>
      ) : (
        <ul className="flex flex-col gap-0.5">{goals.map((g) => <GoalRow key={g.id} goal={g} />)}</ul>
      )}
    </BentoCard>
  )
}

function GoalRow({ goal }: { goal: GoalNode }) {
  const progQ = trpc.goal.progress.useQuery({ id: goal.id })
  const pct = Math.round((progQ.data?.progress ?? 0) * 100)
  const behind = goal.deadline != null && new Date(goal.deadline).getTime() < Date.now() && pct < 100
  const barColor = behind ? 'var(--color-amber)' : 'var(--color-emerald)'
  return (
    <li className="py-1.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: barColor }} />
        <span className="flex-1 truncate text-[13px] text-ink">{goal.title}</span>
        {behind && <span className="detail rounded bg-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber">behind</span>}
        <span className="text-[11.5px] font-semibold tabular-nums text-muted">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
      </div>
    </li>
  )
}

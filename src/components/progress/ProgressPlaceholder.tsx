'use client'

/**
 * ProgressPlaceholder — the Progress tab as an IDEA BOARD (2026-06-10).
 *
 * Nothing here is built yet. This is the menu of "close the loop" elements the
 * Progress view could be composed of — written down so you can pick what
 * to build and what to skip. Each card says what it shows, where the data
 * comes from (most of it is already being tracked), and why it would help.
 *
 * Design principle for everything below: capture → display → QUESTION →
 * answer. A mirror alone doesn't change behavior — every element should end
 * by asking for a small decision.
 */

interface IdeaCard {
  title: string
  what: string
  data: string
  why: string
  /** Data already tracked today, or does it need new capture? */
  ready: 'data already tracked' | 'needs small addition' | 'new capture'
}

const IDEAS: IdeaCard[] = [
  {
    title: '1 · Weekly Review (the core loop-closer)',
    what:
      'Every Monday: focus time per Area (this week vs last), each habit\'s consistency delta (▲/▼), planner completion rate, journal-slider averages — and ONE mandatory question: "What\'s the one adjustment for next week?" saved as a weekly journal entry.',
    data:
      'time.totals (needs a date-range filter), lifeHabit consistency scores, PlannerBlock.status, DiaryEntry sliders; reflection saved as DiaryEntry kind="weekly".',
    why:
      'Research on self-tracking is unambiguous: the effect lives in review + written intention, not in dashboards. This converts everything Life OS records from write-only exhaust into steering.',
    ready: 'needs small addition',
  },
  {
    title: '2 · Plan-vs-reality score (daily)',
    what:
      'One line about yesterday, shown each morning: "Planned 6 blocks / completed 4 · 190 planned min / 145 focused min — 71%." Tracked as a trend over weeks.',
    data: 'PlannerBlock (status, durationMin, placed) + completed Pomodoros per day.',
    why:
      'The single number that says whether planning is a tool or fiction. Seeing it daily self-corrects overplanning — the classic failure mode.',
    ready: 'data already tracked',
  },
  {
    title: '3 · Time-vs-priorities gap (monthly)',
    what:
      '"You say Business is #1 — it got 12% of your focus time." Focus share per Area vs a target share you set once per Area.',
    data:
      'time.totals per Area (exists). Target share per Area = one new AppSetting JSON (no migration).',
    why:
      'One sentence of misalignment is more behavior-changing than any chart.',
    ready: 'needs small addition',
  },
  {
    title: '4 · Sleep & mood → output correlations',
    what:
      'Simple group-by means once ~30 days of sliders exist: "Days with ≥7h sleep: avg 96 focus min. Under 7h: avg 41." Only shown when each bucket has 10+ days (otherwise it\'s noise).',
    data: 'DiaryEntry.sleepHours + sliders × Pomodoro minutes + LifeHabit ticks.',
    why:
      'Makes filling in the journal sliders worth it — right now they feed nothing, and unused capture decays.',
    ready: 'data already tracked',
  },
  {
    title: '5 · Goal audit (monthly/quarterly)',
    what:
      'Every Goal/Project with ZERO focus time in 30 days, listed with one decision each: recommit or move to ice.',
    data: 'time.totals + goal tree (exists).',
    why:
      'The goal layer currently gets no feedback at all. This keeps Pursuits honest instead of aspirational.',
    ready: 'data already tracked',
  },
  {
    title: '6 · Estimation calibration',
    what:
      '"You underestimate by ~1.6× on average" in the weekly review, from planned block duration vs actual focused time.',
    data:
      'PlannerBlock.durationMin vs overlapping Pomodoro time (derivable), or an actualMin field on completion.',
    why: 'Directly improves next week\'s plan — feeds idea #2.',
    ready: 'needs small addition',
  },
  {
    title: '7 · Morning brief (glance-and-verdict)',
    what:
      'One line on app launch: today\'s planned blocks, focus minutes so far, habits ticked. The app starts the conversation instead of opening as an empty canvas.',
    data: 'DayPlanner + lifeHabit + pomodoro queries (all exist).',
    why: 'Cheapest way to make Life OS tell you something unprompted.',
    ready: 'data already tracked',
  },
  {
    title: '8 · Level-up toast (optional polish)',
    what:
      'A single celebration toast when a LifeHabit crosses a consistency rung or sets a new peak score. Blue/gold palette, no rarity tiers, no badge wall.',
    data: 'lifeHabit level + peakScore (exists).',
    why:
      'Restores the one thing badge removal lost — celebration moments — at ~1% of the cost.',
    ready: 'data already tracked',
  },
]

const READY_STYLE: Record<IdeaCard['ready'], string> = {
  // Blue↔amber axis only (no red/green): blue = ready, amber = needs work.
  'data already tracked': 'bg-blue/15 text-blue',
  'needs small addition': 'bg-amber/15 text-amber',
  'new capture': 'bg-ink/10 text-muted',
}

export function ProgressPlaceholder() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1
        className="box-drag-handle cursor-grab active:cursor-grabbing select-none inline-block text-lg font-semibold text-ink uppercase tracking-wide mb-3"
        title="Drag to move · drag any edge to resize"
      >
        Progress
      </h1>

      <p className="text-muted text-sm mb-4">
        Idea board — nothing is built yet. These are the candidate elements for
        closing the loop on the data Life OS already collects. Pick what earns
        building; delete what doesn&apos;t. (Written 2026-06-10 — see{' '}
        <span className="font-mono">.gsd/FABLE-REVIEW.md</span> §6 for the full
        reasoning.)
      </p>

      <div className="flex flex-col gap-3">
        {IDEAS.map((idea) => (
          <div key={idea.title} className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">{idea.title}</h2>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${READY_STYLE[idea.ready]}`}>
                {idea.ready}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-ink/85 leading-relaxed">{idea.what}</p>
            <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
              <span className="font-semibold">Data:</span> {idea.data}
            </p>
            <p className="mt-1 text-[11px] text-muted leading-relaxed">
              <span className="font-semibold">Why:</span> {idea.why}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

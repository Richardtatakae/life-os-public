'use client'

/**
 * page.tsx — the v2 tab shell.
 *
 * Renders the <TabBar> at the top, then the content of whichever tab is active.
 * Every non-dashboard tab puts its element(s) inside a <BoxBoard> — the shared
 * draggable/resizable "box" primitive — so each element can be moved (grab its
 * title bar) and resized (drag any side/corner) just like the Pursuits box, with
 * its layout saved per tab. The Dashboard tab uses the same primitive via
 * <DashboardMosaic>.
 *
 * Redesign v2 §2.2 (Track A — Tab shell).
 */

import type { Layout } from 'react-grid-layout'
import { useUiStore } from '@/stores/uiStore'
import { TabBar } from '@/components/nav/TabBar'
import { MainDashboard } from '@/components/dashboard/MainDashboard'
import { BoxBoard } from '@/components/shared/BoxBoard'
import { PursuitsBoardV2 } from '@/components/pursuits/PursuitsBoardV2'
import { DayPlanner } from '@/components/schedule/DayPlanner'
import { IdeasList } from '@/components/ideas/IdeasList'
import { JournalView } from '@/components/journal/JournalView'
import { DistilledView } from '@/components/distilled/DistilledView'
import { HabitsJotList } from '@/components/habits/HabitsJotList'
import { LifeHabitTracker } from '@/components/habits/LifeHabitTracker'
import { HABIT_BOX_ICONS } from '@/components/habits/HabitBoxIcons'
import { ProgressPlaceholder } from '@/components/progress/ProgressPlaceholder'
import { RoutinesView } from '@/components/routines/RoutinesView'
import { ProjectsOnIce } from '@/components/ice/ProjectsOnIce'

// Default box placements per tab (a 12-column grid). Restored from the saved
// layout when one exists; otherwise these apply. Single-element tabs get one
// tall box in the upper-left, mirroring the original Pursuits box.
// Habits tab: the freeform jot list.
const HABITS_LAYOUT: Layout = [
  // life-habits is autoHeight: its `h` is recomputed from content on mount, so
  // this is just a sensible first paint (~8 starter habits).
  { i: 'life-habits', x: 0, y: 0, w: 9, h: 10, minW: 5, minH: 4 },
  { i: 'habits-jot', x: 9, y: 0, w: 3, h: 16, minW: 3, minH: 4 },
]
const SCHEDULE_LAYOUT: Layout = [{ i: 'today', x: 0, y: 0, w: 9, h: 20, minW: 5, minH: 8 }]
const IDEAS_LAYOUT: Layout = [{ i: 'ideas', x: 0, y: 0, w: 6, h: 12, minW: 3, minH: 4 }]
const DISTILLED_LAYOUT: Layout = [{ i: 'distilled', x: 0, y: 0, w: 11, h: 22, minW: 5, minH: 8 }]
const PROGRESS_LAYOUT: Layout = [{ i: 'progress', x: 0, y: 0, w: 6, h: 8, minW: 3, minH: 3 }]
const ROUTINES_LAYOUT: Layout = [{ i: 'routines', x: 0, y: 0, w: 8, h: 16, minW: 3, minH: 5 }]

export default function Home() {
  const activeTab = useUiStore((s) => s.activeTab)

  return (
    <div className="app-root min-h-screen bg-base text-ink">
      <TabBar />

      {/* The Dashboard tab renders the full existing dashboard as-is. */}
      {activeTab === 'dashboard' && <MainDashboard />}

      {/* Other tabs render their element(s) as draggable/resizable boxes. */}
      {activeTab !== 'dashboard' && (
        <main className="mx-auto max-w-[1600px] px-4 py-6">
          {/* Habits tab: the freeform jot list. */}
          {activeTab === 'habits' && (
            <BoxBoard
              storageKey="habitsLayout"
              defaultLayout={HABITS_LAYOUT}
              panes={[
                { key: 'life-habits', title: 'Habits that definitely improve my life', icon: HABIT_BOX_ICONS['life-habits'], node: <LifeHabitTracker />, autoHeight: true },
                { key: 'habits-jot', title: 'Jot list', icon: HABIT_BOX_ICONS['habits-jot'], node: <HabitsJotList /> },
              ]}
            />
          )}

          {/* Projects on Ice: parked projects as square windows → click for a dashboard. */}
          {activeTab === 'projects-on-ice' && <ProjectsOnIce />}


          {/* Tasks tab: the Pursuits mission control board (five panels), rebuilt
              on the consolidated design-token system (PursuitsBoardV2). */}
          {activeTab === 'tasks' && <PursuitsBoardV2 />}

          {activeTab === 'schedule' && (
            <BoxBoard
              storageKey="scheduleTabLayout"
              defaultLayout={SCHEDULE_LAYOUT}
              panes={[{ key: 'today', node: <DayPlanner /> }]}
            />
          )}

          {/* Ideas tab: a simple freeform jot list. */}
          {activeTab === 'ideas' && (
            <BoxBoard
              storageKey="ideasLayout"
              defaultLayout={IDEAS_LAYOUT}
              panes={[{ key: 'ideas', node: <IdeasList /> }]}
            />
          )}

          {/* Journal tab: sub-tabs laid out as three arrangeable boxes.
              JournalView renders its own BoxBoard(s). */}
          {activeTab === 'journal' && <JournalView />}

          {/* Distilled tab: the documents produced by the /distill skill. */}
          {activeTab === 'distilled' && (
            <BoxBoard
              storageKey="distilledLayout"
              defaultLayout={DISTILLED_LAYOUT}
              panes={[{ key: 'distilled', node: <DistilledView /> }]}
            />
          )}

          {/* Progress tab: placeholder until the view is designed. */}
          {activeTab === 'progress' && (
            <BoxBoard
              storageKey="progressLayout"
              defaultLayout={PROGRESS_LAYOUT}
              panes={[{ key: 'progress', node: <ProgressPlaceholder /> }]}
            />
          )}

          {/* Routines tab: ordered routines with a timeline + copy-to-clipboard. */}
          {activeTab === 'routines' && (
            <BoxBoard
              storageKey="routinesLayout"
              defaultLayout={ROUTINES_LAYOUT}
              panes={[{ key: 'routines', node: <RoutinesView /> }]}
            />
          )}
        </main>
      )}
    </div>
  )
}

import { router } from '../trpc'
import { areaRouter } from './area'
import { commitmentRouter } from './commitment'
import { dailyPlanRouter } from './dailyPlan'
import { dayPlannerRouter } from './dayPlanner'
import { demoRouter } from './demo'
import { distilledRouter } from './distilled'
import { eventRouter } from './event'
import { focusTimerRouter } from './focusTimer'
import { folderRouter } from './folder'
import { goalRouter } from './goal'
import { habitNoteRouter } from './habitNote'
import { ideaRouter } from './idea'
import { journalRouter } from './journal'
import { lifeHabitRouter } from './lifeHabit'
import { meditationRouter } from './meditation'
import { pomodoroRouter } from './pomodoro'
import { problemRouter } from './problem'
import { projectRouter } from './project'
import { promptRouter } from './prompt'
import { routineRouter } from './routine'
import { settingsRouter } from './settings'
import { taskRouter } from './task'
import { timeRouter } from './time'
import { upNextRouter } from './upNext'
import { vowRouter } from './vow'

export const appRouter = router({
  area: areaRouter,
  commitment: commitmentRouter,
  dailyPlan: dailyPlanRouter,
  dayPlanner: dayPlannerRouter,
  demo: demoRouter,
  distilled: distilledRouter,
  event: eventRouter,
  focusTimer: focusTimerRouter,
  folder: folderRouter,
  goal: goalRouter,
  habitNote: habitNoteRouter,
  idea: ideaRouter,
  journal: journalRouter,
  lifeHabit: lifeHabitRouter,
  meditation: meditationRouter,
  pomodoro: pomodoroRouter,
  problem: problemRouter,
  project: projectRouter,
  prompt: promptRouter,
  routine: routineRouter,
  settings: settingsRouter,
  task: taskRouter,
  time: timeRouter,
  upNext: upNextRouter,
  vow: vowRouter,
})

export type AppRouter = typeof appRouter

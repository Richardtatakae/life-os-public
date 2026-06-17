/**
 * seed-demo.ts — fills the DEMO database (prisma/demo.db) with realistic but
 * entirely fake data so Life OS can be shown to other people without exposing
 * any private information. Toggle the demo DB on/off in ⚙ Settings → Demo mode.
 *
 * Persona: a generic indie founder / maker — shipping a small SaaS, training
 * for a half-marathon, learning Rust, reading more. Nothing here is real.
 *
 * Run with:  npm run db:seed-demo   (creates the schema, then runs this)
 *
 * The script is IDEMPOTENT: it wipes every table first, so re-running gives a
 * clean, identical demo every time. It targets demo.db by an absolute path via
 * the Prisma constructor, so it never depends on the active DATABASE_URL.
 */

import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const DEMO_DB_URL = 'file:' + path.join(process.cwd(), 'prisma', 'demo.db')
const prisma = new PrismaClient({ datasources: { db: { url: DEMO_DB_URL } } })

// ── date helpers (all relative to "now", local time) ────────────────────────
const NOW = new Date()
function atDaysAgo(days: number, hour = 9, min = 0): Date {
  const d = new Date(NOW)
  d.setDate(d.getDate() - days)
  d.setHours(hour, min, 0, 0)
  return d
}
function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function isoDaysAgo(days: number): string {
  return isoDate(atDaysAgo(days))
}
const TODAY = isoDaysAgo(0)

// Deterministic pseudo-random so the demo looks the same each rebuild.
let _seed = 1337
function rand(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff
  return _seed / 0x7fffffff
}

async function wipe() {
  // Delete in FK-safe order (children before parents). Cascades cover most, but
  // being explicit keeps re-runs clean regardless of cascade config.
  await prisma.$transaction([
    prisma.upNextItem.deleteMany(),
    prisma.commitmentInstance.deleteMany(),
    prisma.recurringCommitment.deleteMany(),
    prisma.dailyPlanItem.deleteMany(),
    prisma.plannerBlock.deleteMany(),
    prisma.pomodoro.deleteMany(),
    prisma.taskDependency.deleteMany(),
    prisma.goalDependency.deleteMany(),
    prisma.vow.deleteMany(),
    prisma.routineSubItem.deleteMany(),
    prisma.routineItem.deleteMany(),
    prisma.routineCondition.deleteMany(),
    prisma.habitRoutineCheck.deleteMany(),
    prisma.habitRoutine.deleteMany(),
    prisma.routine.deleteMany(),
    prisma.meditationSession.deleteMany(),
    prisma.lifeHabitDay.deleteMany(),
    prisma.lifeHabit.deleteMany(),
    prisma.habitNote.deleteMany(),
    prisma.diaryEntry.deleteMany(),
    prisma.idea.deleteMany(),
    prisma.problem.deleteMany(),
    prisma.task.deleteMany(),
    prisma.goal.deleteMany(),
    prisma.project.deleteMany(),
    prisma.area.deleteMany(),
    prisma.focusTimer.deleteMany(),
    prisma.event.deleteMany(),
  ])
}

async function main() {
  await wipe()

  // ── Areas ─────────────────────────────────────────────────────────────────
  const startup = await prisma.area.create({
    data: { name: 'Startup', color: '#34d399', position: 0 },
  })
  const health = await prisma.area.create({
    data: { name: 'Health & Fitness', color: '#38bdf8', position: 1 },
  })
  const learning = await prisma.area.create({
    data: { name: 'Learning', color: '#a78bfa', position: 2 },
  })
  const personal = await prisma.area.create({
    data: { name: 'Personal', color: '#f59e0b', position: 3 },
  })

  // ── Projects ────────────────────────────────────────────────────────────────
  const launch = await prisma.project.create({
    data: { name: 'Launch v1', areaId: startup.id, color: '#34d399', position: 0 },
  })
  const growth = await prisma.project.create({
    data: { name: 'Growth & Marketing', areaId: startup.id, color: '#22d3ee', position: 1 },
  })
  const rust = await prisma.project.create({
    data: { name: 'Rust deep-dive', areaId: learning.id, color: '#a78bfa', position: 0 },
  })

  // ── Goals ────────────────────────────────────────────────────────────────────
  const gBeta = await prisma.goal.create({
    data: {
      title: 'Ship the public beta',
      description: 'Get the product in front of the first real users.',
      finishCriteria: 'Signup → onboarding → first value works end-to-end for a stranger.',
      areaId: startup.id,
      projectId: launch.id,
      deadline: atDaysAgo(-21),
      status: 'active',
      position: 0,
    },
  })
  const gOnboard = await prisma.goal.create({
    data: {
      title: 'Finish the onboarding flow',
      areaId: startup.id,
      projectId: launch.id,
      parentId: gBeta.id,
      status: 'active',
      position: 0,
    },
  })
  const gBilling = await prisma.goal.create({
    data: {
      title: 'Wire up billing',
      finishCriteria: 'A test card can subscribe and the webhook updates the account.',
      areaId: startup.id,
      projectId: launch.id,
      parentId: gBeta.id,
      status: 'active',
      position: 1,
    },
  })
  const gUsers = await prisma.goal.create({
    data: {
      title: 'Reach 100 paying users',
      areaId: startup.id,
      projectId: growth.id,
      targetMetric: 'paying users',
      targetValue: 100,
      deadline: atDaysAgo(-120),
      status: 'active',
      position: 0,
    },
  })
  const gHalf = await prisma.goal.create({
    data: {
      title: 'Run a half-marathon',
      description: 'Sub-2:00 at the autumn race.',
      areaId: health.id,
      targetMetric: 'km longest run',
      targetValue: 21,
      deadline: atDaysAgo(-90),
      status: 'active',
      position: 0,
    },
  })
  const gBench = await prisma.goal.create({
    data: {
      title: 'Bench press 100 kg',
      areaId: health.id,
      targetMetric: 'kg',
      targetValue: 100,
      status: 'active',
      position: 1,
    },
  })
  const gRust = await prisma.goal.create({
    data: {
      title: 'Build a CLI tool in Rust',
      areaId: learning.id,
      projectId: rust.id,
      status: 'active',
      position: 0,
    },
  })
  const gBooks = await prisma.goal.create({
    data: {
      title: 'Read 24 books this year',
      areaId: personal.id,
      targetMetric: 'books',
      targetValue: 24,
      status: 'active',
      position: 0,
    },
  })
  await prisma.goal.create({
    data: {
      title: 'Set up the home office',
      areaId: personal.id,
      status: 'completed',
      completedAt: atDaysAgo(40),
      position: 1,
    },
  })

  // ── Tasks (with subtasks + a mix of statuses) ──────────────────────────────
  // Helper to create a task and return it.
  type TaskSeed = {
    title: string
    status?: 'inbox' | 'todo' | 'scheduled' | 'in_progress' | 'blocked' | 'done' | 'deferred'
    goalId?: string
    areaId?: string
    parentTaskId?: string
    energy?: 'high' | 'medium' | 'low'
    estimateMin?: number
    priority?: number
    deadlineDaysAway?: number
    finishCriteria?: string
    doneDaysAgo?: number
    position?: number
    notes?: string
  }
  async function task(s: TaskSeed) {
    return prisma.task.create({
      data: {
        title: s.title,
        status: s.status ?? 'todo',
        goalId: s.goalId,
        areaId: s.areaId,
        parentTaskId: s.parentTaskId,
        energy: s.energy,
        estimateMin: s.estimateMin,
        priority: s.priority,
        deadline: s.deadlineDaysAway != null ? atDaysAgo(-s.deadlineDaysAway) : undefined,
        finishCriteria: s.finishCriteria,
        completedAt: s.doneDaysAgo != null ? atDaysAgo(s.doneDaysAgo) : undefined,
        startedAt: s.status === 'in_progress' ? atDaysAgo(1) : undefined,
        position: s.position ?? 0,
        notes: s.notes,
      },
    })
  }

  // Onboarding goal tasks
  const tOnboard = await task({
    title: 'Design the welcome screen',
    goalId: gOnboard.id,
    status: 'in_progress',
    energy: 'high',
    estimateMin: 120,
    priority: 1,
    deadlineDaysAway: 2,
    finishCriteria: 'Welcome screen approved in Figma and built in the app.',
    position: 0,
  })
  await task({ title: 'Copy for the 3 onboarding steps', goalId: gOnboard.id, parentTaskId: tOnboard.id, status: 'todo', energy: 'medium', estimateMin: 45, position: 0 })
  await task({ title: 'Empty-state illustrations', goalId: gOnboard.id, parentTaskId: tOnboard.id, status: 'todo', energy: 'low', estimateMin: 30, position: 1 })
  await task({ title: 'Add progress checklist to the dashboard', goalId: gOnboard.id, status: 'todo', energy: 'medium', estimateMin: 90, position: 1 })
  await task({ title: 'Sketch onboarding on paper', goalId: gOnboard.id, status: 'done', doneDaysAgo: 4, energy: 'low', position: 2 })

  // Billing goal tasks
  const tBilling = await task({ title: 'Integrate Stripe checkout', goalId: gBilling.id, status: 'todo', energy: 'high', estimateMin: 180, priority: 1, deadlineDaysAway: 6, position: 0 })
  await task({ title: 'Handle the subscription webhook', goalId: gBilling.id, parentTaskId: tBilling.id, status: 'blocked', energy: 'high', estimateMin: 120, position: 0 })
  await task({ title: 'Pricing page with 3 tiers', goalId: gBilling.id, status: 'todo', energy: 'medium', estimateMin: 60, position: 1 })

  // Growth tasks
  await task({ title: 'Write the launch tweet thread', goalId: gUsers.id, status: 'todo', energy: 'medium', estimateMin: 45, position: 0 })
  await task({ title: 'Submit to 5 newsletters', goalId: gUsers.id, status: 'todo', energy: 'low', estimateMin: 30, position: 1 })
  await task({ title: 'Set up Plausible analytics', goalId: gUsers.id, status: 'done', doneDaysAgo: 7, energy: 'low', position: 2 })
  await task({ title: 'Draft a Product Hunt page', goalId: gUsers.id, status: 'todo', energy: 'medium', estimateMin: 60, position: 3 })

  // Health tasks
  const tLongRun = await task({ title: 'Long run — 16 km', goalId: gHalf.id, status: 'todo', energy: 'high', estimateMin: 100, deadlineDaysAway: 3, position: 0 })
  await task({ title: 'Buy proper running shoes', goalId: gHalf.id, status: 'done', doneDaysAgo: 12, energy: 'low', position: 1 })
  await task({ title: 'Book a sports-massage', goalId: gHalf.id, status: 'todo', energy: 'low', estimateMin: 15, position: 2 })
  await task({ title: 'Add a 4th gym session per week', goalId: gBench.id, status: 'todo', energy: 'medium', position: 0 })

  // Learning tasks
  await task({ title: 'Finish the Rust Book ch. 10–13', goalId: gRust.id, status: 'in_progress', energy: 'high', estimateMin: 120, position: 0 })
  await task({ title: 'Build a "todo" CLI as practice', goalId: gRust.id, status: 'todo', energy: 'high', estimateMin: 180, position: 1 })
  await task({ title: 'Read "Shape Up" — 2 chapters', goalId: gBooks.id, status: 'todo', energy: 'low', estimateMin: 40, position: 0 })

  // Loose area-level tasks (no goal)
  await task({ title: 'Renew the domain', areaId: startup.id, status: 'todo', energy: 'low', estimateMin: 10, deadlineDaysAway: 9, position: 5 })
  await task({ title: 'Inbox zero', areaId: personal.id, status: 'todo', energy: 'low', estimateMin: 30, position: 5 })
  await task({ title: 'Meal-prep for the week', areaId: health.id, status: 'todo', energy: 'medium', estimateMin: 60, position: 5 })

  // ── Up-next queue ──────────────────────────────────────────────────────────
  await prisma.upNextItem.create({ data: { kind: 'task', taskId: tOnboard.id, position: 0 } })
  await prisma.upNextItem.create({ data: { kind: 'task', taskId: tBilling.id, position: 1 } })
  await prisma.upNextItem.create({ data: { kind: 'goal', goalId: gHalf.id, position: 2 } })

  // ── Problems (Pursuits capture box) ────────────────────────────────────────
  const problems = [
    'Landing-page conversion is stuck around 2% — needs a clearer headline.',
    'Not sure whether to push the €9 or €19 tier first.',
    'Onboarding drop-off is highest on step 2.',
    'I keep context-switching between code and marketing.',
  ]
  for (let i = 0; i < problems.length; i++) {
    await prisma.problem.create({ data: { text: problems[i], position: i, createdAt: atDaysAgo(i + 1) } })
  }

  // ── Ideas ──────────────────────────────────────────────────────────────────
  const ideas = [
    'Add a "share my progress" image export.',
    'Weekly email digest of what got done.',
    'Keyboard-only power-user mode.',
    'Template gallery for common setups.',
    'A public changelog page.',
  ]
  for (let i = 0; i < ideas.length; i++) {
    await prisma.idea.create({ data: { text: ideas[i], position: i, createdAt: atDaysAgo(i) } })
  }

  // ── Habit jot list ─────────────────────────────────────────────────────────
  const habitNotes = [
    'The 5-minute rule works when I really don’t want to start.',
    'Magnesium before bed = noticeably better sleep.',
    'Phone in another room while working — huge.',
  ]
  for (let i = 0; i < habitNotes.length; i++) {
    await prisma.habitNote.create({ data: { text: habitNotes[i], position: i, createdAt: atDaysAgo(i) } })
  }

  // ── Life Habits + day grid ─────────────────────────────────────────────────
  // mix of "Established" (autoSince set — auto-tick) and "Building" habits.
  type HabitSeed = {
    name: string
    startDaysAgo: number
    establishedDaysAgo?: number // autoSince
    cadenceDays?: number
    keepRate: number // probability a given day is "done"
    notes?: string
  }
  const habitSeeds: HabitSeed[] = [
    { name: 'Workout', startDaysAgo: 140, establishedDaysAgo: 110, keepRate: 0.82, notes: 'Gym or a run. Counts if I move for 30+ min.' },
    { name: 'Read 20 min', startDaysAgo: 120, establishedDaysAgo: 95, keepRate: 0.88 },
    { name: 'Deep work block', startDaysAgo: 100, establishedDaysAgo: 80, keepRate: 0.78, notes: 'One 90-min no-distraction block before noon.' },
    { name: 'Journal', startDaysAgo: 90, establishedDaysAgo: 70, keepRate: 0.85 },
    { name: '8h sleep', startDaysAgo: 75, establishedDaysAgo: 55, keepRate: 0.7 },
    { name: 'Meditate', startDaysAgo: 24, keepRate: 0.75, notes: 'Headspace or just breathing.' },
    { name: 'No sugar', startDaysAgo: 18, keepRate: 0.66 },
    { name: 'Cold shower', startDaysAgo: 12, keepRate: 0.6 },
  ]

  const habits: { id: string; name: string; startDaysAgo: number }[] = []
  for (let i = 0; i < habitSeeds.length; i++) {
    const h = habitSeeds[i]
    const created = await prisma.lifeHabit.create({
      data: {
        name: h.name,
        startDate: isoDaysAgo(h.startDaysAgo),
        cadenceDays: h.cadenceDays ?? 1,
        autoSince: h.establishedDaysAgo != null ? isoDaysAgo(h.establishedDaysAgo) : null,
        notes: h.notes,
        position: i,
        peakScore: 0.7 + rand() * 0.28,
      },
    })
    habits.push({ id: created.id, name: h.name, startDaysAgo: h.startDaysAgo })

    // Only EXPLICIT toggles are stored. For "Established" habits the day defaults
    // to done, so we only store the occasional MISS. For "Building" habits the
    // day defaults to off, so we store the DONE days. This matches lifeHabits.ts.
    const established = h.establishedDaysAgo != null
    const span = Math.min(h.startDaysAgo, 60)
    const rows: { habitId: string; date: string; done: boolean }[] = []
    for (let d = 0; d < span; d++) {
      const isDone = rand() < h.keepRate
      if (established && !isDone) {
        rows.push({ habitId: created.id, date: isoDaysAgo(d), done: false })
      } else if (!established && isDone) {
        rows.push({ habitId: created.id, date: isoDaysAgo(d), done: true })
      }
    }
    if (rows.length) await prisma.lifeHabitDay.createMany({ data: rows })
  }

  // Meditation sessions for the "Meditate" habit (last ~18 days).
  const meditate = habits.find((h) => h.name === 'Meditate')!
  for (let d = 0; d < 18; d++) {
    if (rand() < 0.75) {
      await prisma.meditationSession.create({
        data: {
          habitId: meditate.id,
          date: isoDaysAgo(d),
          startTime: d % 2 === 0 ? '07:10' : '21:40',
          durationMin: [10, 12, 15, 20, 25][Math.floor(rand() * 5)],
        },
      })
    }
  }

  // ── Routines ───────────────────────────────────────────────────────────────
  const morning = await prisma.routine.create({
    data: { name: 'Morning Routine', startTime: '06:30', position: 0 },
  })
  const morningItems = [
    { text: 'Wake + make the bed', durationMin: 5 },
    { text: 'Big glass of water', durationMin: 2 },
    { text: 'Stretch / mobility', durationMin: 10 },
    { text: 'Meditate', durationMin: 10 },
    { text: 'Cold shower', durationMin: 8 },
    { text: 'Plan the day (top 3)', durationMin: 10 },
  ]
  for (let i = 0; i < morningItems.length; i++) {
    const it = await prisma.routineItem.create({
      data: { routineId: morning.id, text: morningItems[i].text, durationMin: morningItems[i].durationMin, position: i },
    })
    if (it.text.startsWith('Plan')) {
      await prisma.routineSubItem.createMany({
        data: [
          { itemId: it.id, text: 'Pick the ONE thing that matters', position: 0 },
          { itemId: it.id, text: 'Two supporting tasks', position: 1 },
        ],
      })
    }
  }
  await prisma.routineCondition.create({
    data: { routineId: morning.id, text: 'No phone before the routine is done', position: 0 },
  })

  const evening = await prisma.routine.create({
    data: { name: 'Evening Wind-down', startTime: '21:30', position: 1 },
  })
  const eveningItems = [
    { text: 'Dim the lights', durationMin: 1 },
    { text: 'Tidy the desk for tomorrow', durationMin: 5 },
    { text: 'Read (no screens)', durationMin: 20 },
    { text: 'Journal — 3 lines', durationMin: 5 },
    { text: 'Lights out', durationMin: 1 },
  ]
  for (let i = 0; i < eveningItems.length; i++) {
    await prisma.routineItem.create({
      data: { routineId: evening.id, text: eveningItems[i].text, durationMin: eveningItems[i].durationMin, position: i },
    })
  }

  // ── Journal (DiaryEntry) ───────────────────────────────────────────────────
  const journalTexts = [
    'Good momentum today — shipped the welcome screen draft. Felt the flow state kick in around 10am.',
    'Slow start, too much time in the inbox. Salvaged the afternoon with one solid deep-work block.',
    'Long run felt great. Legs heavy at km 12 but pushed through. Confidence for the half is growing.',
    'Stuck on the Stripe webhook for hours. Stepped away, went for a walk, solved it in 10 minutes after.',
    'Talked to two potential users. Both lit up at the same feature — that’s a signal worth following.',
    'Tired. Skipped the workout, which I always regret. Still journaled and read, so not a wash.',
    'Reworked the pricing page. Three tiers feels right. Nervous but excited about charging.',
    'Great deep-work morning. Rust is finally clicking — ownership stopped fighting me.',
    'Off day mentally. Did the minimum and protected sleep instead of grinding. The right call.',
    'Shipped onboarding step 1. Small win but it compounds. Celebrated with a proper dinner.',
    'Marketing day. Wrote the launch thread. Hardest part is hitting publish, not the writing.',
    'Recovery day. Mobility, reading, early night. Building the base, not just the peaks.',
  ]
  for (let i = 0; i < journalTexts.length; i++) {
    const day = i * 2 // every other day, going back
    await prisma.diaryEntry.create({
      data: {
        text: journalTexts[i],
        kind: 'journal',
        createdAt: atDaysAgo(day, 21, 30),
        mood: Math.round((rand() * 6 - 1)),
        energy: Math.round((rand() * 6 - 1)),
        focus: Math.round((rand() * 6 - 1)),
        stress: Math.round((rand() * 5 - 2)),
        sleepQuality: Math.round((rand() * 6 - 1)),
        motivation: Math.round((rand() * 6 - 1)),
        hope: Math.round((rand() * 5)),
        physicalHealth: Math.round((rand() * 5)),
        productivity: Math.round((rand() * 6 - 1)),
        sleepHours: Math.round((6 + rand() * 3) * 10) / 10,
      },
    })
  }

  // ── Focus timers (the editable Pomodoro presets) ───────────────────────────
  await prisma.focusTimer.createMany({
    data: [
      { name: 'Classic', workMin: 25, breakMin: 5, position: 0 },
      { name: '52 / 17', workMin: 52, breakMin: 17, position: 1 },
      { name: 'Deep', workMin: 90, breakMin: 20, position: 2 },
    ],
  })

  // ── Pomodoro history (drives time roll-ups + Progress) ─────────────────────
  const pomoTargets = [tOnboard.id, tBilling.id, tLongRun.id]
  for (let d = 0; d < 12; d++) {
    const sessions = Math.floor(rand() * 4) // 0–3 sessions a day
    for (let s = 0; s < sessions; s++) {
      const startHour = 9 + s * 2
      const started = atDaysAgo(d, startHour, 0)
      const target = [25, 25, 52][Math.floor(rand() * 3)]
      const ended = new Date(started.getTime() + target * 60_000)
      await prisma.pomodoro.create({
        data: {
          taskId: pomoTargets[Math.floor(rand() * pomoTargets.length)],
          startedAt: started,
          endedAt: ended,
          targetMin: target,
          status: 'completed',
        },
      })
    }
  }

  // ── Today's schedule (planner blocks) ──────────────────────────────────────
  // Placed blocks on the time axis (startMin = minutes from midnight).
  const blocks: {
    title: string; kind: string; energy: string; durationMin: number; startMin: number; status?: string; landmark?: string
  }[] = [
    { title: 'Morning routine', kind: 'work', energy: 'med', durationMin: 45, startMin: 6 * 60 + 30, status: 'done' },
    { title: 'Deep work: onboarding flow', kind: 'work', energy: 'high', durationMin: 90, startMin: 9 * 60, landmark: 'Welcome screen built' },
    { title: 'Team standup', kind: 'commitment', energy: 'low', durationMin: 15, startMin: 11 * 60 },
    { title: 'Lunch + walk', kind: 'meal', energy: 'fun', durationMin: 45, startMin: 12 * 60 + 30 },
    { title: 'Stripe checkout integration', kind: 'work', energy: 'high', durationMin: 120, startMin: 14 * 60 },
    { title: 'Read (Rust Book)', kind: 'read', energy: 'low', durationMin: 30, startMin: 16 * 60 + 30 },
    { title: 'Gym — push day', kind: 'commitment', energy: 'high', durationMin: 60, startMin: 18 * 60 },
  ]
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    await prisma.plannerBlock.create({
      data: {
        date: TODAY,
        title: b.title,
        kind: b.kind,
        energy: b.energy,
        durationMin: b.durationMin,
        placed: true,
        startMin: b.startMin,
        status: b.status ?? 'todo',
        landmark: b.landmark,
        completedAt: b.status === 'done' ? atDaysAgo(0, 7, 15) : undefined,
        position: i,
      },
    })
  }
  // Unplaced blocks waiting in the task box.
  const boxBlocks = [
    { title: 'Reply to user feedback emails', energy: 'low', durationMin: 20 },
    { title: 'Write launch tweet thread', energy: 'med', durationMin: 30 },
  ]
  for (let i = 0; i < boxBlocks.length; i++) {
    await prisma.plannerBlock.create({
      data: { date: TODAY, title: boxBlocks[i].title, kind: 'task', energy: boxBlocks[i].energy, durationMin: boxBlocks[i].durationMin, placed: false, position: i },
    })
  }

  // ── Daily plan ("pushed to today") ─────────────────────────────────────────
  await prisma.dailyPlanItem.create({ data: { date: TODAY, kind: 'task', taskId: tOnboard.id, position: 0 } })
  await prisma.dailyPlanItem.create({ data: { date: TODAY, kind: 'task', taskId: tBilling.id, position: 1 } })
  await prisma.dailyPlanItem.create({ data: { date: TODAY, kind: 'goal', goalId: gHalf.id, position: 2 } })

  // ── Recurring commitments (auto-schedule onto the planner) ─────────────────
  await prisma.recurringCommitment.create({
    data: { title: 'Team standup', durationMin: 15, startMin: 11 * 60, frequency: 'weekly', weekdays: '1,2,3,4,5', active: true, position: 0 },
  })
  await prisma.recurringCommitment.create({
    data: { title: 'Gym', durationMin: 60, startMin: 18 * 60, frequency: 'weekly', weekdays: '1,3,5', active: true, position: 1 },
  })

  // ── Vow (history — an ended, kept vow; nothing active so the UI isn't locked)
  const vowTask = await task({ title: 'Finish the demo video script', areaId: startup.id, status: 'done', doneDaysAgo: 8, position: 9 })
  await prisma.vow.create({
    data: {
      taskId: vowTask.id,
      finishCriteria: 'A complete 90-second script, start to finish, no editing pass needed.',
      startedAt: atDaysAgo(9, 8, 0),
      endedAt: atDaysAgo(8, 16, 0),
      outcome: 'kept',
    },
  })


  console.log('✅ Demo database seeded:')
  const counts = await prisma.$transaction([
    prisma.area.count(), prisma.project.count(), prisma.goal.count(), prisma.task.count(),
    prisma.lifeHabit.count(), prisma.lifeHabitDay.count(), prisma.diaryEntry.count(),
    prisma.plannerBlock.count(), prisma.pomodoro.count(), prisma.routine.count(),
    prisma.idea.count(), prisma.problem.count(),
  ])
  const [areas, projects, goals, tasks, lh, lhd, diary, pb, pomo, rout, idea, prob] = counts
  console.log(
    `   areas=${areas} projects=${projects} goals=${goals} tasks=${tasks}\n` +
      `   habits=${lh} habitDays=${lhd} journal=${diary} plannerBlocks=${pb}\n` +
      `   pomodoros=${pomo} routines=${rout} ideas=${idea} problems=${prob}`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

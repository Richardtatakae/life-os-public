# Life OS

A local-first life-management desktop app that keeps your habits, tasks, goals, schedule, and journal in a single SQLite database on your machine — no cloud account required to run it.

## Features

- **Habit tracking** — daily streaks, free-day rules, completion rings
- **Task management** — capture, triage, and schedule tasks
- **Nested goals** — break goals into sub-goals with progress tracking
- **Daily planner** — time-blocked schedule with drag-and-drop reordering
- **Pomodoro timer** — focus sessions linked to tasks
- **Journaling** — daily and meditation journals
- **Gamification** — badges, milestones, and variable-ratio rewards

## Tech stack

Next.js 16 · React 19 · TypeScript · Prisma · SQLite · Tauri 2 (desktop shell) · tRPC v11 · Zustand · Tailwind v4 · Vitest · Playwright

## Prerequisites

- **Node.js 20+** (required)
- **Rust + Tauri CLI** — only needed if you want to build or run the native desktop app; the web dev server works without it

## First-time setup

```bash
# 1. Clone and install
git clone <repo-url> life-os
cd life-os
npm install

# 2. Set up your environment
cp .env.example .env
# Edit .env if needed — DATABASE_URL is the only required value for local use

# 3. Create the database and run migrations
npx prisma migrate dev

# 4. Start the dev server (web UI at http://localhost:3000)
npm run dev
```

### Try it with demo data

Don't want to enter your own data first? Seed a demo database:

```bash
npm run db:seed-demo
```

This creates a separate `demo.db` pre-filled with sample habits, tasks, goals, and journal entries so you can explore every feature without touching your real data.

### Run the native desktop app (optional)

If you have Rust and the Tauri CLI installed:

```bash
npm run tauri:dev   # opens a native window pointing to the dev server
```

## Updating to a new version

```bash
git pull
npm install
npx prisma migrate dev
npm run build
```

That's it. Prisma will apply any new migrations automatically; your existing data stays intact.

## Running tests

```bash
npm test            # Vitest unit tests
npm run test:e2e    # Playwright end-to-end tests
npm run verify      # both together
```

## Project layout

```
life-os/
├── prisma/              # Schema, migrations, seed scripts
├── src/
│   ├── app/             # Next.js App Router pages + tRPC handler
│   ├── server/
│   │   ├── routers/     # tRPC routers (one per module)
│   │   ├── domain/      # Pure domain functions (no DB)
│   │   └── db/          # Prisma client + event log helper
│   ├── components/      # React components grouped by domain
│   ├── stores/          # Zustand client state
│   └── lib/             # Shared utilities (tRPC client, date, etc.)
├── src-tauri/           # Tauri 2 desktop wrapper (Rust)
├── scripts/             # One-shot maintenance scripts
└── tests/               # Vitest unit + Playwright e2e
```

## License

MIT — see [LICENSE](LICENSE).

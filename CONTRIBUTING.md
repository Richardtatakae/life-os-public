# Contributing to Life OS

Thanks for your interest. This guide covers everything you need to go from zero to a running local dev environment.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | Required |
| npm | bundled with Node | Required |
| Rust + Cargo | stable | Only for the native desktop build (optional) |
| Tauri CLI | 2.x | Only for `tauri:dev` / `tauri:build` (optional) |

You do **not** need Rust/Tauri to run the web dev server or to run tests.

## First-time setup

```bash
# 1. Clone the repo
git clone <repo-url> life-os
cd life-os

# 2. Install Node dependencies
npm install

# 3. Copy the example env file and adjust if needed
cp .env.example .env
# DATABASE_URL is the only required value for local dev.
# Notion and vault vars are optional — see .env.example for details.

# 4. Create the SQLite database and apply all migrations
npx prisma migrate dev

# 5. Start the development server
npm run dev
# App is now running at http://localhost:3000
```

## Running with demo data

If you want to explore all features without entering your own data, run the demo seed:

```bash
npm run db:seed-demo
```

This creates a separate `demo.db` pre-populated with sample habits, tasks, goals, schedule entries, and journal entries. It does not overwrite your real database.

## The update flow

When you pull new commits, run this sequence to stay in sync:

```bash
git pull
npm install
npx prisma migrate dev
npm run build
```

Prisma applies any new migrations automatically; your existing data is preserved.

## Running tests

```bash
npm test             # Vitest unit tests (fast)
npm run test:e2e     # Playwright end-to-end tests (requires the dev server to be running)
npm run verify       # Both together
```

Unit tests live in `tests/unit/`. End-to-end tests live in `tests/e2e/`. Domain functions (pure logic, no DB) are the primary unit-test target and aim for 10+ cases each.

## Project layout

```
life-os/
├── prisma/
│   ├── schema.prisma       # Data model — single source of truth for all tables
│   ├── migrations/         # Auto-generated migration SQL
│   └── seed.ts             # Default seed (development)
├── scripts/
│   └── seed-demo.ts        # Demo seed script
├── src/
│   ├── app/                # Next.js App Router — pages, layouts, tRPC handler
│   ├── server/
│   │   ├── routers/        # tRPC routers, one per module (habit, task, goal, …)
│   │   ├── domain/         # Pure functions — no DB imports, fully unit-testable
│   │   └── db/             # Prisma client, event-log helper, projection helpers
│   ├── components/         # React components grouped by domain
│   ├── stores/             # Zustand client state (one store per module)
│   └── lib/                # Shared utilities (tRPC client, date helpers, etc.)
├── src-tauri/              # Tauri 2 Rust shell (desktop wrapper)
└── tests/
    ├── unit/               # Vitest unit tests
    └── e2e/                # Playwright end-to-end tests
```

## Key conventions

- **TypeScript strict mode** — no `any`.
- **tRPC routers** — one file per module in `src/server/routers/`. Register new routers in `_app.ts`.
- **Event log** — every state mutation must write an `Event` row via `src/server/db/events.ts`. Do not skip this.
- **Domain functions** — pure (no DB), live in `src/server/domain/`, tested in isolation.
- **Commits** — one atomic commit per completed feature; use conventional-commit style (`feat(habits): ...`, `fix(planner): ...`).
- **Do not commit** `data.db`, `.env`, `node_modules`, or `src-tauri/target/`.

## Building the desktop app

Requires Rust + Tauri CLI:

```bash
npm run tauri:build   # produces a native .dmg / installer
```

## Questions?

Open an issue. Pull requests welcome.

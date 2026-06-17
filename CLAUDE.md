# Life OS — Project Instructions for AI Assistants

## What this project is

Life OS is a local-first life-management desktop app. It stores all data in a local SQLite database and provides:

- Habit tracking with streaks, free-day rules, and completion rings
- Task management with capture, triage, and scheduling
- Nested goal trees with progress tracking
- Time-blocked daily planner with drag-and-drop
- Pomodoro focus timer linked to tasks
- Daily and meditation journaling
- Gamification: badges, milestones, and variable-ratio rewards
- Optional one-way sync to Notion for mobile read access

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI framework | Next.js 16 + React 19 + TypeScript |
| Desktop shell | Tauri 2 (Rust) — wraps the Next.js app in a native window |
| Database | Prisma 6 + SQLite (local file) |
| API layer | tRPC v11 |
| Client state | Zustand 5 |
| Styling | Tailwind v4 with CSS variable tokens |
| Testing | Vitest (unit) + Playwright (e2e) |

## Folder layout

```
life-os/
├── prisma/
│   ├── schema.prisma       # Data model — single source of truth
│   ├── migrations/         # Auto-generated migration SQL
│   └── seed.ts             # Development seed
├── scripts/
│   └── seed-demo.ts        # Demo data seed
├── src/
│   ├── app/                # Next.js App Router (pages, layouts, API routes)
│   ├── server/
│   │   ├── routers/        # tRPC routers — one file per module
│   │   │   └── _app.ts     # Root router — registers all sub-routers
│   │   ├── domain/         # Pure domain functions (no DB imports)
│   │   └── db/
│   │       ├── client.ts   # Prisma client singleton
│   │       └── events.ts   # Event-log helper (all mutations write here)
│   ├── components/         # React components, grouped by domain
│   ├── stores/             # Zustand stores — one per module
│   └── lib/                # Shared utilities (tRPC client, date, clipboard)
├── src-tauri/              # Tauri 2 Rust shell
└── tests/
    ├── unit/               # Vitest unit tests
    └── e2e/                # Playwright end-to-end tests
```

## Coding conventions

### TypeScript
- Strict mode on — no `any`. Prefer `unknown` + type guard over casting.
- Use `zod` for all input validation (already in use throughout tRPC routers).

### tRPC routers
- One file per module: `src/server/routers/<module>.ts`
- Register every new router in `src/server/routers/_app.ts`
- Use `z.object(...)` schemas on all inputs; return plain serialisable objects

### The Event log — non-negotiable
Every state mutation (create, update, delete) MUST write an `Event` row via `src/server/db/events.ts`. This is the audit trail and projection source. Never skip it, even for "quick" writes.

```ts
// Example pattern — adapt to the actual helper signature
await db.event.create({ data: { type: 'HABIT_CHECKED', payload: { ... } } })
```

### Domain functions
- Live in `src/server/domain/`
- Pure: no Prisma imports, no side effects
- Unit-tested in isolation; aim for 10+ cases per function
- Routers call domain functions, then persist results + write the Event

### Styling
- Tailwind v4 utility classes throughout
- Design tokens are CSS variables defined in `src/app/globals.css`
- Use token names (e.g. `text-foreground`, `bg-card`) — do not hardcode hex values

### Components
- Grouped by domain under `src/components/`
- Prefer small, single-responsibility components
- Use the shared `ui/` primitives (card, button, panel, etc.) rather than reimplementing

## Script reference

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Next.js dev server at http://localhost:3000 |
| `npm run build` | Production Next.js build |
| `npm run tauri:dev` | Open the Tauri desktop window (requires Rust) |
| `npm run tauri:build` | Build the native desktop app (.dmg / installer) |
| `npx prisma migrate dev` | Apply migrations and regenerate Prisma client |
| `npm run db:seed` | Seed the database with default development data |
| `npm run db:seed-demo` | Seed a separate demo.db with sample data |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |
| `npm test` | Run Vitest unit tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run verify` | Run both test suites |

## What NOT to do

- Do not bypass the Event log. Every mutation must write an Event row.
- Do not use `any` in TypeScript — use proper types or `unknown`.
- Do not add new Zustand stores without a matching tRPC router — client state mirrors server state.
- Do not commit `data.db`, `.env`, `node_modules`, or `src-tauri/target/`.
- Do not hardcode database IDs, user paths, or personal config values in source files — use `.env` variables.
- Do not mock the database in tests — use a real SQLite test DB.
- The `archive/` folder contains retired code. Do not import from it unless explicitly asked.

## On ambiguity

If the spec or conventions are silent on something, document your assumption in a comment or in `prisma/schema.prisma` and continue. Prefer explicit over implicit.

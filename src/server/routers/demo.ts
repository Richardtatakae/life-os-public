/**
 * demo.ts — tRPC router for "demo mode".
 *
 * Demo mode swaps the whole app onto a seeded fake database (prisma/demo.db) so
 * Life OS can be shown to other people without exposing private data. The flag
 * itself lives outside both databases (see demoMode.ts); these procedures just
 * read and flip it. The Settings menu calls setMode, then reloads the page so
 * every cached query refetches against the now-active database.
 *
 * setMode writes its Event into whichever database is ACTIVE AT THE TIME OF THE
 * WRITE (we flip the flag after writing), so the "turned demo off" event lands
 * in the real DB and the "turned demo on" event lands in the real DB too —
 * keeping the demo DB's history clean of mode-toggle noise.
 */

import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { router, publicProcedure } from '@/server/trpc'
import { realPrisma } from '@/server/db/client'
import { isDemoMode, setDemoMode } from '@/server/db/demoMode'

const DEMO_DB_PATH = path.join(process.cwd(), 'prisma', 'demo.db')

export const demoRouter = router({
  // Current demo-mode state + whether the demo database has been seeded yet.
  getMode: publicProcedure.query(() => {
    return {
      enabled: isDemoMode(),
      ready: fs.existsSync(DEMO_DB_PATH),
    }
  }),

  // Turn demo mode on or off.
  setMode: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      // Guard: never enter demo mode if the demo DB hasn't been built.
      if (input.enabled && !fs.existsSync(DEMO_DB_PATH)) {
        throw new Error(
          'Demo database not found. Run `npm run db:seed-demo` to create it first.',
        )
      }

      // Always log toggle events to the REAL database (never the disposable demo
      // DB), so the history of when demo mode was used lives with your real data.
      await realPrisma.event.create({
        data: {
          actor: 'user',
          entityType: 'setting',
          entityId: 'demoMode',
          action: input.enabled ? 'enable_demo' : 'disable_demo',
          payload: { enabled: input.enabled },
        },
      })

      setDemoMode(input.enabled)
      return { ok: true, enabled: input.enabled }
    }),
})

/**
 * settings.ts — tRPC router for the key/value `AppSetting` table.
 *
 * A tiny, generic read/write API for app-level preferences that should
 * survive reloads and live in SQLite (the source of truth), e.g. the custom
 * dashboard's mosaic layout JSON under the key "dashboardLayout".
 *
 * Procedures:
 *   get(key)         — read one setting's string value (null if unset)
 *   set(key, value)  — upsert one setting's string value
 *
 * Every write goes through the event log (project rule: all state mutations
 * write an Event row).
 *
 * Redesign v2 §2.6 (Track E — Custom dashboard) introduced this router so the
 * mosaic layout can persist to AppSetting instead of localStorage.
 */

import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

export const settingsRouter = router({
  // ── get ─────────────────────────────────────────────────────────────────────
  get: publicProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ input }) => {
      const row = await prisma.appSetting.findUnique({
        where: { key: input.key },
      })
      return row?.value ?? null
    }),

  // ── set ─────────────────────────────────────────────────────────────────────
  set: publicProcedure
    .input(z.object({ key: z.string().min(1), value: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.appSetting.upsert({
        where: { key: input.key },
        create: { key: input.key, value: input.value },
        update: { value: input.value },
      })

      await writeEvent({
        actor: 'user',
        entityType: 'setting',
        entityId: input.key,
        action: 'set_setting',
        payload: { length: input.value.length },
      })

      return { ok: true }
    }),
})

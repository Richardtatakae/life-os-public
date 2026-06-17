import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * journal router — the Journal tab. Each entry is freeform text plus a small
 * daily questionnaire: eight 1-10 wellbeing sliders (mood, energy, focus,
 * stress, sleep quality, motivation, physical health, productivity) and an
 * optional typed sleep-hours number grouped with sleep quality.
 *
 * Backed by the DiaryEntry model (named to avoid colliding with another
 * internal JournalEntry model). `list` returns the newest N entries so the
 * tab can show "the last N" with a user-controlled count. Removing one is a
 * soft-delete (archivedAt). Every mutation writes an Event row (non-negotiable).
 *
 * Journal types (JournalType rows) drive the sub-tabs dynamically. The
 * canonical type is seeded on first read of listTypes.
 */

// A slider value (-5..+5, 0 = neutral), or null when the user never touched that
// slider (not recorded).
const rating = z.number().int().min(-5).max(5).nullable().optional()

// Which Journal sub-tab an entry belongs to — now any slug string (not just the
// original ones), so dynamically-created journals work without a schema change.
const kind = z.string().min(1)


export const journalRouter = router({
  // The newest `limit` entries (default 5) of one sub-tab, newest first.
  list: publicProcedure
    .input(
      z
        .object({
          kind: kind.default('journal'),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return prisma.diaryEntry.findMany({
        where: { archivedAt: null, kind: input?.kind ?? 'journal' },
        orderBy: { createdAt: 'desc' },
        take: input?.limit ?? 5,
      })
    }),

  add: publicProcedure
    .input(
      z.object({
        text: z.string().min(1).max(20000),
        kind: kind.default('journal'),
        mood: rating,
        energy: rating,
        focus: rating,
        stress: rating,
        sleepQuality: rating,
        motivation: rating,
        hope: rating,
        physicalHealth: rating,
        productivity: rating,
        sleepHours: z.number().min(0).max(24).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const entry = await prisma.diaryEntry.create({
        data: {
          text: input.text.trim(),
          kind: input.kind,
          mood: input.mood ?? null,
          energy: input.energy ?? null,
          focus: input.focus ?? null,
          stress: input.stress ?? null,
          sleepQuality: input.sleepQuality ?? null,
          motivation: input.motivation ?? null,
          hope: input.hope ?? null,
          physicalHealth: input.physicalHealth ?? null,
          productivity: input.productivity ?? null,
          sleepHours: input.sleepHours ?? null,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'diaryEntry',
        entityId: entry.id,
        action: 'add',
        payload: {
          mood: input.mood ?? null,
          energy: input.energy ?? null,
          focus: input.focus ?? null,
          stress: input.stress ?? null,
          sleepQuality: input.sleepQuality ?? null,
          motivation: input.motivation ?? null,
          hope: input.hope ?? null,
          physicalHealth: input.physicalHealth ?? null,
          productivity: input.productivity ?? null,
          sleepHours: input.sleepHours ?? null,
        },
      })
      return entry
    }),


  // Soft-delete: mark removed.
  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const entry = await prisma.diaryEntry.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'diaryEntry',
        entityId: entry.id,
        action: 'archive',
        payload: {},
      })
      return { success: true }
    }),

  // ── Journal-type management ────────────────────────────────────────────────

  /**
   * Returns active JournalType rows ordered by `order`. Seeds the canonical
   * journal type if the table is empty — this runs on every mount so it is
   * idempotent (checked via count, not a flag).
   */
  listTypes: publicProcedure.query(async () => {
    const count = await prisma.journalType.count()
    if (count === 0) {
      await prisma.journalType.createMany({
        data: [
          { slug: 'journal', name: 'Journal', order: 0 },
        ],
      })
    }
    return prisma.journalType.findMany({
      where: { archivedAt: null },
      orderBy: { order: 'asc' },
    })
  }),

  /**
   * Creates a new JournalType. Derives a unique slug from the name (lowercase,
   * kebab); appends -2, -3, … if the base slug already exists. Sets `order` to
   * max(existing order) + 1 so the new tab appears at the end.
   */
  createType: publicProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const baseSlug = input.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'journal'

      // Ensure slug uniqueness by appending a counter if needed.
      let slug = baseSlug
      let attempt = 2
      while (await prisma.journalType.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${attempt++}`
      }

      const agg = await prisma.journalType.aggregate({ _max: { order: true } })
      const order = (agg._max.order ?? -1) + 1

      const jt = await prisma.journalType.create({
        data: { name: input.name.trim(), slug, order },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'journalType',
        entityId: jt.id,
        action: 'create',
        payload: { name: jt.name, slug: jt.slug, order: jt.order },
      })
      return jt
    }),

  /**
   * Renames a JournalType. The slug is intentionally kept stable so existing
   * DiaryEntry rows that reference it by slug remain linked.
   */
  renameType: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const jt = await prisma.journalType.update({
        where: { id: input.id },
        data: { name: input.name.trim() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'journalType',
        entityId: jt.id,
        action: 'rename',
        payload: { name: jt.name },
      })
      return jt
    }),

  /**
   * Soft-deletes a JournalType by setting archivedAt. Existing DiaryEntry rows
   * that reference the slug are preserved — hard-delete is never done so old
   * entries remain accessible if the type is un-archived in the future.
   */
  archiveType: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const jt = await prisma.journalType.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'journalType',
        entityId: jt.id,
        action: 'archive',
        payload: { slug: jt.slug },
      })
      return { success: true }
    }),
})

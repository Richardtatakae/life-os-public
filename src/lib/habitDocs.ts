/**
 * habitDocs — maps a habit name to a "distilled" reference guide saved in
 * ~/Distilled. When a habit has an entry here, clicking its name in the
 * LifeHabitTracker opens that guide in a new browser tab. The files are served
 * live (not copied into the build) by the /distilled/[file] route handler, which
 * reads straight from the Distilled folder and only serves filenames listed here.
 *
 * Only the habits with a matching HTML deep-dive are linked.
 */

/** Habit name (exact) → filename inside ~/Distilled. */
export const HABIT_DOCS: Record<string, string> = {
}

/** Filenames the /distilled route is allowed to serve (path-traversal guard). */
export const DISTILLED_ALLOW = new Set(Object.values(HABIT_DOCS))

/** In-app URL that serves a habit's guide, or null when the habit has none. */
export function habitDocUrl(name: string): string | null {
  const file = HABIT_DOCS[name]
  return file ? `/distilled/${encodeURIComponent(file)}` : null
}

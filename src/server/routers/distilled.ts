import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { router, publicProcedure } from '@/server/trpc'
import { writeEvent } from '@/server/db/events'
import { isHiddenInDemo } from '@/server/db/demoMode'

const pExecFile = promisify(execFile)

/**
 * distilled router — access to the documents produced by the `/distill` skill,
 * which writes self-contained HTML files (and optional PDFs) to `~/Distilled/`.
 *
 * `list` returns one entry per `.html` file (title parsed from the file, plus
 * size / modified time / whether a matching PDF exists). `read` returns the
 * full HTML of one document so the UI can show it in a sandboxed <iframe>.
 * `remove` moves a document (HTML + matching PDF) to the macOS Trash so it's
 * recoverable; it writes an Event row since it mutates the filesystem.
 */

// Where the /distill skill writes its output (see the skill's OUTPUT_DIR).
const DISTILLED_DIR = path.join(homedir(), 'Distilled')

// Only ever read a single filename inside DISTILLED_DIR — no path separators,
// no traversal. Matches the slugs /distill produces (e.g. "win-tonight").
const SLUG = z.string().regex(/^[A-Za-z0-9._-]+$/)

/** Pull the <title> out of an HTML string; fall back to null. */
function parseTitle(html: string): string | null {
  const m = html.match(/<title>([^<]*)<\/title>/i)
  if (!m) return null
  const t = m[1].trim()
  return t.length > 0 ? t : null
}

/** Turn a slug like "win-tonight" into "Win tonight" for a fallback title. */
function prettySlug(slug: string): string {
  const s = slug.replace(/[-_]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Send a file to the macOS Trash (recoverable) via Finder. If that's
 * unavailable for any reason, fall back to a permanent delete. No-op if the
 * file doesn't exist. The path is built from a trusted home dir + a strictly
 * validated slug, so it's safe to inline in the AppleScript.
 */
async function trashIfExists(fullPath: string): Promise<void> {
  try {
    await fs.access(fullPath)
  } catch {
    return // already gone
  }
  try {
    await pExecFile('osascript', [
      '-e',
      `tell application "Finder" to delete POSIX file "${fullPath}"`,
    ])
  } catch {
    await fs.unlink(fullPath).catch(() => {})
  }
}

export const distilledRouter = router({
  // Every distilled HTML doc, newest first.
  list: publicProcedure.query(async () => {
    let names: string[]
    try {
      names = await fs.readdir(DISTILLED_DIR)
    } catch {
      // Directory doesn't exist yet (no docs distilled) — show an empty list.
      return []
    }

    // In demo mode, hide private / sensitive documents (these files live in
    // ~/Distilled, outside the swappable database — see demoMode.ts).
    const htmlFiles = names
      .filter((n) => n.toLowerCase().endsWith('.html'))
      .filter((n) => !isHiddenInDemo(n))
    const pdfSet = new Set(
      names.filter((n) => n.toLowerCase().endsWith('.pdf')).map((n) => n.slice(0, -4)),
    )

    const entries = await Promise.all(
      htmlFiles.map(async (file) => {
        const slug = file.slice(0, -5) // drop ".html"
        const full = path.join(DISTILLED_DIR, file)
        const stat = await fs.stat(full)
        // Read just the head to find <title> without slurping a 3MB file.
        let title: string | null = null
        try {
          const fh = await fs.open(full, 'r')
          try {
            const buf = Buffer.alloc(16384)
            const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
            title = parseTitle(buf.toString('utf8', 0, bytesRead))
          } finally {
            await fh.close()
          }
        } catch {
          title = null
        }
        return {
          slug,
          title: title ?? prettySlug(slug),
          sizeBytes: stat.size,
          modifiedAt: stat.mtime,
          hasPdf: pdfSet.has(slug),
        }
      }),
    )

    entries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
    return entries
  }),

  // Full HTML of one document, for rendering in a sandboxed iframe.
  read: publicProcedure.input(z.object({ slug: SLUG })).query(async ({ input }) => {
    // Demo mode: refuse to serve a hidden document even by direct slug.
    if (isHiddenInDemo(`${input.slug}.html`)) {
      throw new Error('Document not found')
    }
    const full = path.join(DISTILLED_DIR, `${input.slug}.html`)
    // Defense-in-depth: ensure the resolved path is still inside DISTILLED_DIR.
    if (path.dirname(full) !== DISTILLED_DIR) {
      throw new Error('Invalid document path')
    }
    const html = await fs.readFile(full, 'utf8')
    return { slug: input.slug, html }
  }),

  // Move a document (and its matching PDF, if any) to the Trash.
  remove: publicProcedure.input(z.object({ slug: SLUG })).mutation(async ({ input }) => {
    const htmlPath = path.join(DISTILLED_DIR, `${input.slug}.html`)
    const pdfPath = path.join(DISTILLED_DIR, `${input.slug}.pdf`)
    // Defense-in-depth: both must resolve to a file directly inside DISTILLED_DIR.
    if (path.dirname(htmlPath) !== DISTILLED_DIR || path.dirname(pdfPath) !== DISTILLED_DIR) {
      throw new Error('Invalid document path')
    }
    await trashIfExists(htmlPath)
    await trashIfExists(pdfPath)
    await writeEvent({
      actor: 'user',
      entityType: 'distilledDoc',
      entityId: input.slug,
      action: 'trash',
      payload: { slug: input.slug },
    })
    return { success: true }
  }),
})

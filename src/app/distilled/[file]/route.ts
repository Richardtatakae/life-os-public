/**
 * /distilled/[file] — serves a "distilled" reference guide from ~/Distilled so a
 * habit name in the LifeHabitTracker can link to it (opens in a new tab). Files
 * are read live from disk on each request — edit the HTML in ~/Distilled and a
 * refresh shows the new version, nothing is copied into the build.
 *
 * Only filenames in DISTILLED_ALLOW (the four habit guides) are served; anything
 * else — including path-traversal attempts like "../" — returns 404.
 */

import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DISTILLED_ALLOW } from '@/lib/habitDocs'
import { isHiddenInDemo } from '@/server/db/demoMode'

const DISTILLED_DIR = path.join(os.homedir(), 'Distilled')

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const name = decodeURIComponent(file)

  // In demo mode, private / sensitive habit guides are hidden even by direct URL.
  if (!DISTILLED_ALLOW.has(name) || isHiddenInDemo(name)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const buf = await readFile(path.join(DISTILLED_DIR, name))
    const type = name.endsWith('.pdf') ? 'application/pdf' : 'text/html; charset=utf-8'
    return new Response(buf, { headers: { 'content-type': type } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

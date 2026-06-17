/**
 * demoMode.ts — the single source of truth for "demo mode".
 *
 * Demo mode swaps the app's database from the real `prisma/data.db` to a
 * seeded, fake `prisma/demo.db` so Life OS can be shown to other people without
 * exposing any private data. The toggle lives in the ⚙ Settings menu and is
 * driven by the `demo` tRPC router.
 *
 * The flag is stored in a tiny file (`prisma/.demo-mode`) so it survives a full
 * app restart and is decoupled from BOTH databases (storing it inside a DB that
 * itself gets swapped would be circular). At module load we read that file once
 * into a process-global boolean; the Prisma proxy (client.ts) reads this boolean
 * on every query to pick which database to talk to. Using a process-global (not
 * a plain module variable) keeps every Next.js server module instance in sync.
 *
 * Beyond the DB swap, two things in Life OS live OUTSIDE data.db and would leak
 * in a demo, so this module also owns the rule for what counts as private
 * "sensitive" content — used to hide private files in the Distilled tab,
 * which reads real files straight from ~/Distilled.
 */

import fs from 'node:fs'
import path from 'node:path'

const STATE_FILE = path.join(process.cwd(), 'prisma', '.demo-mode')

const g = globalThis as unknown as { __lifeosDemoMode?: boolean }

/** Read the persisted flag once at boot. Missing / unreadable file = off. */
function readInitial(): boolean {
  try {
    return fs.readFileSync(STATE_FILE, 'utf8').trim() === 'on'
  } catch {
    return false
  }
}

if (g.__lifeosDemoMode === undefined) {
  g.__lifeosDemoMode = readInitial()
}

/** True when the app should be reading the fake demo database. */
export function isDemoMode(): boolean {
  return g.__lifeosDemoMode === true
}

/** Flip demo mode on/off and persist it so it survives a restart. */
export function setDemoMode(on: boolean): void {
  g.__lifeosDemoMode = on
  try {
    fs.writeFileSync(STATE_FILE, on ? 'on' : 'off')
  } catch {
    // Persisting is best-effort; the in-memory flag still applies this session.
  }
}

// ── Sensitive-content rule (for the Distilled tab) ──────────────────────────
//
// The Distilled tab serves HTML/PDF files straight from ~/Distilled, which is
// NOT part of the swappable database. In demo mode we still show the tab, but
// hide any private / sensitive documents by filename keyword.
const SENSITIVE_PATTERNS: RegExp[] = [
]

/** True if a filename looks like private / sensitive content. */
export function isSensitiveFilename(name: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(name))
}

/** True if this file should be hidden RIGHT NOW (i.e. demo mode + sensitive). */
export function isHiddenInDemo(name: string): boolean {
  return isDemoMode() && isSensitiveFilename(name)
}

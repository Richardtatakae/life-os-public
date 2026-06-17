/**
 * vow.spec.ts — Vow Mode e2e smoke test.
 *
 * Covers the full core loop:
 *   1. Navigate to Pursuits tab, create an area + task (TEST_PREFIX named).
 *   2. Open task's ItemDetailModal (⚙ gear button) → "Swear a Vow".
 *   3. Fill "Done means:" criteria; hold commit button 3.4s to activate.
 *   4. Assert VowBar is visible (task title + "Vows kept").
 *   5. Tab friction: click Ideas tab → VowInterstitial shows.
 *   6. Type a thought → "Park the thought" → "Parked ✓" flash; stay on Pursuits.
 *   7. Override: type a reason → "Override anyway" → navigate to Ideas.
 *   8. Assert "⛓ Captured under vow" box contains the parked thought.
 *   9. Done: Done button → CompleteConfirm → check criterion → "Complete the vow".
 *  10. Celebration → Continue → journal prompt → Skip.
 *  11. Assert VowBar is gone.
 *
 * Setup/teardown: uses tRPC HTTP batch calls to clean up TEST_PREFIX rows before
 * the test runs so the suite is idempotent (re-runnable).
 */

import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

const TEST_PREFIX   = 'VOW_E2E_'
const AREA_NAME     = `${TEST_PREFIX}Area`
const TASK_TITLE    = `${TEST_PREFIX}Task`
const CRITERIA      = 'The e2e test is green and all assertions pass'
const PARK_TEXT     = `${TEST_PREFIX}Parked thought from test`
const OVERRIDE_REASON = `${TEST_PREFIX}Override reason from test`

// VOW_HOLD_MS is 3000ms — hold 3400ms to be safe across CI timing variance.
const HOLD_MS = 3400

// ── DB cleanup helper ─────────────────────────────────────────────────────────
// Calls an external cleanup script that uses Prisma raw SQL to delete all
// TEST_PREFIX rows. Raw SQL bypasses soft-delete and FK issues.
//
// The app has a "demo mode" (prisma/.demo-mode = "on") that swaps the database
// from data.db to demo.db. We check the flag here and pass the correct
// DATABASE_URL so cleanup hits whichever DB the dev server is actually using.
function cleanupTestData() {
  const fs = require('fs')
  const path = require('path')
  const CWD = process.cwd()
  const demoFlagPath = path.join(CWD, 'prisma', '.demo-mode')
  let demoMode = false
  try { demoMode = fs.readFileSync(demoFlagPath, 'utf8').trim() === 'on' } catch { /* not set */ }
  const dbFile = demoMode ? 'demo.db' : 'data.db'
  const dbUrl = `file:${path.join(CWD, 'prisma', dbFile)}`
  execSync('node tests/e2e/cleanup-vow-e2e.js', {
    cwd: CWD,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: dbUrl },
  })
}

// ── Test ──────────────────────────────────────────────────────────────────────

// ── Demo mode guard ───────────────────────────────────────────────────────────
// If the app is in demo mode (prisma/.demo-mode = "on"), the dev server
// serves data from prisma/demo.db which may be out-of-date (e.g. missing the
// `heading` column added to the Idea table). We turn demo mode off before each
// run so the test always hits the fully-migrated data.db.
// We use the tRPC demo.setMode endpoint rather than writing the flag file
// directly, so the server's in-memory flag is also updated (the flag is
// read once at module load and cached in globalThis).
async function ensureDemoModeOff() {
  const { execSync } = require('child_process')
  execSync(
    'node -e "require(\'./node_modules/@prisma/client\');" 2>/dev/null; exit 0',
    { cwd: process.cwd(), stdio: 'pipe' },
  )
  // Call the running dev server to flip demo mode off.
  try {
    const res = await fetch(
      'http://localhost:3001/api/trpc/demo.setMode?batch=1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ '0': { json: { enabled: false } } }),
      },
    )
    if (!res.ok) {
      // If setMode fails, fall back to writing the flag directly so at least
      // the next server restart will start in the right mode.
      const fs = require('fs')
      const path = require('path')
      fs.writeFileSync(path.join(process.cwd(), 'prisma', '.demo-mode'), 'off')
    }
  } catch {
    // If the server isn't up yet, write the flag file directly.
    const fs = require('fs')
    const path = require('path')
    fs.writeFileSync(path.join(process.cwd(), 'prisma', '.demo-mode'), 'off')
  }
}

test.describe('Vow Mode core loop', () => {
  test.beforeAll(async () => {
    await ensureDemoModeOff()
    try { cleanupTestData() } catch { /* ignore — may not exist */ }
  })

  test.afterAll(() => {
    try { cleanupTestData() } catch { /* best-effort */ }
  })

  test('activate → friction → park → override → complete → released', async ({ page }) => {
    // ── 0. Boot ──────────────────────────────────────────────────────────────
    // Pre-set the tab order so Ideas is in the primary 6 (not hidden in "More ▾").
    // Zustand persist wraps state under a {"state": {...}, "version": 0} envelope.
    await page.addInitScript(() => {
      const KEY = 'life-os-ui'
      const stored = localStorage.getItem(KEY)
      const parsed = stored ? JSON.parse(stored) : {}
      // Zustand persist uses a {"state": {...}} envelope
      if (!parsed.state) parsed.state = {}
      parsed.state.tabOrder = [
        'dashboard', 'habits', 'tasks', 'schedule', 'ideas', 'journal',
        'distilled', 'progress', 'routines', 'projects-on-ice',
      ]
      localStorage.setItem(KEY, JSON.stringify(parsed))
    })
    await page.goto('/')
    const tablist = page.getByRole('tablist')
    await expect(tablist).toBeVisible()

    // ── 1. Navigate to Pursuits (tasks) tab ──────────────────────────────────
    // TAB_LABELS maps 'tasks' → 'Pursuits' (see uiStore.ts).
    const pursuitTabBtn = tablist.getByRole('tab', { name: /^Pursuits$/i })
    await pursuitTabBtn.click()

    // ── 2. Create area ───────────────────────────────────────────────────────
    // The "Add area" button is a GhostAction in the AreasPanel header (always
    // visible — no hover required). aria-label="Add area", text "+ area".
    await page.getByRole('button', { name: 'Add area' }).click()

    const areaInput = page.getByPlaceholder('New area…')
    await areaInput.fill(AREA_NAME)
    await areaInput.press('Enter')

    // Wait for the area to appear. Use .first() to avoid strict-mode errors
    // if a duplicate somehow exists.
    await expect(page.getByText(AREA_NAME).first()).toBeVisible({ timeout: 8000 })

    // ── 3. Create task under the area ────────────────────────────────────────
    // Click the area row to select it — this makes the Tasks panel show
    // "Loose tasks" with an "Add task" button (aria-label="Add task", text "+ task").
    const areaNameSpan = page.getByText(AREA_NAME, { exact: true }).first()
    await areaNameSpan.click()

    // "+ task" button is in the Tasks panel header (always visible once an area
    // is selected; no hover needed).
    const newTaskBtn = page.getByRole('button', { name: 'Add task' }).first()
    await newTaskBtn.click()

    const taskInput = page.getByPlaceholder('New task…')
    await taskInput.fill(TASK_TITLE)
    await taskInput.press('Enter')

    await expect(page.getByText(TASK_TITLE).first()).toBeVisible({ timeout: 8000 })

    // Dismiss any lingering inline input.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // ── 4. Open ItemDetailModal → "Swear a Vow" ──────────────────────────────
    // The TaskTreeNode has hover-visible action buttons (opacity-0 → opacity-100).
    // The ⚙ gear button (aria-label "Edit all details") opens ItemDetailModal,
    // which contains the "Swear a Vow" entry point.
    //
    // We anchor to the task's complete button (role="button", aria-label "Complete: <title>" in V2)
    // to scope the hover to the correct row rather than the area header row.
    const taskCheckbox = page.getByRole('button', { name: new RegExp(`^Complete: ${TASK_TITLE}$`, 'i') }).first()
    await taskCheckbox.hover()

    // ⚙ gear button opens ItemDetailModal — scoped to the row containing the task.
    // The row is a flex div that is the parent of the checkbox.
    const taskRow = taskCheckbox.locator('xpath=ancestor::div[contains(@class,"flex")][1]')
    const gearBtn = taskRow.getByRole('button', { name: /Edit all details/i })
    await gearBtn.click()

    // "Swear a Vow" button should now be visible in the inline ItemDetailModal.
    const swearVowBtn = page.getByRole('button', { name: /Swear a Vow/i })
    await expect(swearVowBtn).toBeVisible({ timeout: 5000 })
    await swearVowBtn.click()

    // ── 5. Fill VowActivationModal criteria ──────────────────────────────────
    const criteriaTextarea = page.getByLabel(/Done means/i)
    await expect(criteriaTextarea).toBeVisible({ timeout: 3000 })
    await criteriaTextarea.fill(CRITERIA)

    // ── 6. Hold the commit button for 3.4s ───────────────────────────────────
    // Uses pointer events (onPointerDown/onPointerUp) so we dispatch pointerdown
    // → wait → pointerup rather than mouse events.
    const holdBtn = page.getByRole('button', { name: /Hold to swear the vow/i })
    await expect(holdBtn).toBeEnabled({ timeout: 2000 })

    // Use Playwright's mouse API to simulate a real press-and-hold (more reliable
    // than dispatchEvent because it uses the browser's native input system).
    const box = await holdBtn.boundingBox()
    if (!box) throw new Error('Could not find bounding box of hold button')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.waitForTimeout(HOLD_MS)
    await page.mouse.up()

    // Modal closes; VowBar mounts at top (role="banner", aria-label="Vow Mode — active").
    const vowBar = page.getByRole('banner', { name: /Vow Mode/i })
    await expect(vowBar).toBeVisible({ timeout: 10_000 })

    // ── 7. Assert VowBar chrome ──────────────────────────────────────────────
    await expect(vowBar.getByText(TASK_TITLE)).toBeVisible()
    await expect(vowBar.getByText(/Vows kept/i)).toBeVisible()

    // ── 8. Tab friction — click Ideas tab ────────────────────────────────────
    const ideasTabBtn = tablist.getByRole('tab', { name: /^Ideas$/i })
    await ideasTabBtn.click()

    // VowInterstitial should appear (role="dialog", aria-label="Vow interstitial").
    const interstitial = page.getByRole('dialog', { name: /Vow interstitial/i })
    await expect(interstitial).toBeVisible({ timeout: 5000 })
    await expect(interstitial.getByText(/You.re under vow/i)).toBeVisible()

    // ── 9. Park the thought ──────────────────────────────────────────────────
    const thoughtTextarea = interstitial.getByPlaceholder("What's on your mind?")
    await thoughtTextarea.fill(PARK_TEXT)
    await interstitial.getByRole('button', { name: /Park the thought/i }).click()

    // Confirmation flash appears briefly then interstitial closes.
    // Allow 8s — the tRPC idea.create call can be slow on first load in dev.
    await expect(interstitial.getByText(/Parked ✓/i)).toBeVisible({ timeout: 8000 })
    await expect(interstitial).not.toBeVisible({ timeout: 5000 })

    // VowBar is still visible; we stayed on Pursuits tab.
    await expect(vowBar).toBeVisible()

    // ── 10. Override to navigate to Ideas ────────────────────────────────────
    await ideasTabBtn.click()
    const interstitial2 = page.getByRole('dialog', { name: /Vow interstitial/i })
    await expect(interstitial2).toBeVisible({ timeout: 3000 })

    const overrideTextarea = interstitial2.getByPlaceholder("What's on your mind?")
    await overrideTextarea.fill(OVERRIDE_REASON)
    await interstitial2.getByRole('button', { name: /Override anyway/i }).click()

    // Navigated to Ideas — interstitial gone, vow bar still present.
    await expect(interstitial2).not.toBeVisible({ timeout: 5000 })
    await expect(vowBar).toBeVisible()

    // ── 11. Assert "Captured under vow" box contains parked thought ──────────
    await expect(page.getByText(/Captured under vow/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(PARK_TEXT)).toBeVisible()

    // ── 12. Complete the vow ─────────────────────────────────────────────────
    // Click "Done" in VowBar → VowExitFlow opens (role="dialog", aria-label="Vow exit flow").
    await vowBar.getByRole('button', { name: /^Done$/i }).click()

    const exitDialog = page.getByRole('dialog', { name: /Vow exit flow/i })
    await expect(exitDialog).toBeVisible({ timeout: 3000 })

    // Stage 1 — confirm: criteria blockquote + checkbox.
    await expect(exitDialog.getByText(CRITERIA)).toBeVisible()
    await exitDialog.getByRole('checkbox').check()

    const completeBtn = exitDialog.getByRole('button', { name: /Complete the vow/i })
    await expect(completeBtn).toBeEnabled()
    await completeBtn.click()

    // Stage 2 — celebrate: "Vow kept." heading.
    await expect(exitDialog.getByText(/Vow kept/i)).toBeVisible({ timeout: 10_000 })
    await exitDialog.getByRole('button', { name: /Continue/i }).click()

    // Stage 3 — journal prompt → Skip.
    await expect(exitDialog.getByText(/How did you break the resistance/i)).toBeVisible({ timeout: 3000 })
    await exitDialog.getByRole('button', { name: /^Skip$/i }).click()

    // ── 13. Assert VowBar is gone ────────────────────────────────────────────
    await expect(vowBar).not.toBeVisible({ timeout: 10_000 })
  })
})

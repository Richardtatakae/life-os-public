/**
 * smoke.spec.ts — minimal e2e smoke test.
 *
 * The original critical-paths.spec.ts covered v1 systems (streak habits,
 * rings, coaching, schedule slots) that were archived on 2026-06-10 — see
 * archive/README.md. This spec keeps the Playwright harness alive (an empty
 * testDir makes `playwright test` exit non-zero) and verifies the app boots:
 * the shell renders and the tab bar is interactive.
 */

import { test, expect } from '@playwright/test'

test('app boots and the tab shell renders', async ({ page }) => {
  await page.goto('/')

  // The TabBar renders one button per tab inside a tablist nav.
  // Use exact tab-role matches so "Dashboard" / "Pursuits" don't also match
  // the "Pursuits A" / "Pursuits B" experiment tabs (strict-mode safe).
  const tablist = page.getByRole('tablist')
  await expect(tablist).toBeVisible()
  await expect(tablist.getByRole('tab', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(tablist.getByRole('tab', { name: 'Pursuits', exact: true })).toBeVisible()
})

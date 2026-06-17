/**
 * pursuits.spec.ts — e2e spec for the Pursuits board.
 *
 * Asserts that clicking the "Pursuits" tab renders the board with its five
 * panel headers. Seed-data independent — only header visibility is checked.
 *
 * Five expected headers (exact contract from the design spec):
 *   "Up next" | "Pursuits" | "Problems (N)" | "Deadlines" | "Plan your days"
 *
 * Selector strategy:
 *   All assertions are scoped inside `data-testid="pursuits-board"` so the
 *   "Pursuits" tab button in the tablist never matches. Within the board,
 *   "Pursuits" appears twice (an <h1> page title and the panel's <h2>), so
 *   the two panels that render real <h2> headings ("Pursuits", "Plan your
 *   days") are asserted via a level-2 heading role. The other three panel
 *   headers ("Up next", "Problems (N)", "Deadlines") are <h3> elements, so
 *   heading-role prefix matching is used to accommodate the count suffix in
 *   "Problems (N)" and to be future-proof against minor copy changes.
 */

import { test, expect } from '@playwright/test'

test('Pursuits board renders five panel headers', async ({ page }) => {
  await page.goto('/')

  // Click the Pursuits tab in the tablist nav. Use an exact tab-role match so
  // it doesn't collide with the "Pursuits A" / "Pursuits B" experiment tabs.
  const tablist = page.getByRole('tablist')
  await tablist.getByRole('tab', { name: 'Pursuits', exact: true }).click()

  // Wait for the board to appear — scoped to the board container so the
  // "Pursuits" panel header doesn't collide with the tab button above.
  const board = page.getByTestId('pursuits-board')
  await expect(board).toBeVisible()

  // Assert all five panel headers are visible within the board.
  // "Pursuits" and "Plan your days" are <h2> panel headings — use a level-2
  // heading role so the <h1> page title "Pursuits" can't match.
  // "Up next", "Problems (N)", and "Deadlines" are <h3> headings — use
  // heading role with prefix regex so "Problems (N)" matches regardless of count.
  await expect(
    board.getByRole('heading', { name: /^Up next/ })
  ).toBeVisible()
  await expect(
    board.getByRole('heading', { level: 2, name: 'Pursuits', exact: true })
  ).toBeVisible()
  await expect(
    board.getByRole('heading', { name: /^Problems/ })
  ).toBeVisible()
  await expect(
    board.getByRole('heading', { name: /^Deadlines/ })
  ).toBeVisible()
  await expect(
    board.getByRole('heading', { level: 2, name: 'Plan your days', exact: true })
  ).toBeVisible()
})

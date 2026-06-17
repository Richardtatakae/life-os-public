/**
 * Cleanup script for vow.spec.ts — run before/after the test to delete
 * all rows with the VOW_E2E_ prefix.
 *
 * Uses PRAGMA foreign_keys = OFF so FK cascades don't block the deletes.
 */
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function run() {
  await p.$executeRaw`PRAGMA foreign_keys = OFF`
  await p.$executeRaw`DELETE FROM Idea WHERE text LIKE 'VOW_E2E_%'`
  // Delete vows linked to test tasks (must happen before task delete, FK off).
  await p.$executeRaw`DELETE FROM Vow WHERE taskId IN (SELECT id FROM Task WHERE title LIKE 'VOW_E2E_%')`
  await p.$executeRaw`DELETE FROM Task WHERE title LIKE 'VOW_E2E_%'`
  await p.$executeRaw`DELETE FROM Area WHERE name LIKE 'VOW_E2E_%'`
  // Also kill any orphaned vows whose tasks were already deleted.
  await p.$executeRaw`DELETE FROM Vow WHERE endedAt IS NULL AND taskId NOT IN (SELECT id FROM Task)`
  await p.$executeRaw`PRAGMA foreign_keys = ON`
}

run().then(() => p.$disconnect()).catch(e => { process.stderr.write(e.message + '\n'); p.$disconnect() })

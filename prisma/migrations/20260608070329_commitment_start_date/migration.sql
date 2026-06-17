-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecurringCommitment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "startMin" INTEGER NOT NULL DEFAULT 540,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "weekdays" TEXT NOT NULL DEFAULT '',
    "anchorWeek" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_RecurringCommitment" ("active", "anchorWeek", "createdAt", "durationMin", "frequency", "id", "position", "startMin", "title", "weekdays") SELECT "active", "anchorWeek", "createdAt", "durationMin", "frequency", "id", "position", "startMin", "title", "weekdays" FROM "RecurringCommitment";
DROP TABLE "RecurringCommitment";
ALTER TABLE "new_RecurringCommitment" RENAME TO "RecurringCommitment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LifeHabit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "autoSince" TEXT,
    "notes" TEXT,
    "peakScore" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME
);
INSERT INTO "new_LifeHabit" ("archivedAt", "autoSince", "createdAt", "id", "name", "notes", "position", "startDate") SELECT "archivedAt", "autoSince", "createdAt", "id", "name", "notes", "position", "startDate" FROM "LifeHabit";
DROP TABLE "LifeHabit";
ALTER TABLE "new_LifeHabit" RENAME TO "LifeHabit";
CREATE INDEX "LifeHabit_archivedAt_idx" ON "LifeHabit"("archivedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

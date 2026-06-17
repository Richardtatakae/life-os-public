-- Move from a single attached Routine per LifeHabit (LifeHabit.routineId) to a
-- many-to-many via the HabitRoutine join table. The habit's day auto-ticks when
-- ANY one attached routine is fully checked (OR logic). Existing single
-- attachments are preserved by copying them into HabitRoutine before the
-- routineId column is dropped.

-- CreateTable
CREATE TABLE "HabitRoutine" (
    "habitId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("habitId", "routineId"),
    CONSTRAINT "HabitRoutine_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "LifeHabit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HabitRoutine_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Preserve existing single attachments (LifeHabit.routineId) as join rows.
INSERT INTO "HabitRoutine" ("habitId", "routineId", "position", "createdAt")
SELECT "id", "routineId", 0, CURRENT_TIMESTAMP FROM "LifeHabit" WHERE "routineId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "HabitRoutine_routineId_idx" ON "HabitRoutine"("routineId");

-- RedefineTables: drop the now-unused routineId column from LifeHabit.
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
INSERT INTO "new_LifeHabit" ("id", "name", "startDate", "position", "autoSince", "notes", "peakScore", "createdAt", "archivedAt") SELECT "id", "name", "startDate", "position", "autoSince", "notes", "peakScore", "createdAt", "archivedAt" FROM "LifeHabit";
DROP TABLE "LifeHabit";
ALTER TABLE "new_LifeHabit" RENAME TO "LifeHabit";
CREATE INDEX "LifeHabit_archivedAt_idx" ON "LifeHabit"("archivedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

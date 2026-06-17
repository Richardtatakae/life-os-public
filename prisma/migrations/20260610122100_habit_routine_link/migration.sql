-- CreateTable
CREATE TABLE "RoutineCondition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routineId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoutineCondition_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HabitRoutineCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "habitId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HabitRoutineCheck_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "LifeHabit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "routineId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "LifeHabit_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LifeHabit" ("archivedAt", "autoSince", "createdAt", "id", "name", "notes", "peakScore", "position", "startDate") SELECT "archivedAt", "autoSince", "createdAt", "id", "name", "notes", "peakScore", "position", "startDate" FROM "LifeHabit";
DROP TABLE "LifeHabit";
ALTER TABLE "new_LifeHabit" RENAME TO "LifeHabit";
CREATE INDEX "LifeHabit_archivedAt_idx" ON "LifeHabit"("archivedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RoutineCondition_routineId_idx" ON "RoutineCondition"("routineId");

-- CreateIndex
CREATE INDEX "HabitRoutineCheck_habitId_date_idx" ON "HabitRoutineCheck"("habitId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HabitRoutineCheck_habitId_date_sourceId_key" ON "HabitRoutineCheck"("habitId", "date", "sourceId");

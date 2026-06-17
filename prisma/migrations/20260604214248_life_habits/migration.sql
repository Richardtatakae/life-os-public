-- CreateTable
CREATE TABLE "LifeHabit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME
);

-- CreateTable
CREATE TABLE "LifeHabitDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "habitId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LifeHabitDay_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "LifeHabit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LifeHabit_archivedAt_idx" ON "LifeHabit"("archivedAt");

-- CreateIndex
CREATE INDEX "LifeHabitDay_date_idx" ON "LifeHabitDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LifeHabitDay_habitId_date_key" ON "LifeHabitDay"("habitId", "date");

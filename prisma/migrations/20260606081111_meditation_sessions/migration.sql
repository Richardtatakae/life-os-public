-- CreateTable
CREATE TABLE "MeditationSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "habitId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeditationSession_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "LifeHabit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MeditationSession_habitId_date_idx" ON "MeditationSession"("habitId", "date");

-- CreateIndex
CREATE INDEX "MeditationSession_date_idx" ON "MeditationSession"("date");

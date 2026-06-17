-- CreateTable
CREATE TABLE "DiaryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mood" INTEGER NOT NULL,
    "energy" INTEGER NOT NULL,
    "focus" INTEGER NOT NULL,
    "stress" INTEGER NOT NULL,
    "sleepQuality" INTEGER NOT NULL,
    "motivation" INTEGER NOT NULL,
    "physicalHealth" INTEGER NOT NULL,
    "productivity" INTEGER NOT NULL,
    "sleepHours" REAL,
    "archivedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "DiaryEntry_archivedAt_idx" ON "DiaryEntry"("archivedAt");

-- CreateIndex
CREATE INDEX "DiaryEntry_createdAt_idx" ON "DiaryEntry"("createdAt");

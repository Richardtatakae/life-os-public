-- AlterTable
ALTER TABLE "Idea" ADD COLUMN "source" TEXT;

-- CreateTable
CREATE TABLE "Vow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "finishCriteria" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "outcome" TEXT,
    "breakReason" TEXT,
    CONSTRAINT "Vow_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Vow_endedAt_idx" ON "Vow"("endedAt");

-- CreateIndex
CREATE INDEX "Vow_taskId_idx" ON "Vow"("taskId");

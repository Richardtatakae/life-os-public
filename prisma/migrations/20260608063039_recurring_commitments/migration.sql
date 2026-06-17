-- AlterTable
ALTER TABLE "PlannerBlock" ADD COLUMN "commitmentId" TEXT;

-- CreateTable
CREATE TABLE "RecurringCommitment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "startMin" INTEGER NOT NULL DEFAULT 540,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "weekdays" TEXT NOT NULL DEFAULT '',
    "anchorWeek" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CommitmentInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commitmentId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommitmentInstance_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "RecurringCommitment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CommitmentInstance_date_idx" ON "CommitmentInstance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "CommitmentInstance_commitmentId_date_key" ON "CommitmentInstance"("commitmentId", "date");

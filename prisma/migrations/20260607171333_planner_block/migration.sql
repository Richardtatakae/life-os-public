-- CreateTable
CREATE TABLE "PlannerBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'task',
    "energy" TEXT NOT NULL DEFAULT 'med',
    "durationMin" INTEGER NOT NULL DEFAULT 20,
    "placed" BOOLEAN NOT NULL DEFAULT false,
    "startMin" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "landmark" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "taskId" TEXT,
    "goalId" TEXT,
    CONSTRAINT "PlannerBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlannerBlock_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlannerBlock_date_idx" ON "PlannerBlock"("date");

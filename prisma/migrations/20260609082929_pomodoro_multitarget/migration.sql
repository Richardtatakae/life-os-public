-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Pomodoro" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "goalId" TEXT,
    "projectId" TEXT,
    "areaId" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "targetMin" INTEGER NOT NULL DEFAULT 25,
    "status" TEXT NOT NULL DEFAULT 'running',
    "notes" TEXT,
    CONSTRAINT "Pomodoro_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Pomodoro_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pomodoro_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pomodoro_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Pomodoro" ("endedAt", "id", "notes", "pausedMs", "startedAt", "status", "targetMin", "taskId") SELECT "endedAt", "id", "notes", "pausedMs", "startedAt", "status", "targetMin", "taskId" FROM "Pomodoro";
DROP TABLE "Pomodoro";
ALTER TABLE "new_Pomodoro" RENAME TO "Pomodoro";
CREATE INDEX "Pomodoro_taskId_idx" ON "Pomodoro"("taskId");
CREATE INDEX "Pomodoro_goalId_idx" ON "Pomodoro"("goalId");
CREATE INDEX "Pomodoro_projectId_idx" ON "Pomodoro"("projectId");
CREATE INDEX "Pomodoro_areaId_idx" ON "Pomodoro"("areaId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

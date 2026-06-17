-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlannerBlock" (
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
    "parentId" TEXT,
    CONSTRAINT "PlannerBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlannerBlock_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlannerBlock_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PlannerBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlannerBlock" ("completedAt", "createdAt", "date", "durationMin", "energy", "goalId", "id", "kind", "landmark", "placed", "position", "startMin", "status", "taskId", "title") SELECT "completedAt", "createdAt", "date", "durationMin", "energy", "goalId", "id", "kind", "landmark", "placed", "position", "startMin", "status", "taskId", "title" FROM "PlannerBlock";
DROP TABLE "PlannerBlock";
ALTER TABLE "new_PlannerBlock" RENAME TO "PlannerBlock";
CREATE INDEX "PlannerBlock_date_idx" ON "PlannerBlock"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

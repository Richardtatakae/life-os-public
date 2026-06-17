-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dependentId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,
    CONSTRAINT "TaskDependency_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "lifeArea" TEXT,
    "targetMetric" TEXT,
    "targetValue" REAL,
    "deadline" DATETIME,
    "parentId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Goal_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Goal" ("completedAt", "createdAt", "deadline", "description", "id", "lifeArea", "parentId", "status", "targetMetric", "targetValue", "title") SELECT "completedAt", "createdAt", "deadline", "description", "id", "lifeArea", "parentId", "status", "targetMetric", "targetValue", "title" FROM "Goal";
DROP TABLE "Goal";
ALTER TABLE "new_Goal" RENAME TO "Goal";
CREATE INDEX "Goal_parentId_idx" ON "Goal"("parentId");
CREATE INDEX "Goal_status_idx" ON "Goal"("status");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "category" TEXT,
    "priority" INTEGER,
    "energy" TEXT,
    "estimateMin" INTEGER,
    "deadline" DATETIME,
    "softDeadline" DATETIME,
    "notes" TEXT,
    "goalId" TEXT,
    "parentTaskId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "notionId" TEXT,
    "notionSyncedAt" DATETIME,
    "notionDirty" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "Task_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("category", "completedAt", "createdAt", "deadline", "energy", "estimateMin", "goalId", "id", "notes", "notionDirty", "notionId", "notionSyncedAt", "priority", "softDeadline", "startedAt", "status", "title") SELECT "category", "completedAt", "createdAt", "deadline", "energy", "estimateMin", "goalId", "id", "notes", "notionDirty", "notionId", "notionSyncedAt", "priority", "softDeadline", "startedAt", "status", "title" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_notionId_key" ON "Task"("notionId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_deadline_idx" ON "Task"("deadline");
CREATE INDEX "Task_notionDirty_idx" ON "Task"("notionDirty");
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TaskDependency_dependentId_idx" ON "TaskDependency"("dependentId");

-- CreateIndex
CREATE INDEX "TaskDependency_prerequisiteId_idx" ON "TaskDependency"("prerequisiteId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_dependentId_prerequisiteId_key" ON "TaskDependency"("dependentId", "prerequisiteId");

-- CreateTable
CREATE TABLE "DailyPlanItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT,
    "goalId" TEXT,
    "projectId" TEXT,
    "areaId" TEXT,
    CONSTRAINT "DailyPlanItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyPlanItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyPlanItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyPlanItem_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DailyPlanItem_date_idx" ON "DailyPlanItem"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlanItem_date_taskId_key" ON "DailyPlanItem"("date", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlanItem_date_goalId_key" ON "DailyPlanItem"("date", "goalId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlanItem_date_projectId_key" ON "DailyPlanItem"("date", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlanItem_date_areaId_key" ON "DailyPlanItem"("date", "areaId");

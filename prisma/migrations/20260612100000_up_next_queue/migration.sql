-- Up-next queue: a short ordered list of Task / Goal items the user wants to do next.
-- taskId and goalId are each UNIQUE so the same entity cannot appear twice.
-- Positions are 0-based, ascending.
CREATE TABLE "UpNextItem" (
    "id"        TEXT    NOT NULL PRIMARY KEY,
    "kind"      TEXT    NOT NULL,
    "taskId"    TEXT,
    "goalId"    TEXT,
    "position"  INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpNextItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UpNextItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UpNextItem_taskId_key" ON "UpNextItem"("taskId");
CREATE UNIQUE INDEX "UpNextItem_goalId_key" ON "UpNextItem"("goalId");
CREATE INDEX "UpNextItem_position_idx" ON "UpNextItem"("position");

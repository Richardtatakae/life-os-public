-- CreateTable
CREATE TABLE "FocusTimer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "workMin" INTEGER NOT NULL DEFAULT 25,
    "breakMin" INTEGER NOT NULL DEFAULT 5,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "FocusTimer_archivedAt_idx" ON "FocusTimer"("archivedAt");

-- CreateTable
CREATE TABLE "RoutineSubItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoutineSubItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RoutineItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RoutineSubItem_itemId_idx" ON "RoutineSubItem"("itemId");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiaryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'journal',
    "mood" INTEGER,
    "energy" INTEGER,
    "focus" INTEGER,
    "stress" INTEGER,
    "sleepQuality" INTEGER,
    "motivation" INTEGER,
    "hope" INTEGER,
    "physicalHealth" INTEGER,
    "productivity" INTEGER,
    "sleepHours" REAL,
    "archivedAt" DATETIME
);
INSERT INTO "new_DiaryEntry" ("archivedAt", "createdAt", "energy", "focus", "hope", "id", "mood", "motivation", "physicalHealth", "productivity", "sleepHours", "sleepQuality", "stress", "text") SELECT "archivedAt", "createdAt", "energy", "focus", "hope", "id", "mood", "motivation", "physicalHealth", "productivity", "sleepHours", "sleepQuality", "stress", "text" FROM "DiaryEntry";
DROP TABLE "DiaryEntry";
ALTER TABLE "new_DiaryEntry" RENAME TO "DiaryEntry";
CREATE INDEX "DiaryEntry_archivedAt_idx" ON "DiaryEntry"("archivedAt");
CREATE INDEX "DiaryEntry_createdAt_idx" ON "DiaryEntry"("createdAt");
CREATE INDEX "DiaryEntry_kind_idx" ON "DiaryEntry"("kind");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

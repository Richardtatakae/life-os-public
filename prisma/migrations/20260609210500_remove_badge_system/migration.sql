-- Remove the old badge/milestone gamification system (replaced by habit consistency levels).
-- DropTable
PRAGMA foreign_keys=OFF;
DROP TABLE "BadgeAward";
DROP TABLE "Badge";
PRAGMA foreign_keys=ON;

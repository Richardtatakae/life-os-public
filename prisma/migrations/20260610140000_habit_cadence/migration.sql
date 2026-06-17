-- Interval habits: how often a habit is due. 1 = daily (existing behaviour);
-- >1 = due once per calendar-aligned period of N days (3 = every 3 days,
-- 7 = weekly, 14 = fortnightly). Existing rows default to 1 (daily), so the
-- whole tracker is unchanged for them.
ALTER TABLE "LifeHabit" ADD COLUMN "cadenceDays" INTEGER NOT NULL DEFAULT 1;

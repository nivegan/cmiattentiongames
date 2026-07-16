// utils/weekRange.ts
// Single source of truth for weekly-review week boundaries.
//
// A "week" is the IST (Asia/Kolkata) Sunday → Saturday span, matching the
// platform's IST day boundary (see getCurrentDayRange.ts / toISTDateKey.ts).
// getCompletedWeekRange returns the MOST RECENTLY COMPLETED week — on a Sunday
// that's the week that ended yesterday (Saturday); on any other day it's the
// same week (the current, in-progress week is never returned).
//
// weekStartDate is a UTC-midnight Date because weekly_summaries.week_start_date
// is a @db.Date column — Prisma stores the UTC calendar date of the Date it is
// given, so a local-midnight Date on a non-UTC host would store the wrong day
// (same pattern as kalari_games.scheduled_for).

import { toISTDateKey } from "@/utils/toISTDateKey";

interface WeekRange {
  weekStartKey: string; // IST "YYYY-MM-DD" of the week's Sunday — the DB key
  weekEndKey: string; // IST "YYYY-MM-DD" of the week's Saturday
  weekStartDate: Date; // UTC-midnight Date for the @db.Date PK column
  windowStart: Date; // inclusive lower bound for user_stats.created_at queries
  windowEnd: Date; // inclusive upper bound (Saturday 23:59:59.999 IST)
}

const DAY_MS = 86_400_000;

// IST weekday index for a date (0 = Sunday … 6 = Saturday).
const istWeekdayIndex = (date: Date): number => {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
};

const getCompletedWeekRange = (now: Date = new Date()): WeekRange => {
  const todayKey = toISTDateKey(now);
  // Anchor at IST noon so stepping back whole days can never straddle a
  // midnight boundary and land on the wrong calendar date.
  const anchor = new Date(`${todayKey}T12:00:00+05:30`);

  const weekday = istWeekdayIndex(now);
  // Most recent Sunday whose week (through Saturday) has fully elapsed:
  // Sunday → 7 days back (last week's Sunday), Monday → 8, … Saturday → 13.
  const daysBack = weekday === 0 ? 7 : weekday + 7;

  const weekStartKey = toISTDateKey(
    new Date(anchor.getTime() - daysBack * DAY_MS),
  );
  const weekEndKey = toISTDateKey(
    new Date(anchor.getTime() - (daysBack - 6) * DAY_MS),
  );

  return {
    weekStartKey,
    weekEndKey,
    weekStartDate: new Date(`${weekStartKey}T00:00:00Z`),
    windowStart: new Date(`${weekStartKey}T00:00:00+05:30`),
    windowEnd: new Date(`${weekEndKey}T23:59:59.999+05:30`),
  };
};

export { getCompletedWeekRange };
export type { WeekRange };

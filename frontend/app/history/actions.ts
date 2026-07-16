"use server";
// history/actions.ts
// Server action that fetches a user's full game history and current streak.
// Called by history/page.tsx on mount. Returns all score rows for this user
// (newest first) plus the computed IST streak count.

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import { toISTDateKey } from "@/utils/toISTDateKey";
import scheduleData from "@/data/dailySchedule.json";
// Types live in ./types (not here) because a "use server" file must export only
// async server actions — see the note in types.ts.
import type {
  DayGame,
  DayGroup,
  HistoryResult,
  WeeklySummaryEntry,
} from "./types";
import type { WeeklySummaryPayload } from "@/utils/weeklySummaryTypes";

// Weekday → scheduled game slugs (same source the home grid reads). Only the
// *count* per weekday matters here — it's the denominator for a day's "X/N".
const schedule = scheduleData.schedule as Record<string, string[]>;

// Number of games scheduled for the weekday of an IST calendar date "YYYY-MM-DD".
// Anchor at noon IST and read the IST weekday so the lookup matches the home
// grid's lowercase keys (and dodges any day-boundary ambiguity).
// NOTE: dailySchedule.json is the *current* weekly schedule — there is no record
// of what was scheduled on a past date, so past days use today's weekday mapping.
// The per-weekday count is stable even as the specific games rotate.
const scheduledCountForDateKey = (dateKey: string): number => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  })
    .format(new Date(`${dateKey}T12:00:00+05:30`))
    .toLowerCase();
  return (schedule[weekday] ?? []).length;
};

// Counts consecutive IST calendar days the user played, walking backward from
// the most recent play. The streak stays alive if the user played either today
// or yesterday — so opening the app before playing today doesn't break it.
//
// Example: played Mon, Tue, Wed; today is Thu.
//   → startKey = "Wed" (yesterday), streak walks back: Wed ✓, Tue ✓, Mon ✓ → 3
const computeStreak = (dates: Date[]): number => {
  if (dates.length === 0) return 0;

  // Build a Set of unique IST date strings. A Set eliminates duplicates so
  // playing two games on the same day still counts as just one streak day.
  const playedDays = new Set(dates.map(toISTDateKey));
  const todayKey = toISTDateKey(new Date());
  // 86_400_000 ms = exactly 24 hours — a cheap way to get "yesterday" that works
  // because we're comparing IST date strings, not raw UTC timestamps.
  const yesterdayKey = toISTDateKey(new Date(Date.now() - 86_400_000));

  // Decide the starting point: today if the user already played today; otherwise yesterday.
  const startKey = playedDays.has(todayKey) ? todayKey : yesterdayKey;
  if (!playedDays.has(startKey)) return 0; // neither today nor yesterday — no active streak

  let streak = 0;
  // Use noon IST (T12:00:00+05:30) to avoid any DST or day-boundary ambiguity
  // when subtracting 24 h to step back one calendar day at a time.
  let cursor = new Date(`${startKey}T12:00:00+05:30`);
  while (playedDays.has(toISTDateKey(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - 86_400_000); // step back one day
  }

  return streak;
};

const fetchHistory = async (deviceId: string): Promise<HistoryResult> => {
  // auth() reads the Clerk session. userId is null for anonymous users.
  const { userId } = await auth();
  // Prefer the Clerk user ID (persistent across devices); fall back to anonymous device UUID.
  const identifier = userId || deviceId;

  // Return empty data rather than querying with a null/empty identifier.
  if (!identifier)
    return {
      days: [],
      streak: 0,
      gamesCompleted: 0,
      hasEntries: false,
    };

  // Convert the identifier to a DB-safe UUID (Clerk IDs are not valid UUIDs).
  const dbUuid = safeFormatToUuid(identifier);

  // Fetch all score rows for this user, ordered newest first.
  const rows = await prisma.user_stats.findMany({
    where: { user_id: dbUuid },
    orderBy: { created_at: "desc" },
  });

  // Bucket plays into IST calendar days. Map iteration order follows insertion
  // order, and rows arrive newest-first, so `days` ends up newest-day-first.
  // The daily play lock already prevents replaying a mode on the same day, but
  // we dedupe defensively so a stray duplicate can't inflate the count or pills.
  const dayMap = new Map<string, { games: DayGame[]; seen: Set<string> }>();
  for (const r of rows) {
    const key = toISTDateKey(r.created_at);
    const gameMode = r.game_type_id ?? null;
    const bucket = dayMap.get(key) ?? { games: [], seen: new Set<string>() };
    const modeKey = gameMode ?? "__null__"; // bucket null-typed rows together
    if (!bucket.seen.has(modeKey)) {
      bucket.seen.add(modeKey);
      bucket.games.push({ id: r.id, gameMode });
    }
    dayMap.set(key, bucket);
  }

  const days: DayGroup[] = Array.from(dayMap, ([dateKey, b]) => {
    const playedCount = b.games.length; // distinct games played that day
    const scheduled = scheduledCountForDateKey(dateKey);
    // max() guards the rare deep-link case of playing an unscheduled game, so
    // the fraction never exceeds 1 (no "3/2").
    return {
      dateKey,
      games: b.games,
      playedCount,
      dailyTotal: Math.max(scheduled, playedCount),
    };
  });

  return {
    days,
    streak: computeStreak(rows.map((r) => r.created_at)),
    gamesCompleted: rows.length,
    hasEntries: rows.length > 0,
  };
};

// Fetches all of this user's weekly review summaries, newest week first, for
// the History page's Weekly tab (US 4.3). All rows are returned — including a
// not-yet-dismissed current one — so there's never a gap in the feed.
const fetchWeeklySummaries = async (
  deviceId: string,
): Promise<WeeklySummaryEntry[]> => {
  const { userId } = await auth();
  const identifier = userId || deviceId;
  if (!identifier) return [];

  const dbUuid = safeFormatToUuid(identifier);
  const rows = await prisma.weekly_summaries.findMany({
    where: { user_id: dbUuid },
    orderBy: { week_start_date: "desc" },
  });

  return rows.map((r) => {
    // week_start_date is a @db.Date — Prisma reads it back as UTC midnight, so
    // slicing the ISO string recovers the stored calendar date exactly.
    const weekStartKey = r.week_start_date.toISOString().slice(0, 10);
    const weekEndKey = new Date(
      r.week_start_date.getTime() + 6 * 86_400_000, // Saturday = Sunday + 6 days
    )
      .toISOString()
      .slice(0, 10);
    return {
      weekStartKey,
      weekEndKey,
      dismissed: r.dismissed_at !== null,
      payload: r.payload as unknown as WeeklySummaryPayload,
    };
  });
};

export { fetchHistory, fetchWeeklySummaries };

"use server";
// history/actions.ts
// Server action that fetches a user's full game history and current streak.
// Called by history/page.tsx on mount. Returns all score rows for this user
// (newest first) plus the computed IST streak count.

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import type { GameMode } from "@/utils/generate_game";
// Types live in ./types (not here) because a "use server" file must export only
// async server actions — see the note in types.ts.
import type { DayGame, DayGroup, HistoryResult } from "./types";

// The games that count toward a "full day". The denominator in the per-day
// "X/N" completion count is derived from this list's length, so adding a new
// daily game here is the only change needed to update the count everywhere.
// READ_BETWEEN_DESIGNS is excluded because it isn't playable yet.
const DAILY_GAME_MODES: GameMode[] = [
  "GUT_CHECK",
  "EXTRACT_THE_FACTS",
  "STEADY_GAZE",
  "CLEAR_THE_AIR",
  "MENTAL_REFLEX",
];
const DAILY_TOTAL = DAILY_GAME_MODES.length;

// Converts a Date object to an IST calendar date string like "2026-06-05".
// Used to group play timestamps by IST day when computing the streak.
const toISTDateKey = (date: Date): string => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", // convert to IST before extracting the date
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
      dailyTotal: DAILY_TOTAL,
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

  const days: DayGroup[] = Array.from(dayMap, ([dateKey, b]) => ({
    dateKey,
    games: b.games,
    playedCount: Math.min(b.games.length, DAILY_TOTAL),
  }));

  return {
    days,
    streak: computeStreak(rows.map((r) => r.created_at)),
    dailyTotal: DAILY_TOTAL,
    gamesCompleted: rows.length,
    hasEntries: rows.length > 0,
  };
};

export { fetchHistory };

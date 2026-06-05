"use server";
// history/actions.ts
// Server action that fetches a user's full game history and current streak.
// Called by history/page.tsx on mount. Returns all score rows for this user
// (newest first) plus the computed IST streak count.

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import type { GameMode } from "@/utils/generate_game";

// Shape of a single score row returned from the DB.
// created_at is a string (ISO format) because plain Date objects can't be
// passed across the server/client boundary in Next.js server actions — they
// must be serialised to a primitive type first.
export interface HistoryEntry {
  id: string;
  game_type_id: GameMode | null; // null if the DB row has an unrecognised game type
  score: number;
  is_success: boolean;
  created_at: string;            // ISO 8601 string, e.g. "2026-06-05T12:00:00.000Z"
  difficulty_band: number;
}

// The full object returned by fetchHistory to the page component.
export interface HistoryResult {
  entries: HistoryEntry[];
  streak: number; // consecutive IST calendar days the user has played
}

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

export const fetchHistory = async (deviceId: string): Promise<HistoryResult> => {
  // auth() reads the Clerk session. userId is null for anonymous users.
  const { userId } = await auth();
  // Prefer the Clerk user ID (persistent across devices); fall back to anonymous device UUID.
  const identifier = userId || deviceId;

  // Return empty data rather than querying with a null/empty identifier.
  if (!identifier) return { entries: [], streak: 0 };

  // Convert the identifier to a DB-safe UUID (Clerk IDs are not valid UUIDs).
  const dbUuid = safeFormatToUuid(identifier);

  // Fetch all score rows for this user, ordered newest first.
  const rows = await prisma.user_stats.findMany({
    where: { user_id: dbUuid },
    orderBy: { created_at: "desc" },
  });

  return {
    entries: rows.map((r) => ({
      id: r.id,
      game_type_id: r.game_type_id ?? null,      // ?? null: coerce undefined to null for the type
      score: r.score,
      is_success: r.is_success,
      created_at: r.created_at.toISOString(),     // Date → string for serialisation across the boundary
      difficulty_band: r.difficulty_band,
    })),
    streak: computeStreak(rows.map((r) => r.created_at)),
  };
};

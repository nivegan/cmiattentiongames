"use server";

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import type { GameMode } from "@/utils/generate_game";

export interface HistoryEntry {
  id: string;
  game_type_id: GameMode | null;
  score: number;
  is_success: boolean;
  created_at: string;
  difficulty_band: number;
}

export interface HistoryResult {
  entries: HistoryEntry[];
  streak: number;
}

function toISTDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Counts consecutive IST calendar days the user played, walking backward from
// the most recent play. The streak stays alive if the user played either today
// or yesterday (so opening the app before playing today doesn't break it).
function computeStreak(dates: Date[]): number {
  if (dates.length === 0) return 0;

  const playedDays = new Set(dates.map(toISTDateKey));
  const todayKey = toISTDateKey(new Date());
  // 86_400_000 ms = exactly 24 hours; cheap approximation for "yesterday" that
  // works here because we're comparing IST date strings, not UTC timestamps.
  const yesterdayKey = toISTDateKey(new Date(Date.now() - 86_400_000));

  const startKey = playedDays.has(todayKey) ? todayKey : yesterdayKey;
  if (!playedDays.has(startKey)) return 0;

  let streak = 0;
  // Noon IST avoids any ambiguity around DST or day-boundary edge cases when
  // subtracting 24 h to step back one day.
  let cursor = new Date(`${startKey}T12:00:00+05:30`);
  while (playedDays.has(toISTDateKey(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }

  return streak;
}

export async function fetchHistory(deviceId: string): Promise<HistoryResult> {
  const { userId } = await auth();
  const identifier = userId || deviceId;

  if (!identifier) return { entries: [], streak: 0 };

  const dbUuid = safeFormatToUuid(identifier);

  const rows = await prisma.user_stats.findMany({
    where: { user_id: dbUuid },
    orderBy: { created_at: "desc" },
  });

  return {
    entries: rows.map((r) => ({
      id: r.id,
      game_type_id: r.game_type_id ?? null,
      score: r.score,
      is_success: r.is_success,
      created_at: r.created_at.toISOString(),
      difficulty_band: r.difficulty_band,
    })),
    streak: computeStreak(rows.map((r) => r.created_at)),
  };
}

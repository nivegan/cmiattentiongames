// admin/types.ts
// Shared response types for the admin analytics endpoint. They live here (not
// in app/api/admin/route.ts) so the client dashboard can `import type` them
// without touching the route module — same pattern as app/history/types.ts.

import type { GameType } from "@/lib/generated/prisma/enums";

type GameDayMetrics = {
  game: GameType;
  played: number; // sessions finished (paired start→complete)
  starts: number; // sessions opened (GAME_START events, dupes collapsed)
  completed: number; // GAME_COMPLETE events (dupes collapsed)
  abandoned: number; // starts that never reached a completion
  dropOffRate: number | null; // abandoned / starts; null if no starts
  avgTimeSpentSec: number | null; // mean paired duration; null if none
  avgScore: number | null; // mean user_stats.score that day; null if none
};

type RankingRow = {
  game: GameType;
  plays: number; // all-time finished sessions ("Most Played")
  starts: number;
  abandoned: number;
  dropOffRate: number | null;
  avgCompletionTimeSec: number | null;
  avgScore: number | null;
};

type DailyEntry = { date: string; games: GameDayMetrics[] };

type AdminAnalytics = {
  date: string; // today, IST
  dau: number; // distinct users with >=1 GAME_START today
  ranking: RankingRow[]; // all-time, stable row per GameType
  daily: DailyEntry[]; // newest first
};

export type { GameDayMetrics, RankingRow, DailyEntry, AdminAnalytics };

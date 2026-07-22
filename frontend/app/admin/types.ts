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

type DauPoint = {
  date: string; // IST "YYYY-MM-DD"
  dau: number; // distinct users with >=1 GAME_START that IST day
};

type WeeklyEntry = {
  weekStartKey: string; // IST Monday "YYYY-MM-DD"
  weekEndKey: string; // IST Sunday "YYYY-MM-DD"
  games: GameDayMetrics[]; // same shape as a daily table, week-scoped
};

type AdminAnalytics = {
  date: string; // today, IST
  dau: number; // distinct users with >=1 GAME_START today
  dauSeries: DauPoint[]; // ascending, zero-filled through today
  ranking: RankingRow[]; // all-time, stable row per GameType
  daily: DailyEntry[]; // newest first
  weekly: WeeklyEntry[]; // newest first; only weeks with data
};

export type {
  GameDayMetrics,
  RankingRow,
  DailyEntry,
  DauPoint,
  WeeklyEntry,
  AdminAnalytics,
};

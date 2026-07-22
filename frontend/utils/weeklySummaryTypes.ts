// utils/weeklySummaryTypes.ts
// Shared types for the weekly review feature (US 4.3).
//
// These live in a plain module — NOT in a "use server" file — because a
// "use server" file may export only async functions (exporting a locally
// declared type breaks under Turbopack; see CLAUDE.md).

import type { GameMode } from "@/utils/gameMode";

// The JSON stored in weekly_summaries.payload, one row per user per week.
// A `type` alias (not `interface`) on purpose: type aliases get an implicit
// index signature, which Prisma's Json input type requires; an interface here
// would fail to type-check at the upsert call sites.
type WeeklySummaryPayload = {
  // Pre-formatted per-game ratio list, e.g.
  // "Gut Check : 2/3, Mental Reflex : 1/3, …" — split on ", " to render rows.
  total_games_played: string;
  best_game: {
    game_type_id: GameMode | null; // null = no games played that week
    highest_score: number; // that game's average score, rounded
  };
  average_completion_time: string; // e.g. "4.2s" (from completion_time_sec); "0.0s" for weeks with no tracked times
  summary_copy: string; // witty one-liner chosen by the copy-band matrix
};

// What fetchWeeklyReview returns to the home page.
interface WeeklyReviewResult {
  show: boolean;
  weekStartKey?: string; // IST "YYYY-MM-DD" Sunday
  weekEndKey?: string; // IST "YYYY-MM-DD" Saturday
  payload?: WeeklySummaryPayload;
}

export type { WeeklySummaryPayload, WeeklyReviewResult };

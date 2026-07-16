// history/types.ts
// Shared types for the history feature. These live here rather than in
// actions.ts because a "use server" file must export ONLY async server actions
// — exporting a locally-declared type from it trips Turbopack's server-action
// transform, which references the (erased) type name at runtime and throws
// "X is not defined". Imported types, by contrast, erase cleanly in annotations.

import type { GameMode } from "@/utils/gameMode";
import type { WeeklySummaryPayload } from "@/utils/weeklySummaryTypes";

// A single game played on a given day — just enough to render its pill.
interface DayGame {
  id: string;
  gameMode: GameMode | null; // null if the DB row has an unrecognised game type
}

// All plays bucketed into one IST calendar day.
interface DayGroup {
  dateKey: string; // IST "YYYY-MM-DD" — also used as the React key
  games: DayGame[]; // distinct games played that day (one play per mode per day)
  playedCount: number; // distinct games played that day
  dailyTotal: number; // games scheduled that weekday — the "X/N" denominator
}

// The full object returned by fetchHistory to the page component.
interface HistoryResult {
  days: DayGroup[]; // newest day first
  streak: number; // consecutive IST calendar days the user has played
  gamesCompleted: number; // total plays — "Your Progress" footer stat
  hasEntries: boolean; // false when the user has no plays yet (empty state)
}

// One weekly review card in the History page's Weekly tab (US 4.3). Mirrors a
// weekly_summaries row; the payload is the same JSON the review modal renders.
interface WeeklySummaryEntry {
  weekStartKey: string; // IST "YYYY-MM-DD" Sunday — also the React key
  weekEndKey: string; // IST "YYYY-MM-DD" Saturday
  dismissed: boolean; // whether the celebratory modal was dismissed
  payload: WeeklySummaryPayload;
}

export type { DayGame, DayGroup, HistoryResult, WeeklySummaryEntry };

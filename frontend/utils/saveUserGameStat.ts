"use server";
// saveUserGameStat.ts
// The single shared server action that all game pages call to save a score.
//
// "use server" means these functions run on the server only, never in the browser.
// The browser invokes them as normal async functions; Next.js silently turns each
// call into an HTTP POST to a server endpoint.
//
// WHY SHARED INSTEAD OF ONE PER GAME?
// Every game needs the exact same save flow:
//   1. Identify the user (Clerk or anonymous device ID)
//   2. Check the daily lock again (second checkpoint)
//   3. Convert the identifier to a DB-safe UUID
//   4. Write a row to user_stats
// Keeping it in one place means a bug fix here fixes all games at once.

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";
import { capturePosthog } from "@/utils/posthogServer";
import type { GameMode } from "@/utils/gameMode";
import type { Prisma } from "@/lib/generated/prisma/client";

// NOT exported — a "use server" file may only export async functions.
interface SaveGameStatInput {
  score: number; // the final computed score (0–100)
  deviceId: string; // anonymous localStorage UUID; "" if the user is signed in
  mode: GameMode; // which game, e.g. "GUT_CHECK"
  source: string; // tracking tag, e.g. "web_gut_check_v1"
  completionTimeSec: number; // whole seconds from the start-button tap to game end
  details: Record<string, unknown>; // per-game results-screen stats, dumped into metadata
}

const saveUserGameStat = async (
  input: SaveGameStatInput,
): Promise<{ success: boolean; error?: "ALREADY_PLAYED" | string }> => {
  const { score, deviceId, mode, source, completionTimeSec, details } = input;
  try {
    // auth() reads the Clerk session from the request headers.
    // userId is null for anonymous (not-signed-in) users.
    const { userId } = await auth();
    // Prefer the Clerk ID (persistent across devices and browsers); fall back to
    // the anonymous device UUID from localStorage.
    const targetIdentifier = userId || deviceId;

    if (!targetIdentifier) return { success: false, error: "UNKNOWN" };

    // SECOND daily-lock checkpoint (the first was in each game's fetchServerGameData
    // or checkAlreadyPlayed). We re-check here because the user could have opened
    // the game in two browser tabs simultaneously and submitted both before either
    // tab's lock check could block the other.
    const played = await checkHasPlayedToday(targetIdentifier, mode);
    if (played) {
      return { success: false, error: "ALREADY_PLAYED" };
    }

    // Generate a fresh UUID to use as the primary key for this score row.
    // globalThis.crypto is available in both Node 19+ and modern browsers.
    const rowId = globalThis.crypto.randomUUID();
    // Convert the identifier (Clerk ID or device UUID) to a valid Postgres UUID.
    const dbSafeUuid = safeFormatToUuid(targetIdentifier);

    await prisma.user_stats.create({
      data: {
        id: rowId,
        user_id: dbSafeUuid,
        game_type_id: mode,
        difficulty_band: 1.0, // reserved for future adaptive difficulty; fixed at 1 now
        score,
        is_success: true, // all submitted games count as "success" for now
        completion_time_sec: Math.max(0, Math.round(completionTimeSec)),
        // Which game version submitted this row + the full results-screen stats.
        // details crossed the server-action boundary, so it is already JSON-safe.
        metadata: { source, ...details } as Prisma.InputJsonObject,
      },
    });

    // Mirror score to PostHog so we can build score-distribution and per-game
    // leaderboard queries. Fire-and-forget — capturePosthog swallows its errors.
    void capturePosthog(targetIdentifier, "score_saved", {
      mode,
      score,
      source,
      completion_time_sec: Math.max(0, Math.round(completionTimeSec)),
    });

    return { success: true };
  } catch (error) {
    console.error(`Database error saving stats for ${mode}:`, error);
    // instanceof Error checks that `error` is a proper Error object before
    // accessing .message. If it's some other thrown value, use a fallback string.
    const errorMessage =
      error instanceof Error ? error.message : "Unknown write failure";
    return { success: false, error: errorMessage };
  }
};

export { saveUserGameStat };

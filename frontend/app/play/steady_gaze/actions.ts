"use server";
// steady_gaze/actions.ts
// Minimal server action for the Steady Gaze game page.
//
// Steady Gaze generates all of its game data client-side (colors, dot positions)
// using the seeded RNG in utils/seedRng.ts — there is nothing to fetch from the
// server. This file's only job is to check whether the user already played today
// (the "daily lock") so the page can redirect them home if so.
//
// Unlike the AI-based games, there is no generate() call here — just a direct
// DB check via checkHasPlayedToday.

import { auth } from "@clerk/nextjs/server";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";
import { recordNonLlmDaily } from "@/utils/nonLlmDailyContent";
import { getTodayIST } from "@/utils/seedRng";

const checkAlreadyPlayed = async (
  deviceId: string, // anonymous localStorage UUID
): Promise<{ alreadyPlayed: boolean }> => {
  try {
    // Record today's seed-derived params into kalari_games (idempotent,
    // swallows its own errors). Runs before the lock check so the day gets
    // recorded even for already-played visitors.
    await recordNonLlmDaily("steady_gaze", getTodayIST());
    const { userId } = await auth();
    // Prefer the Clerk user ID (signed-in); fall back to anonymous device UUID.
    const targetIdentifier = userId || deviceId;
    // If we have no identifier at all (localStorage cleared + auth failed),
    // allow play rather than permanently blocking the user.
    if (!targetIdentifier) return { alreadyPlayed: false };
    const played = await checkHasPlayedToday(targetIdentifier, "STEADY_GAZE");
    return { alreadyPlayed: played };
  } catch {
    // On any error (DB outage, cold start timeout), fail open — don't
    // let a server error permanently prevent a user from playing.
    return { alreadyPlayed: false };
  }
};

export { checkAlreadyPlayed };

"use server";
// mental_reflex/actions.ts
// Minimal server action for the Mental Reflex game page.
//
// Mental Reflex generates ALL of its game data client-side (per-round targets,
// the full falling-object schedule, timing) from a single daily seed in
// utils/seedRng.ts — there is nothing to fetch from the server. This file's only
// job is the daily-lock check so the page can redirect an already-played user home.
//
// Mirrors steady_gaze/actions.ts — there is no generate() call here, just a
// direct DB check via checkHasPlayedToday.

import { auth } from "@clerk/nextjs/server";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";
import { recordNonLlmDaily } from "@/utils/nonLlmDailyContent";
import { getTodayIST } from "@/utils/seedRng";

const checkAlreadyPlayed = async (
  deviceId: string, // anonymous localStorage UUID
): Promise<{ alreadyPlayed: boolean }> => {
  try {
    // Record today's seed-derived round targets into kalari_games
    // (idempotent, swallows its own errors). Runs before the lock check so
    // the day gets recorded even for already-played visitors.
    await recordNonLlmDaily("mental_reflex", getTodayIST());
    const { userId } = await auth();
    // Prefer the Clerk user ID (signed-in); fall back to anonymous device UUID.
    const targetIdentifier = userId || deviceId;
    // If we have no identifier at all (localStorage cleared + auth failed),
    // allow play rather than permanently blocking the user.
    if (!targetIdentifier) return { alreadyPlayed: false };
    const played = await checkHasPlayedToday(targetIdentifier, "MENTAL_REFLEX");
    return { alreadyPlayed: played };
  } catch {
    // On any error (DB outage, cold start timeout), fail open — don't
    // let a server error permanently prevent a user from playing.
    return { alreadyPlayed: false };
  }
};

export { checkAlreadyPlayed };

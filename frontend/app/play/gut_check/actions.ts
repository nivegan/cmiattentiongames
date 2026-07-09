"use server";
// gut_check/actions.ts
// Server action for the Gut Check game page.
//
// "use server" means this code only runs on the server, never in the browser.
// When the browser calls fetchServerGameData(), Next.js silently turns the
// invocation into an encrypted HTTP POST to a server endpoint.
//
// THIS FILE HAS ONE JOB:
// Check whether the user already played Gut Check today. If not, call
// generate() from utils/generate_gut_check.ts to get (or return cached)
// AI-generated questions.
//
// FIRST OF TWO DAILY-LOCK CHECKPOINTS:
//   1. HERE: prevents serving game content to a user who already played today.
//      If they try to load the game again, we return ALREADY_PLAYED and the page
//      redirects them home — they never see the questions.
//   2. saveUserGameStat (utils/saveUserGameStat.ts): prevents a double-write even
//      if the user somehow bypassed checkpoint 1 (e.g., two tabs open at once).

import { generate } from "@/utils/generate_gut_check";
import type { GutCheckData } from "@/utils/generate_gut_check";
import { auth } from "@clerk/nextjs/server";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";

const fetchServerGameData = async (
  deviceId: string, // anonymous localStorage UUID; ignored when the user is signed in
): Promise<{
  success: boolean;
  data: GutCheckData | null;
  error?: "ALREADY_PLAYED" | "UNKNOWN";
}> => {
  try {
    // auth() reads the Clerk session. userId is null for anonymous users.
    const { userId } = await auth();
    // Use the Clerk user ID if signed in (persistent across devices);
    // fall back to the anonymous device UUID from localStorage.
    const targetIdentifier = userId || deviceId;

    if (targetIdentifier) {
      const played = await checkHasPlayedToday(targetIdentifier, "GUT_CHECK");
      if (played) {
        // User already played today — tell the page to redirect home
        return { success: false, data: null, error: "ALREADY_PLAYED" };
      }
    }

    // generate() checks the kalari_games DB cache first. If a valid row exists
    // for today's date, it returns that cached content immediately.
    // Only calls the Gemini API when no valid cached row is found.
    const result = await generate();
    return { success: true, data: result };
  } catch (error) {
    console.error("Error generating gut check game metadata payload:", error);
    return { success: false, data: null, error: "UNKNOWN" };
  }
};

export { fetchServerGameData };

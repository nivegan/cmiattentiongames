"use server";
// read_designs/actions.ts
// Server action for the Read Between Designs game page. Same structure as
// extract_facts/actions.ts — see that file for a detailed explanation.
//
// This one checks the "READ_BETWEEN_DESIGNS" daily lock and fetches the
// AI-generated dark-design content via generate() from the standalone
// utils/generate_dark_design.ts module.

import { generate } from "@/utils/generate_dark_design";
import type { DarkDesignData } from "@/utils/generate_dark_design";
import { auth } from "@clerk/nextjs/server";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";

// First of two daily-lock checkpoints — prevents serving game content to a user
// who already completed this mode today. Mirrors extract_facts/actions.ts.
//
// Note: the content cache keys on kalari_games.mode = "dark_design" (inside the
// standalone generator), which is independent of the daily LOCK that keys on
// user_stats.game_type_id = READ_BETWEEN_DESIGNS — so the lock is correct here.
const fetchServerGameData = async (
  deviceId: string,
): Promise<{
  success: boolean;
  data: DarkDesignData | null;
  error?: "ALREADY_PLAYED" | "UNKNOWN";
}> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;

    if (targetIdentifier) {
      const played = await checkHasPlayedToday(
        targetIdentifier,
        "READ_BETWEEN_DESIGNS",
      );
      if (played) {
        return { success: false, data: null, error: "ALREADY_PLAYED" };
      }
    }

    const result = await generate();
    return { success: true, data: result };
  } catch (error) {
    console.error("Error generating read designs game data payload:", error);
    return { success: false, data: null, error: "UNKNOWN" };
  }
};

export { fetchServerGameData };

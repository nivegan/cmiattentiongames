"use server";

import { GutCheckGame, generate } from "@/utils/generate_game";
import { auth } from "@clerk/nextjs/server";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";
// First of two daily-lock checkpoints. Prevents loading game content at all if
// the user already played today, so the client never receives questions it
// can't submit. The second checkpoint is in saveUserGameStats.
const fetchServerGameData = async (
  deviceId: string,
): Promise<{
  success: boolean;
  data: GutCheckGame | null;
  error?: "ALREADY_PLAYED" | "UNKNOWN";
}> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;

    if (targetIdentifier) {
      const played = await checkHasPlayedToday(targetIdentifier, "GUT_CHECK");
      if (played) {
        return { success: false, data: null, error: "ALREADY_PLAYED" };
      }
    }

    const result = await generate("GUT_CHECK");
    return { success: true, data: result as GutCheckGame };
  } catch (error) {
    console.error("Error generating gut check game metadata payload:", error);
    return { success: false, data: null, error: "UNKNOWN" };
  }
};

export { fetchServerGameData };

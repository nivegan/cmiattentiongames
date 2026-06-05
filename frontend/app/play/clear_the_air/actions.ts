"use server";
// clear_the_air/actions.ts
// Same pattern as steady_gaze/actions.ts — see that file for a detailed explanation.
// Clear the Air is also fully client-side algorithmic (no Gemini, no server fetch),
// so this file only checks the "CLEAR_THE_AIR" daily lock.

import { auth } from "@clerk/nextjs/server";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";

const checkAlreadyPlayed = async (
  deviceId: string, // anonymous localStorage UUID
): Promise<{ alreadyPlayed: boolean }> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;
    if (!targetIdentifier) return { alreadyPlayed: false };
    const played = await checkHasPlayedToday(targetIdentifier, "CLEAR_THE_AIR");
    return { alreadyPlayed: played };
  } catch {
    // Fail open on any server error — don't block play due to a DB outage.
    return { alreadyPlayed: false };
  }
};

export { checkAlreadyPlayed };

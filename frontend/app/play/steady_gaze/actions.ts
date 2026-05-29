"use server";

import { auth } from "@clerk/nextjs/server";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";

// Steady Gaze has no server-generated content, so there is no fetchServerGameData
// action. This function fills that role solely for the daily-lock gate — it returns
// early instead of redirecting so the client can decide what to render.
const checkAlreadyPlayed = async (
  deviceId: string,
): Promise<{ alreadyPlayed: boolean }> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;
    if (!targetIdentifier) return { alreadyPlayed: false };
    const played = await checkHasPlayedToday(targetIdentifier, "STEADY_GAZE");
    return { alreadyPlayed: played };
  } catch {
    return { alreadyPlayed: false };
  }
};

export { checkAlreadyPlayed };

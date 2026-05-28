"use server";

import { GutCheckGame, generate } from "@/utils/generate_game";
import { auth } from "@clerk/nextjs/server";
import dotenv from "dotenv";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";
dotenv.config();

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
    // Prefer the authenticated Clerk user ID; fall back to the anonymous
    // localStorage UUID so guests are also subject to the daily lock.
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

// Second daily-lock checkpoint. Re-checks even though fetchServerGameData already
// checked, because a user could open two tabs or the session could have changed
// between loading and submitting.
const saveUserGameStats = async (
  score: number,
  deviceId: string,
): Promise<{ success: boolean; error?: "ALREADY_PLAYED" | string }> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;

    if (targetIdentifier) {
      const played = await checkHasPlayedToday(targetIdentifier, "GUT_CHECK");
      if (played) {
        return { success: false, error: "ALREADY_PLAYED" };
      }
    }

    const rowId = globalThis.crypto.randomUUID();
    // Convert Clerk ID / device UUID to a DB-safe UUID format.
    const dbSafeUuid = safeFormatToUuid(targetIdentifier);

    await prisma.user_stats.create({
      data: {
        id: rowId,
        user_id: dbSafeUuid,
        game_type_id: "GUT_CHECK",
        difficulty_band: 1.0,
        score: score,
        is_success: true,
        reaction_time_ms: null,
        metadata: { source: "web_gut_check_v1" },
      },
    });

    return { success: true };
  } catch (error) {
    console.error(
      "Database Transaction Error in saveUserGameStats Gut Check Action:",
      error,
    );
    const errorMessage =
      error instanceof Error ? error.message : "Unknown write failure";
    return { success: false, error: errorMessage };
  } finally {
    await prisma.$disconnect();
  }
};

export { fetchServerGameData, saveUserGameStats };

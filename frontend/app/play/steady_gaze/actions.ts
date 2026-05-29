"use server";

import { auth } from "@clerk/nextjs/server";
import dotenv from "dotenv";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";
dotenv.config();

const checkAlreadyPlayed = async (
  deviceId: string,
): Promise<{ alreadyPlayed: boolean }> => {
  const { userId } = await auth();
  const targetIdentifier = userId || deviceId;
  if (!targetIdentifier) return { alreadyPlayed: false };
  const played = await checkHasPlayedToday(targetIdentifier, "STEADY_GAZE");
  return { alreadyPlayed: played };
};

const saveUserGameStats = async (
  score: number,
  deviceId: string,
): Promise<{ success: boolean; error?: "ALREADY_PLAYED" | string }> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;

    if (targetIdentifier) {
      const played = await checkHasPlayedToday(targetIdentifier, "STEADY_GAZE");
      if (played) {
        return { success: false, error: "ALREADY_PLAYED" };
      }
    }

    const rowId = globalThis.crypto.randomUUID();
    const dbSafeUuid = safeFormatToUuid(targetIdentifier);

    await prisma.user_stats.create({
      data: {
        id: rowId,
        user_id: dbSafeUuid,
        game_type_id: "STEADY_GAZE",
        difficulty_band: 1.0,
        score: score,
        is_success: true,
        reaction_time_ms: null,
        metadata: { source: "web_steady_gaze_v1" },
      },
    });

    return { success: true };
  } catch (error) {
    console.error(
      "Database Transaction Error in saveUserGameStats SteadyGaze:",
      error,
    );
    const errorMessage =
      error instanceof Error ? error.message : "Unknown write failure";
    return { success: false, error: errorMessage };
  } finally {
    await prisma.$disconnect();
  }
};

export { checkAlreadyPlayed, saveUserGameStats };

"use server";

import { ExtractFactsGame, generate } from "@/utils/generate_game";
import { auth } from "@clerk/nextjs/server";
import dotenv from "dotenv";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { getCurrentDayRange } from "@/utils/getCurrentDayRange";
import { prisma } from "@/utils/prismaInit";
dotenv.config();

const checkHasPlayedToday = async (targetId: string): Promise<boolean> => {
  const { start, end } = getCurrentDayRange();
  const dbSafeUuid = safeFormatToUuid(targetId);
  const existingRecord = await prisma.user_stats.findFirst({
    where: {
      user_id: dbSafeUuid,
      game_type_id: "EXTRACT_THE_FACTS",
      created_at: {
        gte: start,
        lte: end,
      },
    },
  });

  return !!existingRecord;
};

const fetchServerGameData = async (
  deviceId: string,
): Promise<{
  success: boolean;
  data: ExtractFactsGame | null;
  error?: "ALREADY_PLAYED" | "UNKNOWN";
}> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;

    if (targetIdentifier) {
      const played = await checkHasPlayedToday(targetIdentifier);
      if (played) {
        return { success: false, data: null, error: "ALREADY_PLAYED" };
      }
    }

    const result = await generate("extract_facts");
    return { success: true, data: result as ExtractFactsGame };
  } catch (error) {
    console.error("Error generating extract facts game data payload:", error);
    return { success: false, data: null, error: "UNKNOWN" };
  }
};

const saveUserGameStats = async (
  score: number,
  deviceId: string,
): Promise<{ success: boolean; error?: "ALREADY_PLAYED" | string }> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;

    if (targetIdentifier) {
      const played = await checkHasPlayedToday(targetIdentifier);
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
        game_type_id: "EXTRACT_THE_FACTS",
        difficulty_band: 1.0,
        score: score,
        is_success: true,
        reaction_time_ms: null,
        metadata: { source: "web_extract_facts_v1" },
      },
    });

    return { success: true };
  } catch (error) {
    console.error(
      "Database Transaction Error in saveUserGameStats Extract Facts Action:",
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

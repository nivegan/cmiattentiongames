"use server";

import { GutCheckGame, generate } from "@/utils/generate_game";
import { auth } from "@clerk/nextjs/server";
import dotenv from "dotenv";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { getCurrentDayRange } from "@/utils/getCurrentDayRange";
import { prisma } from "@/utils/prismaInit";
dotenv.config();

const checkHasPlayedToday = async (targetId: string): Promise<boolean> => {
  const { start, end } = getCurrentDayRange();
  const dbSafeUuid = safeFormatToUuid(targetId);
  console.log(start);
  console.log(end);
  const existingRecord = await prisma.user_stats.findFirst({
    where: {
      user_id: dbSafeUuid,
      game_type_id: "GUT_CHECK",
      created_at: {
        gte: start,
        lte: end,
      },
    },
  });
  console.log(existingRecord);
  return !!existingRecord;
};

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
      const played = await checkHasPlayedToday(targetIdentifier);
      if (played) {
        return { success: false, data: null, error: "ALREADY_PLAYED" };
      }
    }

    const result = await generate("gut_check");
    return { success: true, data: result as GutCheckGame };
  } catch (error) {
    console.error("Error generating gut check game metadata payload:", error);
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

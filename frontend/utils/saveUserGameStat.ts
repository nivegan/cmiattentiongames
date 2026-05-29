"use server";

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";
import type { GameMode } from "@/utils/generate_game";

export const saveUserGameStat = async (
  score: number,
  deviceId: string,
  mode: GameMode,
  source: string,
): Promise<{ success: boolean; error?: "ALREADY_PLAYED" | string }> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;

    if (!targetIdentifier) return { success: false, error: "UNKNOWN" };

    const played = await checkHasPlayedToday(targetIdentifier, mode);
    if (played) {
      return { success: false, error: "ALREADY_PLAYED" };
    }

    const rowId = globalThis.crypto.randomUUID();
    const dbSafeUuid = safeFormatToUuid(targetIdentifier);

    await prisma.user_stats.create({
      data: {
        id: rowId,
        user_id: dbSafeUuid,
        game_type_id: mode,
        difficulty_band: 1.0,
        score,
        is_success: true,
        reaction_time_ms: null,
        metadata: { source },
      },
    });

    return { success: true };
  } catch (error) {
    console.error(`Database error saving stats for ${mode}:`, error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown write failure";
    return { success: false, error: errorMessage };
  }
};

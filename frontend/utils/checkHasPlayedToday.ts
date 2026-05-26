import { getCurrentDayRange } from "./getCurrentDayRange";
import { prisma } from "./prismaInit";
import { safeFormatToUuid } from "./safeFormatToUuid";
import type { GameMode } from "./generate_game";

const checkHasPlayedToday = async (
  targetId: string,
  game: GameMode,
): Promise<boolean> => {
  const { start, end } = getCurrentDayRange();
  const dbSafeUuid = safeFormatToUuid(targetId);
  const existingRecord = await prisma.user_stats.findFirst({
    where: {
      user_id: dbSafeUuid,
      game_type_id: game,
      created_at: {
        gte: start,
        lte: end,
      },
    },
  });
  return !!existingRecord;
};

export { checkHasPlayedToday };

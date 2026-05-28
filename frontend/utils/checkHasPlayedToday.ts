import { getCurrentDayRange } from "./getCurrentDayRange";
import { prisma } from "./prismaInit";
import { safeFormatToUuid } from "./safeFormatToUuid";
import type { GameMode } from "./generate_game";

// Called in both server actions for each game (fetch and save) to enforce the
// once-per-day lock. The double-check in both actions is intentional: the fetch
// prevents loading game content after the lock activates, while the save guard
// prevents double-writes if the client somehow submits a second score.
const checkHasPlayedToday = async (
  targetId: string,
  game: GameMode,
): Promise<boolean> => {
  const { start, end } = getCurrentDayRange();
  // targetId may be a Clerk ID or a localStorage UUID; safeFormatToUuid
  // normalises both to a UUID before the DB lookup.
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

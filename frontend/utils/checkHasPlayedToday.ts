// checkHasPlayedToday.ts
// Utility that answers one question: "Has this user already played today?"
// It is called in two places for each game: once when loading game content
// (to block the page if they already played), and once when saving a score
// (to block a double-write). This double-check is intentional — it guards
// against race conditions where a user opens the game in two tabs at once.

import { getCurrentDayRange } from "./getCurrentDayRange";
import { prisma } from "./prismaInit";
import { safeFormatToUuid } from "./safeFormatToUuid";
import type { GameMode } from "./generate_game";

// Returns true if the user already has a score row for this game today.
const checkHasPlayedToday = async (
  targetId: string, // Clerk user ID ("user_2abc...") or anonymous localStorage UUID
  game: GameMode,   // which game to check, e.g. "GUT_CHECK"
): Promise<boolean> => {
  // Get the UTC timestamps that bracket today's IST calendar day.
  const { start, end } = getCurrentDayRange();

  // targetId may be a Clerk ID (not a valid UUID) or a localStorage UUID.
  // The user_id column in Postgres only accepts UUID format, so we normalise
  // both forms to a proper UUID before querying.
  const dbSafeUuid = safeFormatToUuid(targetId);

  const existingRecord = await prisma.user_stats.findFirst({
    where: {
      user_id: dbSafeUuid,  // match this specific user
      game_type_id: game,   // match this specific game mode
      created_at: {
        gte: start,         // created after today's IST midnight (00:00:00)
        lte: end,           // created before today's IST end-of-day (23:59:59)
      },
    },
  });

  // !! converts a truthy/falsy value to a strict boolean:
  //   !!null   = false  (no record found — hasn't played yet)
  //   !!object = true   (record found — already played today)
  return !!existingRecord;
};

export { checkHasPlayedToday };

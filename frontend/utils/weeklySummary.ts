// utils/weeklySummary.ts
// Weekly review generation (US 4.2/4.3): aggregates each user's user_stats rows
// for a completed IST week (Sunday → Saturday, see utils/weekRange.ts) into a
// JSON payload stored in weekly_summaries.
//
// Two entry points share the same pure aggregation:
//   - generateWeeklySummaries        — batch, all users (Sunday cron via
//                                      /api/generate-weekly)
//   - computeAndUpsertSummaryForUser — lazy per-user fallback so the review
//                                      modal never comes up empty if the cron
//                                      hasn't run yet
//
// Both upserts update `payload` only — dismissed_at is never touched, so a
// cron re-run can't resurrect an already-dismissed modal.

import { prisma } from "@/utils/prismaInit";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import dailySchedule from "@/data/dailySchedule.json";
import type { GameMode } from "@/utils/gameMode";
import type { WeekRange } from "@/utils/weekRange";
import { getCompletedWeekRange } from "@/utils/weekRange";
import type { WeeklySummaryPayload } from "@/utils/weeklySummaryTypes";

// The subset of a user_stats row the aggregation needs. game_type_id is the
// Prisma GameType enum, whose values are exactly the GameMode strings.
interface WeeklyStatRow {
  game_type_id: GameMode | null;
  score: number;
  reaction_time_ms: number | null;
}

interface WeeklyGameMeta {
  mode: GameMode;
  label: string;
  weeklyMax: number; // times this game appears in the weekly schedule
}

// Derive per-game weekly play caps from the daily schedule (the same source
// the home grid uses) instead of hardcoding them: a game's weekly max is the
// number of weekdays its slug is scheduled on.
const buildWeeklyGameMeta = (): WeeklyGameMeta[] => {
  const slugCounts: Record<string, number> = {};
  Object.values(dailySchedule.schedule).forEach((slugs) => {
    slugs.forEach((slug) => {
      slugCounts[slug] = (slugCounts[slug] ?? 0) + 1;
    });
  });

  return Object.values(GAME_CATALOG).map((info) => ({
    mode: info.mode,
    label: info.label,
    weeklyMax: slugCounts[info.slug] ?? 0,
  }));
};

// A play counts as a "win" for the copy bands when it scored 50+.
// (user_stats.is_success is currently hardwired to true on every save, so
// using it would make the success rate a constant 100% and leave half the
// copy bands unreachable.)
const isWin = (row: WeeklyStatRow): boolean => row.score >= 50;

// Pure aggregation of one user's rows for the week into the stored payload.
const computeSummaryPayload = (
  records: WeeklyStatRow[],
): WeeklySummaryPayload => {
  const games = buildWeeklyGameMeta();

  const statsMap: Record<
    string,
    { played: number; wins: number; totalScore: number }
  > = {};
  games.forEach((g) => {
    statsMap[g.mode] = { played: 0, wins: 0, totalScore: 0 };
  });

  let totalReactionTime = 0;
  let totalWins = 0;
  const totalGamesPlayedCount = records.length;

  records.forEach((row) => {
    totalReactionTime += row.reaction_time_ms || 0;
    if (isWin(row)) totalWins++;

    if (row.game_type_id && statsMap[row.game_type_id]) {
      statsMap[row.game_type_id].played++;
      statsMap[row.game_type_id].totalScore += row.score || 0;
      if (isWin(row)) statsMap[row.game_type_id].wins++;
    }
  });

  const total_games_played = games
    .map((g) => `${g.label} : ${statsMap[g.mode].played}/${g.weeklyMax}`)
    .join(", ");

  // Best game = highest average score among games actually played.
  let bestGameMode: GameMode | null = null;
  let maxAverageScore = -1;
  games.forEach((g) => {
    const stats = statsMap[g.mode];
    if (stats.played > 0) {
      const avg = stats.totalScore / stats.played;
      if (avg > maxAverageScore) {
        maxAverageScore = avg;
        bestGameMode = g.mode;
      }
    }
  });

  const globalAvgTimeMs =
    totalGamesPlayedCount > 0 ? totalReactionTime / totalGamesPlayedCount : 0;
  const average_completion_time = `${(globalAvgTimeMs / 1000).toFixed(1)}s`;
  const generalSuccessRate =
    totalGamesPlayedCount > 0 ? (totalWins / totalGamesPlayedCount) * 100 : 0;

  // Witty performance copy matrix (bands preserved from the original script).
  let summary_copy = "";

  if (totalGamesPlayedCount < 5) {
    // Band 1: low engagement fallback
    summary_copy = "We missed you this week, you’ll only know if you try";
  } else if (totalGamesPlayedCount >= 10 && generalSuccessRate >= 80) {
    // Band 2: max volume + high accuracy
    summary_copy = "excelent work, keep going consistency is key";
  } else if (totalGamesPlayedCount >= 10 && generalSuccessRate < 50) {
    // Band 3: high volume + low accuracy
    summary_copy =
      "You ran through the arena like a loose live wire this week. High energy, pure chaos. Let's trade some of that frantic speed for actual accuracy next run.";
  } else if (
    totalGamesPlayedCount >= 5 &&
    totalGamesPlayedCount <= 10 &&
    generalSuccessRate >= 75
  ) {
    // Band 4: mid volume + high accuracy
    summary_copy =
      "keep pushing, just a little more, your mental abs are almost visible";
  } else if (totalGamesPlayedCount > 8) {
    // Band 5: granular per-game breakdowns for high activity
    if (statsMap["GUT_CHECK"].played >= 2) {
      summary_copy =
        "Leaned hard into Gut Check runs this week, huh? Intuition is solid, but make sure your logic loop isn't just taking wild calculated guesses.";
    } else if (statsMap["MENTAL_REFLEX"].played >= 3) {
      summary_copy =
        "Absolute reflex engine champion this week. You're reacting at lightning speeds, just remember to let your analytical focus keep up.";
    } else if (statsMap["EXTRACT_THE_FACTS"].played >= 3) {
      summary_copy =
        "You spent a lot of time extracting facts this week. Your data mining skills are clean, now let's scale up that evaluation pacing.";
    } else {
      summary_copy =
        "Solid execution metrics and healthy volume across the board. Your diagnostic radar is getting a serious workout.";
    }
  } else if (generalSuccessRate < 50) {
    // Band 6: low accuracy fallback
    summary_copy = "Dont loose heart, keep training, we're rooting for you";
  } else {
    summary_copy =
      "Consistent and balanced progression. Keep tuning your core cognitive instincts across your upcoming daily runs.";
  }

  return {
    total_games_played,
    best_game: {
      game_type_id: bestGameMode,
      highest_score: maxAverageScore === -1 ? 0 : Math.round(maxAverageScore),
    },
    average_completion_time,
    summary_copy,
  };
};

// Lazy per-user path: compute and store one user's summary for the given week.
// Returns null for a brand-new user (no plays in the window AND no user_stats
// history from before the week ended) — no row is written and no modal shows.
const computeAndUpsertSummaryForUser = async (
  dbUuid: string,
  range: WeekRange,
): Promise<WeeklySummaryPayload | null> => {
  const records = await prisma.user_stats.findMany({
    where: {
      user_id: dbUuid,
      created_at: { gte: range.windowStart, lte: range.windowEnd },
    },
    select: { game_type_id: true, score: true, reaction_time_ms: true },
  });

  if (records.length === 0) {
    const existedBefore = await prisma.user_stats.findFirst({
      where: { user_id: dbUuid, created_at: { lt: range.windowEnd } },
      select: { id: true },
    });
    if (!existedBefore) return null;
  }

  const payload = computeSummaryPayload(records as WeeklyStatRow[]);

  await prisma.weekly_summaries.upsert({
    where: {
      user_id_week_start_date: {
        user_id: dbUuid,
        week_start_date: range.weekStartDate,
      },
    },
    update: { payload }, // never touch dismissed_at
    create: {
      user_id: dbUuid,
      week_start_date: range.weekStartDate,
      payload,
    },
  });

  return payload;
};

// Batch path: one summary row per user who existed before the week ended.
// Invoked by the Sunday cron (app/api/generate-weekly/route.ts).
const generateWeeklySummaries = async (
  range: WeekRange = getCompletedWeekRange(),
): Promise<{ weekStartKey: string; users: number }> => {
  console.log(
    `Generating weekly summaries for week ${range.weekStartKey} → ${range.weekEndKey}`,
  );

  // Only users who existed before the week ended — a user whose first play is
  // after the window shouldn't get a "we missed you" row for a week predating
  // their arrival.
  const userRows = await prisma.user_stats.findMany({
    where: { created_at: { lt: range.windowEnd } },
    select: { user_id: true },
    distinct: ["user_id"],
  });

  const records = await prisma.user_stats.findMany({
    where: { created_at: { gte: range.windowStart, lte: range.windowEnd } },
    select: {
      user_id: true,
      game_type_id: true,
      score: true,
      reaction_time_ms: true,
    },
  });

  const byUser = new Map<string, WeeklyStatRow[]>();
  records.forEach((row) => {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row as WeeklyStatRow);
    byUser.set(row.user_id, list);
  });

  for (const { user_id } of userRows) {
    const payload = computeSummaryPayload(byUser.get(user_id) ?? []);
    try {
      await prisma.weekly_summaries.upsert({
        where: {
          user_id_week_start_date: {
            user_id,
            week_start_date: range.weekStartDate,
          },
        },
        update: { payload }, // never touch dismissed_at
        create: {
          user_id,
          week_start_date: range.weekStartDate,
          payload,
        },
      });
    } catch (upsertError: unknown) {
      console.error(
        `Weekly summary write failed for user ${user_id}:`,
        upsertError instanceof Error ? upsertError.message : upsertError,
      );
    }
  }

  console.log(`Weekly summaries done: ${userRows.length} users`);
  return { weekStartKey: range.weekStartKey, users: userRows.length };
};

export { generateWeeklySummaries, computeAndUpsertSummaryForUser };

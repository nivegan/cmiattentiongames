"use server";
// home-actions.ts
// Server actions backing the one-time onboarding flow at `/`.
//
// Onboarding completion is tracked per user in the `user_onboarding` table:
//   - a row exists  → the user finished onboarding (skip it)
//   - no row        → show onboarding
// The row is written only when the user reaches the end and taps BEGIN TRAINING,
// never on mere arrival — so someone who bails mid-onboarding sees it again.
//
// Identity mirrors the rest of the app: prefer the Clerk userId, fall back to
// the anonymous localStorage deviceId, then map to a DB-safe UUID.

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";
import { getCurrentDayRange } from "@/utils/getCurrentDayRange";
import { getCompletedWeekRange } from "@/utils/weekRange";
import { getOrGenerateWeeklySummary } from "@/utils/weeklyReviewFallback";
import type { GameMode } from "@/utils/gameMode";
import type { WeeklyReviewResult } from "@/utils/weeklySummaryTypes";

// Returns true if this user/device has already completed onboarding.
// Fails open (returns false → show onboarding) so a transient DB error never
// hard-blocks the app; the worst case is re-showing onboarding once.
const hasCompletedOnboarding = async (deviceId: string): Promise<boolean> => {
  try {
    const { userId } = await auth();
    // Check BOTH identities: a guest who completed onboarding (row under their
    // deviceId) and then signs in shouldn't be shown it again under their userId.
    const ids = [userId, deviceId]
      .filter((v): v is string => Boolean(v))
      .map(safeFormatToUuid);
    if (ids.length === 0) return false;

    const row = await prisma.user_onboarding.findFirst({
      where: { user_id: { in: ids } },
    });
    return row !== null;
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    return false;
  }
};

// Marks onboarding complete for this user/device. Idempotent upsert — calling it
// twice (e.g. two tabs) just no-ops on the second.
const completeOnboarding = async (deviceId: string): Promise<void> => {
  try {
    const { userId } = await auth();
    const identifier = userId || deviceId;
    if (!identifier) return;

    const dbUuid = safeFormatToUuid(identifier);
    await prisma.user_onboarding.upsert({
      where: { user_id: dbUuid },
      create: { user_id: dbUuid },
      update: {}, // already completed — leave completed_at untouched
    });
  } catch (error) {
    console.error("Error completing onboarding:", error);
  }
};

// Returns the distinct game modes this user/device has played today (IST).
// Drives the home page's DAILY PROGRESS counter and per-card "completed" state.
// Fails open (empty array) so a DB error never blocks the home page rendering.
const fetchPlayedToday = async (deviceId: string): Promise<GameMode[]> => {
  try {
    const { userId } = await auth();
    const identifier = userId || deviceId;
    if (!identifier) return [];

    const dbUuid = safeFormatToUuid(identifier);
    const { start, end } = getCurrentDayRange();

    const rows = await prisma.user_stats.findMany({
      where: {
        user_id: dbUuid,
        created_at: { gte: start, lte: end },
        game_type_id: { not: null },
      },
      select: { game_type_id: true },
      distinct: ["game_type_id"],
    });

    return rows
      .map((r) => r.game_type_id)
      .filter((m): m is GameMode => m !== null);
  } catch (error) {
    console.error("Error fetching games played today:", error);
    return [];
  }
};

// Weekly review (US 4.3): should the celebratory modal open for this visit?
// Signed-in users only. Returns the most recently completed IST week's summary
// unless it has already been dismissed. If the Sunday cron hasn't produced the
// row yet, computes it lazily so the modal is never empty.
// Fails closed ({ show: false }) so a DB error never blocks the home page.
// (No deviceId parameter — unlike the other actions here, this feature is
// signed-in only, so identity comes solely from the Clerk session.)
const fetchWeeklyReview = async (): Promise<WeeklyReviewResult> => {
  try {
    const { userId } = await auth();
    if (!userId) return { show: false }; // guests never see the modal

    const dbUuid = safeFormatToUuid(userId);
    const range = getCompletedWeekRange();

    // Fetches the row, running the endpoint's batch once if the cron hasn't
    // produced it yet; null = brand-new user with nothing to review.
    const row = await getOrGenerateWeeklySummary(dbUuid, range);
    if (!row || row.dismissed_at) return { show: false };

    return {
      show: true,
      weekStartKey: range.weekStartKey,
      weekEndKey: range.weekEndKey,
      payload: row.payload,
    };
  } catch (error) {
    console.error("Error fetching weekly review:", error);
    return { show: false };
  }
};

// Permanently dismisses a week's review modal for the signed-in user.
// updateMany keeps it idempotent (two tabs dismissing is a harmless no-op).
const dismissWeeklyReview = async (
  weekStartKey: string, // IST "YYYY-MM-DD" Sunday, from fetchWeeklyReview
): Promise<void> => {
  try {
    const { userId } = await auth();
    if (!userId) return;

    const dbUuid = safeFormatToUuid(userId);
    await prisma.weekly_summaries.updateMany({
      where: {
        user_id: dbUuid,
        week_start_date: new Date(`${weekStartKey}T00:00:00Z`),
      },
      data: { dismissed_at: new Date() },
    });
  } catch (error) {
    console.error("Error dismissing weekly review:", error);
  }
};

export {
  hasCompletedOnboarding,
  completeOnboarding,
  fetchPlayedToday,
  fetchWeeklyReview,
  dismissWeeklyReview,
};

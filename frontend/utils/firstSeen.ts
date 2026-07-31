// utils/firstSeen.ts
// "Was this user around before <cutoff>?" — used to keep the weekly review modal
// away from brand-new users.
//
// Why this is needed: utils/weekly_summary_endpoint.ts enumerates ALL-TIME
// distinct user_stats.user_id and writes a row for every one of them, falling
// back to "We missed you this week" copy when the week has under 5 plays. So a
// user who signed up today and played once gets a 0-play summary for LAST week.
// The null guard in weeklyReviewFallback.ts only covers users with zero
// user_stats rows ever, which is nobody who has actually played.
//
// Two signals, checked in order so the common case costs one indexed probe:
//   1. user_onboarding.completed_at — PK on user_id (index probe), and the value
//      is immutable because completeOnboarding's upsert uses `update: {}`.
//   2. user_stats.created_at — fallback for users predating user_onboarding, and
//      for a returning user who re-onboarded on a second device (which writes a
//      FRESH completed_at that would otherwise falsely suppress their modal).
//
// daily_funnel is deliberately not consulted: it is the largest table, has no
// index on user_id, and adds no coverage — only users with a user_stats row can
// have a summary to show in the first place.

import { prisma } from "@/utils/prismaInit";

// `userIds` must already be UUID-converted (safeFormatToUuid). Pass BOTH the
// Clerk identity and the anonymous deviceId so a guest who onboarded on this
// device and signed in later still reads as an existing user.
//
// Deliberately unguarded — callers own the error policy (fetchWeeklyReview's
// outer try/catch already fails closed), matching weeklyReviewFallback.ts.
const hasActivityBefore = async (
  userIds: string[],
  cutoff: Date,
): Promise<boolean> => {
  if (userIds.length === 0) return false;

  // findFirst + `lt` rather than an aggregate _min: we only need existence, so
  // Postgres can stop at the first matching row instead of scanning the set.
  const onboarded = await prisma.user_onboarding.findFirst({
    where: { user_id: { in: userIds }, completed_at: { lt: cutoff } },
    select: { user_id: true },
  });
  if (onboarded) return true;

  const played = await prisma.user_stats.findFirst({
    where: { user_id: { in: userIds }, created_at: { lt: cutoff } },
    select: { id: true },
  });
  return played !== null;
};

export { hasActivityBefore };

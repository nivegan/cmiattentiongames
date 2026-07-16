// utils/weeklyReviewFallback.ts
// Extra functionality deliberately kept OUT of utils/weekly_summary_endpoint.ts
// (that file mirrors the backend original and must stay as-is).
//
// The home page modal needs a summary row even if the Monday cron hasn't run
// yet (early-Monday visit, or a failed cron run). This helper checks for the
// visiting user's row and, when it's missing, runs the endpoint's full batch
// once, then re-reads. The batch regenerates every user — trivial at the
// current user count; revisit if the user base grows large.
//
// A brand-new user (no user_stats rows at all) gets no row from the batch
// either → returns null → the caller shows no modal.

import { prisma } from "@/utils/prismaInit";
import { generateWeeklySummaries } from "@/utils/weekly_summary_endpoint";
import type { WeekRange } from "@/utils/weekRange";
import type { WeeklySummaryPayload } from "@/utils/weeklySummaryTypes";

interface WeeklySummaryRow {
  payload: WeeklySummaryPayload;
  dismissed_at: Date | null;
}

const getOrGenerateWeeklySummary = async (
  dbUuid: string,
  range: WeekRange,
): Promise<WeeklySummaryRow | null> => {
  const lookup = () =>
    prisma.weekly_summaries.findUnique({
      where: {
        user_id_week_start_date: {
          user_id: dbUuid,
          week_start_date: range.weekStartDate,
        },
      },
    });

  let row = await lookup();
  if (!row) {
    await generateWeeklySummaries(); // cron hasn't produced this week yet
    row = await lookup();
  }
  if (!row) return null; // brand-new user — nothing to review

  return {
    payload: row.payload as unknown as WeeklySummaryPayload,
    dismissed_at: row.dismissed_at,
  };
};

export { getOrGenerateWeeklySummary };

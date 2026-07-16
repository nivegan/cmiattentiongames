// app/api/cron/generate-weekly/route.ts
// Cron endpoint that batch-generates weekly review summaries (US 4.3).
// Scheduled in vercel.json for Sunday 19:00 UTC = Monday 00:30 IST, right
// after the IST week (Monday → Sunday) closes.
//
// Auth: Vercel cron invocations automatically send
// `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET env var is set
// on the project. There is no Clerk session here, so this replaces the
// isAdmin() gate used by /api/admin. Fails closed: an unset secret rejects
// everything rather than letting the route run unauthenticated.
//
// Users who visit before this has run are covered by the lazy per-user
// fallback in fetchWeeklyReview (app/home-actions.ts).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateWeeklySummaries } from "@/utils/weekly_summary_endpoint";
import { getCompletedWeekRange } from "@/utils/weekRange";
import { capturePosthog } from "@/utils/posthogServer";

// Batch loops all users; allow more than the default function duration.
export const maxDuration = 60;

export const GET = async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // generateWeeklySummaries returns void (the file mirrors the backend
    // original), so the week key for the response comes from the same shared
    // range helper the generator uses.
    const { weekStartKey } = getCompletedWeekRange();
    await generateWeeklySummaries();
    void capturePosthog("system_cron", "weekly_summaries_generated", {
      weekStartKey,
    });
    return NextResponse.json({ ok: true, weekStartKey });
  } catch (error) {
    console.error("generate-weekly route error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
};

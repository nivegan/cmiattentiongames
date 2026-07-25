// app/api/cron/send-daily-push/route.ts
// Cron endpoint that sends the daily reminder push to every stored web-push
// subscription. Content comes from lib/getDailyCopy.ts (day-of-week copy).
// Scheduled in vercel.json at 30 2 * * * (02:30 UTC = 08:00 IST).
//
// Auth: same fail-closed CRON_SECRET bearer gate as the other cron routes.
// The route is scheduler-agnostic — if the Vercel plan is Hobby (max 2 cron
// jobs, already used by generate-daily/generate-weekly), drop the vercel.json
// entry and trigger this from an external scheduler instead (cron-job.org or
// a GitHub Actions scheduled workflow curling with the bearer header).
//
// Expired subscriptions (push service returns 404/410) are pruned from
// push_subscriptions in one deleteMany after the send fan-out.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import webpush from "web-push";
import { prisma } from "@/utils/prismaInit";
import { getTodayIST } from "@/utils/seedRng";
import { getDailyCopy } from "@/lib/getDailyCopy";
import { capturePosthog } from "@/utils/posthogServer";

// Fan-out to many push endpoints can take a while on a big subscriber list.
export const maxDuration = 60;

export const GET = async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return NextResponse.json(
      { error: "Missing VAPID keys" },
      { status: 500 },
    );
  }
  // Configured inside the handler (not module load) so a missing key can never
  // break the build or unrelated routes.
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:mazumdarkush2002@gmail.com",
    publicKey,
    privateKey,
  );

  try {
    // getDailyCopy keys off Date.getDay() in the SERVER'S local timezone. A
    // Date built from the IST date string at local noon has the IST weekday on
    // any host TZ (noon is >5.5h clear of both midnights). Do not call
    // getDailyCopy() bare here — on a UTC host that's yesterday's copy until
    // 05:30 IST.
    const copy = getDailyCopy(new Date(`${getTodayIST()}T12:00:00`));
    const payload = JSON.stringify({
      title: `KALARI GAMES // ${copy.dayName.toUpperCase()} MISSIONS`,
      body: copy.copy,
      url: "/?source=push",
    });

    const subs = await prisma.push_subscriptions.findMany();
    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          // Reminder is stale by evening — let push services drop undelivered
          // notifications after 6 hours instead of delivering at midnight.
          { TTL: 6 * 3600 },
        ),
      ),
    );

    // 404/410 = subscription gone (user revoked / browser reset) → prune.
    const expired: string[] = [];
    let sent = 0;
    let failed = 0;
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        sent++;
        return;
      }
      failed++;
      const statusCode = (result.reason as webpush.WebPushError)?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        expired.push(subs[i].endpoint);
      }
    });
    if (expired.length > 0) {
      await prisma.push_subscriptions.deleteMany({
        where: { endpoint: { in: expired } },
      });
    }

    void capturePosthog("system_cron", "daily_push_sent", {
      day: copy.dayName,
      total: subs.length,
      sent,
      failed,
      pruned: expired.length,
    });

    return NextResponse.json({
      status: "Success",
      day: copy.dayName,
      total: subs.length,
      sent,
      failed,
      pruned: expired.length,
    });
  } catch (error) {
    console.error("send-daily-push error:", error);
    return NextResponse.json(
      { status: "Error", message: String(error) },
      { status: 500 },
    );
  }
};

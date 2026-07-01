// posthogServer.ts
// Server-side PostHog capture helper (posthog-node). Used to mirror the app's
// semantic funnel events (SESSION_START, GAME_START, GAME_COMPLETE, SESSION_END)
// into PostHog from the same server code that already writes them to the
// `daily_funnel` table — so no game page needs to change.
//
// distinctId MUST be the raw `userId || deviceId` (the same value the client
// passes to posthog.identify in SessionTracker), NOT the UUID-converted DB id,
// so client pageviews and server events resolve to a single PostHog person.
//
// If NEXT_PUBLIC_POSTHOG_KEY is unset, this is a no-op (mirrors the client guard
// in instrumentation-client.ts).
//
// A fresh client per call + shutdown() is PostHog's documented serverless
// pattern (flushAt/flushInterval force an immediate flush; shutdown drains the
// queue before the function can freeze). If event volume grows, this could be
// swapped for a pooled singleton with periodic flushing.

import { PostHog } from "posthog-node";

const capturePosthog = async (
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> => {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || !distinctId) return;

  const client = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });

  try {
    client.capture({ distinctId, event, properties });
    await client.shutdown();
  } catch (error) {
    // Never let an analytics failure surface to the caller.
    console.error(`capturePosthog error (${event}):`, error);
  }
};

export { capturePosthog };

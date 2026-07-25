"use server";
// push-actions.ts
// Server actions for storing/removing web-push subscriptions
// (push_subscriptions table). Mirrors the logFunnelEvent identity pattern:
// auth() → prefer Clerk userId over the anonymous deviceId → safeFormatToUuid
// before any DB write.
//
// Rows are keyed by endpoint (UNIQUE): re-subscribing the same browser after a
// guest signs in re-homes the existing row to the new identity instead of
// duplicating — sends are per-endpoint, so mixed identities can't double-send.

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { capturePosthog } from "@/utils/posthogServer";
import { prisma } from "@/utils/prismaInit";
import type { PushSubscriptionPayload } from "@/utils/pwaTypes";

const subscribeToPush = async (
  deviceId: string,
  sub: PushSubscriptionPayload,
): Promise<{ success: boolean }> => {
  try {
    const { userId } = await auth();
    const identifier = userId || deviceId;
    if (!identifier || !sub?.endpoint || !sub.p256dh || !sub.auth)
      return { success: false };

    const dbSafeUuid = safeFormatToUuid(identifier);
    await prisma.push_subscriptions.upsert({
      where: { endpoint: sub.endpoint },
      update: { user_id: dbSafeUuid, p256dh: sub.p256dh, auth: sub.auth },
      create: {
        user_id: dbSafeUuid,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    });

    // Raw identifier (not dbSafeUuid) so it matches client-side posthog.identify.
    await capturePosthog(identifier, "push_subscribed", {});
    return { success: true };
  } catch (error) {
    console.error("subscribeToPush error:", error);
    return { success: false };
  }
};

const unsubscribeFromPush = async (
  deviceId: string,
  endpoint: string,
): Promise<{ success: boolean }> => {
  try {
    const { userId } = await auth();
    const identifier = userId || deviceId;
    if (!endpoint) return { success: false };

    await prisma.push_subscriptions.deleteMany({ where: { endpoint } });

    if (identifier) await capturePosthog(identifier, "push_unsubscribed", {});
    return { success: true };
  } catch (error) {
    console.error("unsubscribeFromPush error:", error);
    return { success: false };
  }
};

export { subscribeToPush, unsubscribeFromPush };

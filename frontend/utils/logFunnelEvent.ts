"use server";
// logFunnelEvent.ts
// Server action for writing funnel events to the `daily_funnel` table.
// Used for all events EXCEPT SESSION_END (which must go through /api/log-event
// because sendBeacon cannot invoke server actions — see SessionTracker.tsx).
//
// All call sites fire this without await (fire-and-forget) so game UI
// interactions are never blocked waiting for the DB write to complete.
//
// Signature: logFunnelEvent(eventType, deviceId, gameTypeId?)
//   eventType  — one of the EventType enum values (SESSION_START, GAME_START,
//                GAME_CLICK, GAME_COMPLETE)
//   deviceId   — anonymous device UUID from localStorage; server action also
//                reads the Clerk userId and prefers it if the user is signed in
//   gameTypeId — optional; null for SESSION_START (no game context)

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { capturePosthog } from "@/utils/posthogServer";
import { prisma } from "@/utils/prismaInit";
import type { EventType } from "@/lib/generated/prisma/enums";
import type { GameMode } from "@/utils/gameMode";

const logFunnelEvent = async (
  eventType: EventType,
  deviceId: string,
  gameTypeId?: GameMode,
): Promise<{ success: boolean }> => {
  try {
    const { userId } = await auth();
    // Prefer the authenticated Clerk userId over the anonymous deviceId so
    // signed-in sessions are attributable to a real user. Falls back to deviceId
    // for anonymous play — mirrors the same pattern in saveUserGameStat.
    const identifier = userId || deviceId;
    if (!identifier) return { success: false };

    // Clerk userIds ("user_2abc...") are not UUID format; safeFormatToUuid
    // converts them via UUID v5. Valid UUIDs (deviceId) pass through unchanged.
    const dbSafeUuid = safeFormatToUuid(identifier);
    // Generate a fresh UUID for the row primary key on every event
    const rowId = globalThis.crypto.randomUUID();

    await prisma.daily_funnel.create({
      data: {
        id: rowId,
        user_id: dbSafeUuid,
        event_type: eventType,
        // gameTypeId is optional — SESSION_START has no game context
        game_type_id: gameTypeId ?? null,
      },
    });

    // Mirror to PostHog for time-series/funnel analytics. GAME_CLICK is excluded
    // — it fires on every tap (very high volume) and lives only in daily_funnel.
    // Uses the raw identifier (not dbSafeUuid) so it matches the client-side
    // posthog.identify(userId ?? deviceId). Nested try/catch inside capturePosthog
    // guarantees an analytics failure never affects the DB-write result above.
    if (eventType !== "GAME_CLICK") {
      await capturePosthog(identifier, eventType, {
        game_type_id: gameTypeId ?? null,
      });
    }

    return { success: true };
  } catch (error) {
    // Swallow errors so a funnel write failure never disrupts the game flow.
    // The return value is { success: false } but callers don't await it anyway.
    console.error(`logFunnelEvent error (${eventType}):`, error);
    return { success: false };
  }
};

export { logFunnelEvent };

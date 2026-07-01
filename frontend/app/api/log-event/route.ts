// app/api/log-event/route.ts
// Plain Next.js POST route — the dedicated receiver for SESSION_END events.
//
// Why a route handler instead of a server action?
//   `navigator.sendBeacon` (used in SessionTracker.tsx on tab/browser close)
//   can only fire a raw HTTP POST. It has no mechanism to invoke Next.js server
//   actions, so SESSION_END must go through a plain HTTP endpoint.
//
// Why not use this route for all funnel events?
//   All other events (SESSION_START, GAME_START, GAME_CLICK, GAME_COMPLETE) are
//   fired from normal interaction handlers where a fetch/server-action call is
//   safe. Routing them through sendBeacon/this endpoint would add unnecessary
//   indirection. Only SESSION_END requires the beacon approach.
//
// Expected JSON body: { eventType: EventType, deviceId: string, gameTypeId?: GameMode }

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/utils/prismaInit";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { capturePosthog } from "@/utils/posthogServer";
import type { EventType } from "@/lib/generated/prisma/enums";
import type { GameMode } from "@/utils/generate_game";
import { NextRequest, NextResponse } from "next/server";

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { eventType, deviceId, gameTypeId } = body as {
      eventType: EventType;
      deviceId: string;
      gameTypeId?: GameMode;
    };

    const { userId } = await auth();
    // Prefer the authenticated Clerk userId; fall back to anonymous deviceId —
    // same identity resolution logic as logFunnelEvent and saveUserGameStat.
    const identifier = userId || deviceId;
    if (!identifier)
      return NextResponse.json({ success: false }, { status: 400 });

    // Clerk userIds are not UUID format; safeFormatToUuid coerces them via UUID v5.
    const dbSafeUuid = safeFormatToUuid(identifier);
    const rowId = globalThis.crypto.randomUUID();

    await prisma.daily_funnel.create({
      data: {
        id: rowId,
        user_id: dbSafeUuid,
        event_type: eventType,
        game_type_id: gameTypeId ?? null,
      },
    });

    // Mirror SESSION_END to PostHog (same distinctId as the client identify and
    // the other server-mirrored events). capturePosthog swallows its own errors.
    await capturePosthog(identifier, eventType, {
      game_type_id: gameTypeId ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // sendBeacon does not inspect the response, but a 500 status is logged
    // server-side for observability. The beacon is fire-and-forget on the client.
    console.error("log-event route error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
};

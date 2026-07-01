// app/api/admin/route.ts
// Admin-only analytics endpoint. Returns today's (IST) engagement metrics as
// JSON, derived entirely from the `daily_funnel` event stream:
//   - dau            : distinct users who started >=1 game today
//   - per game       : starts, completes, abandon rate, avg time-spent (sec)
//
// Access is gated by isAdmin() (Clerk privateMetadata.role === "admin"); this is
// the second, independent checkpoint — never trust a page-level guard alone,
// because a route handler is directly callable.
//
// "time_spent_sec" is not stored anywhere, so avg time-spent is DERIVED as
// (GAME_COMPLETE.created_at - GAME_START.created_at) per user, per game.

import { NextResponse } from "next/server";
import { isAdmin } from "@/utils/requireAdmin";
import { prisma } from "@/utils/prismaInit";
import { getCurrentDayRange } from "@/utils/getCurrentDayRange";
import { getTodayIST } from "@/utils/seedRng";
import { EventType, GameType } from "@/lib/generated/prisma/enums";

type GameMetrics = {
  game: GameType;
  starts: number;
  completes: number;
  abandonRate: number | null; // (starts - completes) / starts; null if no starts
  avgTimeSpentSec: number | null; // null if nobody completed this game today
};

export const GET = async () => {
  try {
    // Checkpoint 2: gate the raw endpoint, independent of the /admin page guard.
    if (!(await isAdmin()))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { start, end } = getCurrentDayRange();

    // Single query: today's GAME_START + GAME_COMPLETE events (both carry a game).
    const events = await prisma.daily_funnel.findMany({
      where: {
        created_at: { gte: start, lte: end },
        event_type: { in: [EventType.GAME_START, EventType.GAME_COMPLETE] },
        game_type_id: { not: null },
      },
      select: {
        user_id: true,
        event_type: true,
        game_type_id: true,
        created_at: true,
      },
    });

    // Per-game, per-user earliest timestamps. Using the *earliest* event of each
    // type makes the math robust to any duplicate rows (funnel logging is
    // fire-and-forget, so a reload could emit a second GAME_START).
    const startAt = new Map<string, Map<string, number>>(); // game -> (user -> ms)
    const completeAt = new Map<string, Map<string, number>>();
    const dau = new Set<string>();

    const remember = (
      bucket: Map<string, Map<string, number>>,
      game: string,
      user: string,
      ms: number,
    ) => {
      let byUser = bucket.get(game);
      if (!byUser) {
        byUser = new Map();
        bucket.set(game, byUser);
      }
      const prev = byUser.get(user);
      if (prev === undefined || ms < prev) byUser.set(user, ms);
    };

    for (const e of events) {
      if (!e.game_type_id) continue;
      const ms = e.created_at.getTime();
      if (e.event_type === EventType.GAME_START) {
        dau.add(e.user_id); // DAU = opened app + started >=1 game
        remember(startAt, e.game_type_id, e.user_id, ms);
      } else if (e.event_type === EventType.GAME_COMPLETE) {
        remember(completeAt, e.game_type_id, e.user_id, ms);
      }
    }

    // Emit a stable row for every game so the shape is consistent even at zero.
    const games: GameMetrics[] = Object.values(GameType).map((game) => {
      const starters = startAt.get(game) ?? new Map<string, number>();
      const finishers = completeAt.get(game) ?? new Map<string, number>();

      const starts = starters.size;
      const completes = finishers.size;
      const abandonRate = starts > 0 ? (starts - completes) / starts : null;

      // Avg duration over users who both started and completed today.
      const durations: number[] = [];
      for (const [user, completeMs] of finishers) {
        const startMs = starters.get(user);
        if (startMs !== undefined && completeMs >= startMs) {
          durations.push((completeMs - startMs) / 1000);
        }
      }
      const avgTimeSpentSec =
        durations.length > 0
          ? Math.round(
              (durations.reduce((a, b) => a + b, 0) / durations.length) * 10,
            ) / 10
          : null;

      return { game, starts, completes, abandonRate, avgTimeSpentSec };
    });

    return NextResponse.json({ date: getTodayIST(), dau: dau.size, games });
  } catch (error) {
    console.error("admin analytics route error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
};

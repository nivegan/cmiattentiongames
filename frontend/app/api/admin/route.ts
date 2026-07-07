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
// Metrics are SESSION-based, not user-based: every GAME_START is a session,
// and a GAME_COMPLETE closes that user's most recent open session. A session
// that is never closed counts as abandoned — so a user who opens a game,
// bails, then reopens and finishes shows 2 starts / 1 complete / 50% abandon.
// Fire-and-forget logging can double-emit an event, so per user+game any
// events of the same type within DUPLICATE_WINDOW_MS collapse into one.
//
// "time_spent_sec" is not stored anywhere, so avg time-spent is DERIVED as
// (GAME_COMPLETE.created_at - paired GAME_START.created_at) per session.

import { NextResponse } from "next/server";
import { isAdmin } from "@/utils/requireAdmin";
import { prisma } from "@/utils/prismaInit";
import { getCurrentDayRange } from "@/utils/getCurrentDayRange";
import { getTodayIST } from "@/utils/seedRng";
import { EventType, GameType } from "@/lib/generated/prisma/enums";

type GameMetrics = {
  game: GameType;
  starts: number; // sessions opened today (GAME_START events, dupes collapsed)
  completes: number; // sessions completed today
  abandonRate: number | null; // sessions started but never completed / starts
  avgTimeSpentSec: number | null; // null if nobody completed this game today
};

// Two identical events from the same user+game closer together than this are
// treated as one (double-fired log), not two sessions.
const DUPLICATE_WINDOW_MS = 5_000;

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

    // Per-game, per-user sorted timestamp lists for each event type.
    const startAt = new Map<string, Map<string, number[]>>(); // game -> (user -> ms[])
    const completeAt = new Map<string, Map<string, number[]>>();
    const dau = new Set<string>();

    const remember = (
      bucket: Map<string, Map<string, number[]>>,
      game: string,
      user: string,
      ms: number,
    ) => {
      let byUser = bucket.get(game);
      if (!byUser) {
        byUser = new Map();
        bucket.set(game, byUser);
      }
      const times = byUser.get(user);
      if (times) times.push(ms);
      else byUser.set(user, [ms]);
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

    // Sort ascending and collapse double-fired duplicates into one event.
    const dedupe = (times: number[]): number[] => {
      times.sort((a, b) => a - b);
      const kept: number[] = [];
      for (const ms of times) {
        if (
          kept.length === 0 ||
          ms - kept[kept.length - 1] > DUPLICATE_WINDOW_MS
        )
          kept.push(ms);
      }
      return kept;
    };

    // Emit a stable row for every game so the shape is consistent even at zero.
    const games: GameMetrics[] = Object.values(GameType).map((game) => {
      const starters = startAt.get(game) ?? new Map<string, number[]>();
      const finishers = completeAt.get(game) ?? new Map<string, number[]>();

      let starts = 0;
      let completes = 0;
      const durations: number[] = [];

      const users = new Set([...starters.keys(), ...finishers.keys()]);
      for (const user of users) {
        const userStarts = dedupe(starters.get(user) ?? []);
        const userCompletes = dedupe(finishers.get(user) ?? []);
        starts += userStarts.length;
        completes += userCompletes.length;

        // Pair each completion with the user's most recent unpaired start
        // before it — that start's session finished; earlier ones abandoned.
        let nextStart = userStarts.length - 1;
        for (let c = userCompletes.length - 1; c >= 0; c--) {
          while (nextStart >= 0 && userStarts[nextStart] > userCompletes[c])
            nextStart--;
          if (nextStart < 0) break;
          durations.push((userCompletes[c] - userStarts[nextStart]) / 1000);
          nextStart--;
        }
      }

      // Abandoned = sessions opened today that never reached a completion.
      // (durations.length, not completes: a completion with no start row
      // today — e.g. started just before IST midnight — can't excuse one.)
      const abandonRate =
        starts > 0 ? (starts - durations.length) / starts : null;

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

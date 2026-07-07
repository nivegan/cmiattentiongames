// app/api/admin/route.ts
// Admin-only analytics endpoint. Returns engagement metrics as JSON, derived
// from the `daily_funnel` event stream plus `user_stats` scores:
//   - dau     : distinct users who started >=1 game today (IST)
//   - ranking : all-time totals per game (a stable row for every GameType)
//   - daily   : per-IST-day log, newest first, one entry per game with activity
//
// Access is gated by isAdmin() (Clerk privateMetadata.role === "admin"); this is
// the second, independent checkpoint — never trust a page-level guard alone,
// because a route handler is directly callable.
//
// Metrics are SESSION-based, not user-based: every GAME_START is a session,
// and a GAME_COMPLETE closes that user's most recent open session. A session
// that is never closed counts as abandoned — so a user who opens a game,
// bails, then reopens and finishes shows 2 starts / 1 played / 1 abandoned.
// Fire-and-forget logging can double-emit an event, so per user+game+day any
// events of the same type within DUPLICATE_WINDOW_MS collapse into one.
// Sessions are paired within an IST day bucket (games take minutes, so a
// midnight-crossing session is a negligible edge — its start counts abandoned).
//
// "time_spent_sec" is not stored anywhere, so avg completion time is DERIVED
// as (GAME_COMPLETE.created_at - paired GAME_START.created_at) per session.

import { NextResponse } from "next/server";
import { isAdmin } from "@/utils/requireAdmin";
import { prisma } from "@/utils/prismaInit";
import { getTodayIST } from "@/utils/seedRng";
import { toISTDateKey } from "@/utils/toISTDateKey";
import { EventType, GameType } from "@/lib/generated/prisma/enums";
import type {
  AdminAnalytics,
  DailyEntry,
  GameDayMetrics,
  RankingRow,
} from "@/app/admin/types";

// Two identical events from the same user+game closer together than this are
// treated as one (double-fired log), not two sessions.
const DUPLICATE_WINDOW_MS = 5_000;

// Sort ascending and collapse double-fired duplicates into one event.
const dedupe = (times: number[]): number[] => {
  times.sort((a, b) => a - b);
  const kept: number[] = [];
  for (const ms of times) {
    if (kept.length === 0 || ms - kept[kept.length - 1] > DUPLICATE_WINDOW_MS)
      kept.push(ms);
  }
  return kept;
};

// Pair each completion with the same user's most recent unpaired start before
// it — that start's session finished; unpaired starts were abandoned. Returns
// deduped counts plus the duration (sec) of each finished session.
const pairSessions = (
  rawStarts: number[],
  rawCompletes: number[],
): { starts: number; completes: number; durations: number[] } => {
  const starts = dedupe(rawStarts);
  const completes = dedupe(rawCompletes);
  const durations: number[] = [];
  let nextStart = starts.length - 1;
  for (let c = completes.length - 1; c >= 0; c--) {
    while (nextStart >= 0 && starts[nextStart] > completes[c]) nextStart--;
    if (nextStart < 0) break;
    durations.push((completes[c] - starts[nextStart]) / 1000);
    nextStart--;
  }
  return { starts: starts.length, completes: completes.length, durations };
};

const mean1dp = (values: number[]): number | null =>
  values.length > 0
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null;

// day -> game -> user -> raw event timestamps
type FunnelBuckets = Map<
  string,
  Map<string, Map<string, { starts: number[]; completes: number[] }>>
>;

export const GET = async () => {
  try {
    // Checkpoint 2: gate the raw endpoint, independent of the /admin page guard.
    if (!(await isAdmin()))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // All-time funnel events + scores (beta-scale tables; two flat queries).
    const [events, scoreRows] = await Promise.all([
      prisma.daily_funnel.findMany({
        where: {
          event_type: { in: [EventType.GAME_START, EventType.GAME_COMPLETE] },
          game_type_id: { not: null },
        },
        select: {
          user_id: true,
          event_type: true,
          game_type_id: true,
          created_at: true,
        },
      }),
      prisma.user_stats.findMany({
        where: { game_type_id: { not: null } },
        select: { game_type_id: true, score: true, created_at: true },
      }),
    ]);

    const todayKey = toISTDateKey(new Date());
    const dau = new Set<string>();

    const funnel: FunnelBuckets = new Map();
    for (const e of events) {
      if (!e.game_type_id) continue;
      const day = toISTDateKey(e.created_at);
      let byGame = funnel.get(day);
      if (!byGame) {
        byGame = new Map();
        funnel.set(day, byGame);
      }
      let byUser = byGame.get(e.game_type_id);
      if (!byUser) {
        byUser = new Map();
        byGame.set(e.game_type_id, byUser);
      }
      let bucket = byUser.get(e.user_id);
      if (!bucket) {
        bucket = { starts: [], completes: [] };
        byUser.set(e.user_id, bucket);
      }
      if (e.event_type === EventType.GAME_START) {
        bucket.starts.push(e.created_at.getTime());
        if (day === todayKey) dau.add(e.user_id); // DAU = started >=1 game today
      } else {
        bucket.completes.push(e.created_at.getTime());
      }
    }

    // day -> game -> scores that IST day
    const scoresByDay = new Map<string, Map<string, number[]>>();
    for (const r of scoreRows) {
      if (!r.game_type_id) continue;
      const day = toISTDateKey(r.created_at);
      let byGame = scoresByDay.get(day);
      if (!byGame) {
        byGame = new Map();
        scoresByDay.set(day, byGame);
      }
      const list = byGame.get(r.game_type_id);
      if (list) list.push(r.score);
      else byGame.set(r.game_type_id, [r.score]);
    }

    // Per-game all-time accumulators for the ranking table.
    const totals = new Map<
      string,
      { plays: number; starts: number; durations: number[]; scores: number[] }
    >();
    const totalFor = (game: string) => {
      let t = totals.get(game);
      if (!t) {
        t = { plays: 0, starts: 0, durations: [], scores: [] };
        totals.set(game, t);
      }
      return t;
    };

    // Daily log: union of days seen in either source, newest first.
    const allDays = new Set([...funnel.keys(), ...scoresByDay.keys()]);
    const daily: DailyEntry[] = [...allDays]
      .sort((a, b) => (a < b ? 1 : -1)) // "YYYY-MM-DD" sorts lexicographically
      .map((day) => {
        const byGame = funnel.get(day);
        const dayScores = scoresByDay.get(day);
        const gamesToday = new Set([
          ...(byGame?.keys() ?? []),
          ...(dayScores?.keys() ?? []),
        ]);

        const games: GameDayMetrics[] = [...gamesToday].map((game) => {
          let starts = 0;
          let completed = 0;
          const durations: number[] = [];
          for (const bucket of (
            byGame?.get(game) ?? new Map<string, never>()
          ).values()) {
            const paired = pairSessions(bucket.starts, bucket.completes);
            starts += paired.starts;
            completed += paired.completes;
            durations.push(...paired.durations);
          }
          const scores = dayScores?.get(game) ?? [];
          const played = durations.length;

          const t = totalFor(game);
          t.plays += played;
          t.starts += starts;
          t.durations.push(...durations);
          t.scores.push(...scores);

          return {
            game: game as GameType,
            played,
            starts,
            completed,
            abandoned: starts - played,
            dropOffRate: starts > 0 ? (starts - played) / starts : null,
            avgTimeSpentSec: mean1dp(durations),
            avgScore: mean1dp(scores),
          };
        });

        return { date: day, games };
      });

    // Emit a stable ranking row for every game so the shape is consistent
    // even at zero activity.
    const ranking: RankingRow[] = Object.values(GameType).map((game) => {
      const t = totals.get(game) ?? {
        plays: 0,
        starts: 0,
        durations: [],
        scores: [],
      };
      return {
        game,
        plays: t.plays,
        starts: t.starts,
        abandoned: t.starts - t.plays,
        dropOffRate: t.starts > 0 ? (t.starts - t.plays) / t.starts : null,
        avgCompletionTimeSec: mean1dp(t.durations),
        avgScore: mean1dp(t.scores),
      };
    });

    const payload: AdminAnalytics = {
      date: getTodayIST(),
      dau: dau.size,
      ranking,
      daily,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("admin analytics route error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
};

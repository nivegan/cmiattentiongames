"use client";
// history/page.tsx
// Shows the signed-in user's game history grouped by IST calendar day. Each day
// is a card with the date, an "X/N" completion count (games played / daily total),
// a progress bar, and a pill per game played. A "Your Progress" footer shows the
// lifetime games-completed count.
//
// "use client" is required because this page reads from localStorage (the anonymous
// device id, passed through to the server action) and uses Clerk's useAuth() hook —
// both browser-only APIs.
//
// History is signed-in only: anonymous visitors see a "Sign in to save history"
// prompt (Clerk modal) and no history is ever fetched for them.
//
// DATA FLOW (signed-in):
//   1. Wait for Clerk to finish loading (isLoaded)
//   2. Read the device id from localStorage
//   3. Call fetchHistory(deviceId) — returns day-grouped plays + totals
//   4. Render the day cards + "Your Progress" footer

import { useAuth, SignInButton } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerkAppearance";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, CheckCircle2, ArrowLeft, Trophy } from "lucide-react";
import { fetchHistory, fetchWeeklySummaries } from "./actions";
import type { HistoryResult, WeeklySummaryEntry } from "./types";
import type { GameMode } from "@/utils/gameMode";
import { formatWeekLabel } from "@/lib/formatWeekLabel";
import { renderBoldCopy } from "@/lib/richCopy";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

// Maps each game mode to its human-readable pill label. Partial<Record<...>>
// means a mode without a label falls through to the raw id / "Unknown".
const GAME_LABELS: Partial<Record<GameMode, string>> = {
  GUT_CHECK: "Gut Check",
  EXTRACT_THE_FACTS: "Extract Facts",
  STEADY_GAZE: "Steady Gaze",
  CLEAR_THE_AIR: "Clear the Air",
  READ_BETWEEN_DESIGNS: "Read Between Designs",
  MENTAL_REFLEX: "Mental Reflex",
};

// Formats an IST date key ("2026-01-15") as e.g. "Mon, Jan 15". The key is
// already an IST calendar date, so appending T00:00:00 (local) and formatting
// without a timeZone keeps the same day — no timezone juggling needed.
const formatDay = (dateKey: string): string =>
  new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const HistoryPage = () => {
  // isLoaded: true once Clerk has finished checking for an active session
  // isSignedIn: true if the user is authenticated
  const { isSignedIn, isLoaded } = useAuth();

  const [data, setData] = useState<HistoryResult | null>(null);
  const [weeks, setWeeks] = useState<WeeklySummaryEntry[]>([]);
  const [view, setView] = useState<"daily" | "weekly">("daily");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // Wait until Clerk has determined the session state before deciding anything.
    if (!isLoaded) return;

    // Signed-out users never load history — they get the sign-in prompt instead.
    // No setState needed: the loading-screen guard below is gated on isSignedIn,
    // so the prompt renders for them regardless of the `loading` flag.
    if (!isSignedIn) return;

    const load = async () => {
      try {
        const deviceId =
          localStorage.getItem("meta_mind_global_device_id") ?? "";
        const [result, weekly] = await Promise.all([
          fetchHistory(deviceId),
          fetchWeeklySummaries(deviceId),
        ]);
        setData(result);
        setWeeks(weekly);
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isLoaded, isSignedIn]);

  // Wait for Clerk, then show the loading view while signed-in history loads.
  if (!isLoaded || (isSignedIn && loading)) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] flex items-center justify-center">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  // Signed-out: prompt to sign in (opens Clerk's modal in place). No history
  // is fetched or shown for anonymous visitors.
  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] flex items-center justify-center p-6">
        <div className="text-center space-y-6">
          <h1 className="font-serif font-bold text-2xl text-[#232323]">
            Sign in to save history
          </h1>
          <SignInButton mode="modal" appearance={clerkAppearance}>
            <Button className="rounded-full bg-[#8B2626] text-white px-6 hover:bg-[#732020] cursor-pointer">
              Sign In
            </Button>
          </SignInButton>
        </div>
      </div>
    );
  }

  // Inline retry UI if the fetch failed.
  if (loadError) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <p className="text-[#8B2626] font-medium">Failed to load history.</p>
          <Button
            onClick={() => window.location.reload()}
            className="rounded-full bg-[#8B2626] text-white px-6 hover:bg-[#732020] cursor-pointer"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const days = data?.days ?? [];
  const gamesCompleted = data?.gamesCompleted ?? 0;
  const hasEntries = data?.hasEntries ?? false;

  return (
    <div className="min-h-screen bg-[#FAF6F0]">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Header: back arrow + serif title + subtitle */}
        <div className="flex items-center gap-3 mb-2">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="rounded-xl bg-stone-200/60 hover:bg-stone-200 text-[#232323]"
          >
            <Link href="/" aria-label="Back to home">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <div>
            <h1 className="font-serif font-bold text-3xl text-[#232323] leading-tight">
              Practice History
            </h1>
            <p className="text-base text-stone-500">
              Your critical thinking journey
            </p>
          </div>
        </div>

        {/* Daily / Weekly segmented toggle (US 4.3) */}
        <div className="flex rounded-full bg-stone-200/60 p-1 w-fit">
          {(["daily", "weekly"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-5 py-1.5 text-sm font-medium capitalize transition-colors cursor-pointer ${
                view === v
                  ? "bg-[#8B2626] text-white"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {view === "weekly" ? (
          weeks.length > 0 ? (
            <>
              {weeks.map((week) => {
                const bestMode = week.payload.best_game.game_type_id;
                return (
                  <div
                    key={week.weekStartKey}
                    className="rounded-2xl border border-stone-200 bg-[#FBF8F2] px-5 py-4 space-y-3"
                  >
                    {/* Week span title */}
                    <div className="flex items-center gap-2">
                      <Calendar className="size-5 text-stone-400" />
                      <span className="font-serif font-bold text-lg text-[#232323]">
                        Week {formatWeekLabel(week.weekStartKey, week.weekEndKey)}
                      </span>
                    </div>

                    {/* Witty weekly summary line (may contain **bold** spans) */}
                    <p className="text-sm text-stone-600 italic">
                      {renderBoldCopy(week.payload.summary_copy)}
                    </p>

                    {/* Per-game play ratios */}
                    <div className="flex flex-wrap gap-2">
                      {week.payload.total_games_played
                        .split(", ")
                        .filter((row) => row.length > 0)
                        .map((row) => (
                          <span
                            key={row}
                            className="rounded-full bg-[#F0E3E3] px-3 py-1 text-sm font-medium text-[#8B2626]"
                          >
                            {row}
                          </span>
                        ))}
                    </div>

                    {/* Best game of the week */}
                    {bestMode && (
                      <div className="flex items-center gap-2 text-sm text-[#232323]">
                        <Trophy className="size-4 text-[#8B2626]" />
                        <span>
                          Best game:{" "}
                          <span className="font-medium text-[#8B2626]">
                            {GAME_LABELS[bestMode] ?? bestMode}
                          </span>{" "}
                          — {week.payload.best_game.highest_score} pts
                        </span>
                      </div>
                    )}

                    {/* Avg time — hidden while reaction_time_ms isn't tracked */}
                    {week.payload.average_completion_time !== "0.0s" && (
                      <p className="text-sm text-stone-500">
                        Avg completion time:{" "}
                        {week.payload.average_completion_time}
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Same lifetime footer as the daily view */}
              <div className="rounded-2xl bg-[#F3EDE3] px-6 py-8">
                <h2 className="font-serif font-bold text-2xl text-[#232323] mb-6">
                  Your Progress
                </h2>
                <div className="text-center">
                  <p className="font-serif font-bold text-4xl text-[#8B2626]">
                    {gamesCompleted}
                  </p>
                  <p className="text-stone-500 text-sm mt-1">Games Completed</p>
                </div>
              </div>
            </>
          ) : (
            // Weekly empty state
            <div className="text-center py-16 space-y-6">
              <p className="text-stone-500">
                No weekly summaries yet — your first review appears after a
                full week.
              </p>
              <Button
                asChild
                className="rounded-full bg-[#8B2626] text-white px-6 hover:bg-[#732020]"
              >
                <Link href="/">Play a Game</Link>
              </Button>
            </div>
          )
        ) : hasEntries ? (
          <>
            {days.map((day) => {
              const complete =
                day.dailyTotal > 0 && day.playedCount === day.dailyTotal;
              return (
                <div
                  key={day.dateKey}
                  className="rounded-2xl border border-stone-200 bg-[#FBF8F2] px-5 py-4 space-y-3"
                >
                  {/* Top row: date + X/N completion */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="size-5 text-stone-400" />
                      <span className="text-lg text-[#232323]">
                        {formatDay(day.dateKey)}
                      </span>
                    </div>
                    <div
                      className={`flex items-center gap-1.5 text-base ${
                        complete ? "text-[#8B2626]" : "text-stone-500"
                      }`}
                    >
                      {complete && <CheckCircle2 className="size-5" />}
                      <span>
                        {day.playedCount}/{day.dailyTotal}
                      </span>
                    </div>
                  </div>

                  {/* Completion progress bar (maroon fill on light track) */}
                  <Progress
                    value={
                      day.dailyTotal > 0
                        ? (day.playedCount / day.dailyTotal) * 100
                        : 0
                    }
                    className="h-2 bg-stone-200 *:data-[slot=progress-indicator]:bg-[#8B2626]"
                  />

                  {/* Games played that day */}
                  <div className="space-y-2">
                    <p className="text-sm text-stone-500">Games played:</p>
                    <div className="flex flex-wrap gap-2">
                      {day.games.map((g) => (
                        <span
                          key={g.id}
                          className="rounded-full bg-[#F0E3E3] px-3 py-1 text-sm font-medium text-[#8B2626]"
                        >
                          {(g.gameMode && GAME_LABELS[g.gameMode]) ??
                            g.gameMode ??
                            "Unknown"}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* "Your Progress" footer — single lifetime stat */}
            <div className="rounded-2xl bg-[#F3EDE3] px-6 py-8">
              <h2 className="font-serif font-bold text-2xl text-[#232323] mb-6">
                Your Progress
              </h2>
              <div className="text-center">
                <p className="font-serif font-bold text-4xl text-[#8B2626]">
                  {gamesCompleted}
                </p>
                <p className="text-stone-500 text-sm mt-1">Games Completed</p>
              </div>
            </div>
          </>
        ) : (
          // Empty state — signed-in user with no plays yet
          <div className="text-center py-16 space-y-6">
            <p className="text-stone-500">No games played yet.</p>
            <Button
              asChild
              className="rounded-full bg-[#8B2626] text-white px-6 hover:bg-[#732020]"
            >
              <Link href="/">Play a Game</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryPage;

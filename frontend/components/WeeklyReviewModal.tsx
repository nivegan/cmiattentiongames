"use client";
// WeeklyReviewModal.tsx
// The Day 7 Weekly Review popup (US 4.3): a celebratory retro modal shown on
// the home page rendering the signed-in user's weekly_summaries payload for
// the most recently completed IST week. Fires confetti when it opens.
//
// Every dismiss path (X, backdrop, CTA) calls onClose — the parent persists
// the dismissal (dismissWeeklyReview), after which the modal never re-opens
// for that week; the same stats live on as a card in /history's Weekly tab.

import { useEffect } from "react";
import { X, Trophy } from "lucide-react";
import confetti from "canvas-confetti";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import { formatWeekLabel } from "@/lib/formatWeekLabel";
import { renderBoldCopy } from "@/lib/richCopy";
import type { WeeklySummaryPayload } from "@/utils/weeklySummaryTypes";

// Look up a display label for the best game's GameMode value.
const labelForMode = (mode: string): string =>
  Object.values(GAME_CATALOG).find((g) => g.mode === mode)?.label ?? mode;

const WeeklyReviewModal = ({
  open,
  onClose,
  weekStartKey,
  weekEndKey,
  payload,
}: {
  open: boolean;
  onClose: () => void;
  weekStartKey: string;
  weekEndKey: string;
  payload: WeeklySummaryPayload;
}) => {
  // Celebration burst on open. Staggered shots from both sides read as one
  // continuous celebration; canvas-confetti draws on its own fullscreen canvas
  // so there are no z-index fights with the modal.
  useEffect(() => {
    if (!open) return;
    const shoot = (particleCount: number, origin: { x: number; y: number }) =>
      confetti({
        particleCount,
        spread: 70,
        origin,
        colors: ["#8B2626", "#00FF33", "#232323", "#F0E3E3"],
        disableForReducedMotion: true,
      });
    shoot(80, { x: 0.5, y: 0.6 });
    const timers = [
      setTimeout(() => shoot(40, { x: 0.2, y: 0.7 }), 250),
      setTimeout(() => shoot(40, { x: 0.8, y: 0.7 }), 450),
    ];
    return () => timers.forEach(clearTimeout);
  }, [open]);

  if (!open) return null;

  const gameRows = payload.total_games_played
    .split(", ")
    .filter((row) => row.length > 0);
  const bestMode = payload.best_game.game_type_id;
  const showAvgTime = payload.average_completion_time !== "0.0s";

  return (
    <div
      className="fixed inset-0 z-50 bg-[#232323]/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative bg-[#FAF6F0] border border-[#232323] shadow-[4px_4px_0px_#232323] font-mono w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#232323]/20 px-5 py-4">
          <h2 className="text-lg font-bold tracking-[0.15em] uppercase text-[#232323]">
            Weekly Review
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#232323] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Terminal-style week band */}
          <div className="bg-[#232323] text-[#00FF33] px-4 py-2 text-sm tracking-[0.15em] uppercase text-center">
            Week {formatWeekLabel(weekStartKey, weekEndKey)}
          </div>

          {/* Witty summary line (may contain **bold** spans) */}
          <p className="text-base font-bold text-[#232323] leading-snug">
            {renderBoldCopy(payload.summary_copy)}
          </p>

          {/* Games played breakdown */}
          <div>
            <p className="text-xs font-bold tracking-[0.2em] uppercase text-[#232323]/60 mb-2">
              Games Played
            </p>
            <div className="border border-[#232323]/20 divide-y divide-[#232323]/10">
              {gameRows.map((row) => {
                const [name, ratio] = row.split(" : ");
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between px-3 py-2 text-sm text-[#232323]"
                  >
                    <span>{name}</span>
                    <span className="font-bold">{ratio}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Best game */}
          {bestMode && (
            <div>
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-[#232323]/60 mb-2">
                Best Game
              </p>
              <div className="bg-[#232323] text-[#00FF33] px-4 py-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
                  <Trophy className="w-4 h-4" strokeWidth={2} />
                  {labelForMode(bestMode)}
                </span>
                {/* Not "/100" — extract_facts' interim formula can exceed 100 */}
                <span className="text-sm font-bold">
                  {payload.best_game.highest_score} PTS
                </span>
              </div>
            </div>
          )}

          {/* Avg completion time — hidden for weeks with no tracked completion_time_sec */}
          {showAvgTime && (
            <div className="flex items-center justify-between text-sm text-[#232323]">
              <span className="font-bold tracking-[0.2em] uppercase text-[#232323]/60">
                Avg Time
              </span>
              <span className="font-bold">
                {payload.average_completion_time}
              </span>
            </div>
          )}

          {/* CTA — dismisses permanently, like every other close path */}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-bold text-sm tracking-[0.15em] uppercase ring-1 ring-inset ring-[#FAF6F0]/60 shadow-[0_3px_0_#5e1919] active:translate-y-0.5 active:shadow-[0_1px_0_#5e1919] transition-all cursor-pointer"
          >
            Continue Training
          </button>
        </div>
      </div>
    </div>
  );
};

export { WeeklyReviewModal };

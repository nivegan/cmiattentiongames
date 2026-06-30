"use client";
// AboutKalariModal.tsx
// Retro modal opened from the "About Kalari" item in the Clerk UserButton
// dropdown. Static content: an intro blurb plus a one-line summary of every
// game, grouped under the same skill tiers shown on the home grid. Reads game
// metadata from lib/gameCatalog.ts so it stays in sync as games are added.

import { X } from "lucide-react";
import { GAME_CATALOG, TIERS } from "@/lib/gameCatalog";

// A short "what you do" line per game, keyed by schedule slug. The card title
// and tagline come from GAME_CATALOG; this adds the one-sentence summary.
const GAME_SUMMARIES: Record<string, string> = {
  steady_gaze:
    "Hold focus on a single fading dot and tap the instant it appears — pure sustained attention.",
  clear_air:
    "Clear the growing gray squares while leaving the red diamonds alone — filter signal from distraction.",
  extract_facts:
    "Pull the verifiable facts out of a story and answer on them — separate what's known from spin.",
  gut_check:
    "Estimate an answer, then rate how sure you are — learn to calibrate your own confidence.",
  read_designs:
    "Spot the manipulative interface in a set of designs and name the dark pattern it uses.",
  mental_reflex:
    "Tap only what matches the rule as it flips each round — override your automatic responses.",
};

const AboutKalariModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  if (!open) return null;

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
            About Kalari
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

        {/* Intro */}
        <div className="px-5 py-4 border-b border-[#232323]/15">
          <p className="text-sm text-[#232323]/80 leading-relaxed">
            Kalari is a daily training ground for the mind. Each day you face a
            short set of games — your{" "}
            <span className="text-[#8B2626] font-bold">payattu</span> — designed
            to sharpen attention, clarity, and judgment. Every game can be
            played once per day; come back tomorrow for a fresh round.
          </p>
        </div>

        {/* Per-tier game summaries */}
        <div className="px-5 py-4 space-y-5">
          {TIERS.map((tier) => {
            const games = Object.values(GAME_CATALOG).filter(
              (g) => g.tier === tier.id,
            );
            if (games.length === 0) return null;
            return (
              <div key={tier.id}>
                <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-[#8B2626] mb-2">
                  {tier.title}
                </h3>
                <div className="space-y-3">
                  {games.map((game) => (
                    <div key={game.slug}>
                      <p className="text-sm font-bold text-[#232323]">
                        {game.label}
                      </p>
                      <p className="text-sm text-[#232323]/70 leading-relaxed">
                        {GAME_SUMMARIES[game.slug] ?? game.tagline}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export { AboutKalariModal };

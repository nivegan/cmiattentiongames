"use client";
// HomeGrid.tsx
// The "Today's Payattu" home page shown after onboarding. It lists ONLY the
// games scheduled for the current IST weekday (data/dailySchedule.json), grouped
// under their fixed skill tiers (THE STANCE / THE STAFF / THE BLADE). Tiers with
// no game scheduled today are hidden.
//
// Header: title + terminal date box + GUEST MODE badge (signed-out) + a person
// icon linking to /history + the Clerk user control. Footer: DAILY PROGRESS
// showing games played today / games shown today (IST).

import { useState, useEffect } from "react";
import Link from "next/link";
import { User, LogIn } from "lucide-react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useDeviceId } from "@/hooks/useDeviceId";
import { fetchPlayedToday } from "@/app/home-actions";
import { GAME_CATALOG, TIERS } from "@/lib/gameCatalog";
import type { GameInfo } from "@/lib/gameCatalog";
import type { GameMode } from "@/utils/generate_game";
import scheduleData from "@/data/dailySchedule.json";

const schedule = scheduleData.schedule as Record<string, string[]>;

// Today's IST weekday key (e.g. "wednesday") and display date ("WEDNESDAY, JUNE 24").
const istParts = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    ...opts,
  }).format(new Date());

// A single game card. States: COMPLETED (played today) → PLAY (has route) →
// COMING SOON (no route yet, e.g. Read Between Designs).
const GameCard = ({ game, done }: { game: GameInfo; done: boolean }) => (
  <div className="bg-[#FBF8F2] border border-[#232323]/15 ring-1 ring-inset ring-[#8B2626]/10 shadow-[5px_5px_0px_rgba(35,35,35,0.12)] p-5 flex flex-col">
    <h3 className="text-lg font-bold text-[#232323] text-center tracking-wide">
      {game.label}
    </h3>
    <p className="text-sm text-[#232323]/55 text-center mt-2 mb-4 flex-1">
      {game.tagline}
    </p>

    {done ? (
      <div className="w-full py-3 bg-[#232323] text-[#00FF33] font-bold text-xs tracking-[0.15em] uppercase text-center select-none">
        Completed ✓
      </div>
    ) : game.route ? (
      <Link
        href={game.route}
        className="block w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-bold text-sm tracking-[0.15em] uppercase text-center ring-1 ring-inset ring-[#FAF6F0]/60 shadow-[0_3px_0_#5e1919] active:translate-y-0.5 active:shadow-[0_1px_0_#5e1919] transition-all"
      >
        Play
      </Link>
    ) : (
      <div className="w-full py-3 bg-[#232323]/15 text-[#232323]/45 font-bold text-xs tracking-[0.15em] uppercase text-center cursor-not-allowed select-none">
        Coming Soon
      </div>
    )}
  </div>
);

const HomeGrid = () => {
  const deviceIdRef = useDeviceId();
  const [played, setPlayed] = useState<GameMode[]>([]);

  useEffect(() => {
    // Server action (auth() resolves identity server-side); update on resolve.
    // .then keeps the setState out of the synchronous effect body.
    fetchPlayedToday(deviceIdRef.current)
      .then(setPlayed)
      .catch(() => {});
  }, [deviceIdRef]);

  const weekday = istParts({ weekday: "long" }).toLowerCase();
  const dateStr = istParts({
    weekday: "long",
    month: "long",
    day: "numeric",
  }).toUpperCase();

  const slugs = schedule[weekday] ?? [];
  const todaysGames = slugs
    .map((s) => GAME_CATALOG[s])
    .filter((g): g is GameInfo => Boolean(g));

  const playedSet = new Set(played);
  const total = todaysGames.length;
  const completed = todaysGames.filter((g) => playedSet.has(g.mode)).length;

  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono relative overflow-hidden antialiased">
      {/* Scanline overlay (retro CRT) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          backgroundImage: "linear-gradient(#232323 1px, transparent 1px)",
          backgroundSize: "100% 20px",
        }}
      />

      <div className="relative max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-[0.08em] text-[#8B2626]">
              TODAY&apos;S PAYATTU
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <span className="bg-[#232323] text-[#00FF33] text-xs sm:text-sm px-4 py-2 tracking-wide">
                {dateStr}
              </span>
              <Show when="signed-out">
                <span className="border border-[#8B2626]/40 text-[#8B2626] text-xs px-3 py-2 tracking-[0.15em] uppercase">
                  Guest Mode
                </span>
              </Show>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Person icon → History */}
            <Link
              href="/history"
              aria-label="History"
              className="w-11 h-11 flex items-center justify-center bg-[#FAF6F0] border border-[#232323]/20 shadow-[3px_3px_0px_rgba(35,35,35,0.12)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
            >
              <User className="w-5 h-5 text-[#232323]" strokeWidth={2} />
            </Link>

            {/* Clerk control (replaces the old settings gear) */}
            <Show when="signed-in">
              <div className="w-11 h-11 flex items-center justify-center">
                <UserButton />
              </div>
            </Show>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button
                  aria-label="Sign in"
                  className="w-11 h-11 flex items-center justify-center bg-[#FAF6F0] border border-[#232323]/20 shadow-[3px_3px_0px_rgba(35,35,35,0.12)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
                >
                  <LogIn className="w-5 h-5 text-[#232323]" strokeWidth={2} />
                </button>
              </SignInButton>
            </Show>
          </div>
        </header>

        {/* Tiers + cards — only today's scheduled games; empty tiers hidden */}
        {total === 0 ? (
          <p className="text-center text-[#232323]/55 mt-16 tracking-wide">
            No missions scheduled today.
          </p>
        ) : (
          TIERS.map((tier) => {
            const games = todaysGames.filter((g) => g.tier === tier.id);
            if (games.length === 0) return null;
            return (
              <section key={tier.id} className="mt-10">
                <h2 className="text-2xl font-bold text-[#8B2626] text-center tracking-widest">
                  {tier.title}
                </h2>
                <p className="text-sm text-[#232323]/55 text-center mt-1 mb-5">
                  {tier.subtitle}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {games.map((g) => (
                    <GameCard
                      key={g.slug}
                      game={g}
                      done={playedSet.has(g.mode)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}

        {/* Daily progress footer */}
        {total > 0 && (
          <div className="mt-12 bg-[#FBF8F2] border border-[#232323]/15 shadow-[5px_5px_0px_rgba(35,35,35,0.12)] px-6 py-5 flex items-center justify-between">
            <span className="font-bold tracking-widest text-[#232323]">
              DAILY PROGRESS
            </span>
            <span className="bg-[#232323] text-[#00FF33] text-sm px-3 py-1.5 tracking-wide">
              {completed}/{total} MISSIONS
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export { HomeGrid };

"use client";
// OnboardingFlow.tsx
// The one-time, 5-screen onboarding sequence shown at `/`.
//
// FLOW:
//   - On mount, check the DB (hasCompletedOnboarding). While checking, show a
//     blank cream screen so we never flash onboarding to a returning user.
//   - Not completed → run the 5 screens. Screens 1–4 advance on a tap anywhere
//     (or Enter/Space). Screen 5 has two explicit actions:
//       • BEGIN TRAINING → mark complete + reveal the home content.
//       • LOG IN TO SAVE PROGRESS → open Clerk's modal sign-in in place.
//   - Completed → render the `home` slot (passed in from app/page.tsx).
//
// The entire retro "viewfinder" frame (scanlines, corner brackets, target
// reticle, pixel palm trees, pagination, central motif) is drawn in SVG/CSS —
// no image assets.

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Show, SignInButton } from "@clerk/nextjs";
import { useDeviceId } from "@/hooks/useDeviceId";
import { hasCompletedOnboarding, completeOnboarding } from "@/app/home-actions";

// ── Screen content. A single array drives the whole flow. ────────────────────
// `motif` selects the central animated element; `lines` are the text rows.
type LineKind = "body" | "sub" | "brand" | "accent";
interface ScreenLine {
  text: string;
  kind: LineKind;
}
interface Screen {
  motif: 0 | 1 | 2 | 3 | 4;
  lines: ScreenLine[];
}

const SCREENS: Screen[] = [
  {
    motif: 0,
    lines: [{ text: "YOUR ATTENTION IS A CURRENCY.", kind: "body" }],
  },
  {
    motif: 1,
    lines: [
      {
        text: "YOU ARE SPENDING IT, WHETHER YOU CHOOSE TO OR NOT.",
        kind: "body",
      },
    ],
  },
  {
    motif: 2,
    lines: [
      { text: "WE TRAIN TO RECLAIM IT.", kind: "body" },
      { text: "NOT AS A DEFENSE, BUT AS A MARTIAL ART.", kind: "sub" },
    ],
  },
  {
    motif: 3,
    lines: [
      { text: "KALARI", kind: "brand" },
      { text: "PROTEST THE ATTENTION ECONOMY", kind: "accent" },
      {
        text: "A DAILY PRACTICE IN THE ART OF FOCUS, LOGIC, AND CLARITY.",
        kind: "sub",
      },
    ],
  },
  { motif: 4, lines: [{ text: "YOUR TRAINING BEGINS NOW.", kind: "body" }] },
];

const LINE_CLASS: Record<LineKind, string> = {
  body: "text-sm sm:text-base font-medium tracking-[0.15em] text-[#232323]",
  sub: "text-[11px] sm:text-xs tracking-[0.15em] text-[#232323]/50 mt-3",
  brand: "text-3xl font-bold tracking-[0.2em] text-[#8B2626]",
  accent: "text-sm tracking-[0.2em] text-[#8B2626] mt-4",
};

// ── Pixel-art palm tree (SVG). Drawn from a small char grid; '.' = empty,
// 'g' = frond (green), 't' = trunk (brown). Mirrored for the right side. ──────
const PALM_GRID = [
  "....ggg......",
  "...ggggg.....",
  ".ggggggggg...",
  "ggg.ggg.ggg.g",
  "g...gggg...g.",
  "....ggg......",
  "....gtg......",
  "....tt.......",
  "....tt.......",
  "....tt.......",
  "...tt........",
  "...tt........",
  "...tt........",
  "..tt.........",
  "..tt.........",
  "..tt.........",
  ".tt..........",
  ".tt..........",
];
const PALM_COLORS: Record<string, string> = { g: "#5F7D3A", t: "#6F4A2F" };

const PalmTree = ({ flip }: { flip?: boolean }) => {
  const cell = 5;
  const cols = PALM_GRID[0].length;
  const rows = PALM_GRID.length;
  return (
    <svg
      width={cols * cell}
      height={rows * cell}
      viewBox={`0 0 ${cols * cell} ${rows * cell}`}
      className="pointer-events-none"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden
    >
      {PALM_GRID.flatMap((row, y) =>
        row
          .split("")
          .map((ch, x) =>
            ch === "." ? null : (
              <rect
                key={`${x}-${y}`}
                x={x * cell}
                y={y * cell}
                width={cell}
                height={cell}
                fill={PALM_COLORS[ch]}
              />
            ),
          ),
      )}
    </svg>
  );
};

// ── Target reticle (top-right): concentric maroon circles + centre dot. ──────
const Reticle = () => (
  <svg
    width="44"
    height="44"
    viewBox="0 0 48 48"
    className="text-[#8B2626] pointer-events-none"
    aria-hidden
  >
    <circle
      cx="24"
      cy="24"
      r="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.4"
    />
    <circle
      cx="24"
      cy="24"
      r="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.65"
    />
    <circle
      cx="24"
      cy="24"
      r="6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    />
    <circle cx="24" cy="24" r="1.5" fill="currentColor" />
  </svg>
);

// ── Central evolving motif, one per screen. Subtle CSS animation layered on. ─
const Motif = ({ motif }: { motif: Screen["motif"] }) => {
  if (motif === 0) {
    return <div className="w-4 h-4 rounded-full bg-[#232323] animate-pulse" />;
  }
  if (motif === 1) {
    // Dark dot with a thin "clock hand" sweeping slowly around it.
    return (
      <div className="relative flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-[#232323] z-10" />
        <div
          className="absolute w-12 h-12 animate-spin"
          style={{ animationDuration: "14s" }}
        >
          <div className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-[#232323]/50" />
        </div>
      </div>
    );
  }
  if (motif === 2) {
    // Dark dot inside a thin maroon ring, softly breathing.
    return (
      <div className="relative flex items-center justify-center">
        <div className="w-3.5 h-3.5 rounded-full bg-[#232323]" />
        <div className="absolute w-12 h-12 rounded-full border border-[#8B2626] animate-pulse" />
      </div>
    );
  }
  // motif 3 & 4 — the maroon "eye" (donut with a cream centre).
  return (
    <div className="w-14 h-14 rounded-full bg-[#8B2626] flex items-center justify-center animate-pulse">
      <div className="w-4 h-4 rounded-full bg-[#FAF6F0]" />
    </div>
  );
};

// ── Pagination: 5 squares, current filled maroon. ────────────────────────────
const Pagination = ({ active }: { active: number }) => (
  <div className="flex items-center gap-2">
    {SCREENS.map((_, i) => (
      <div
        key={i}
        className={
          i === active
            ? "w-2.5 h-2.5 bg-[#8B2626]"
            : "w-2.5 h-2.5 border border-[#8B2626]/40"
        }
      />
    ))}
  </div>
);

interface OnboardingFlowProps {
  // Rendered once onboarding is complete (the existing home content).
  home: ReactNode;
}

type Status = "checking" | "onboarding" | "done";

const OnboardingFlow = ({ home }: OnboardingFlowProps) => {
  const deviceIdRef = useDeviceId();
  const [status, setStatus] = useState<Status>("checking");
  const [step, setStep] = useState(0);

  useEffect(() => {
    // useDeviceId's effect runs before this one, so deviceIdRef.current is set.
    const check = async () => {
      const completed = await hasCompletedOnboarding(deviceIdRef.current);
      setStatus(completed ? "done" : "onboarding");
    };
    check();
  }, [deviceIdRef]);

  const isLast = step === SCREENS.length - 1;

  // Screens 1–4 advance on any tap / Enter / Space; screen 5 uses its buttons.
  const advance = () => {
    if (!isLast) setStep((s) => s + 1);
  };

  const handleBegin = () => {
    // Persist completion (fire-and-forget — the action swallows its own errors),
    // then reveal the home content immediately.
    void completeOnboarding(deviceIdRef.current);
    setStatus("done");
  };

  if (status === "checking") {
    // Blank cream screen — avoids flashing onboarding to returning users.
    return <div className="min-h-screen bg-[#FAF6F0]" />;
  }

  if (status === "done") {
    return <>{home}</>;
  }

  const screen = SCREENS[step];

  return (
    <div
      onClick={!isLast ? advance : undefined}
      onKeyDown={
        !isLast
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") advance();
            }
          : undefined
      }
      role={!isLast ? "button" : undefined}
      tabIndex={!isLast ? 0 : undefined}
      className={`min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex justify-center relative overflow-hidden antialiased select-none ${
        !isLast ? "cursor-pointer" : ""
      }`}
    >
      {/* Scanline overlay (retro CRT) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage: "linear-gradient(#232323 1px, transparent 1px)",
          backgroundSize: "100% 20px",
        }}
      />

      {/* Narrow portrait column holding the frame + content */}
      <div className="relative w-full max-w-md min-h-screen flex flex-col">
        {/* Corner brackets */}
        <div className="absolute top-4 left-4 w-5 h-5 border-t-2 border-l-2 border-[#8B2626]/30" />
        <div className="absolute bottom-4 left-4 w-5 h-5 border-b-2 border-l-2 border-[#8B2626]/30" />
        <div className="absolute bottom-4 right-4 w-5 h-5 border-b-2 border-r-2 border-[#8B2626]/30" />
        {/* Target reticle (top-right) */}
        <div className="absolute top-3 right-3">
          <Reticle />
        </div>

        {/* Palm trees (bottom corners) */}
        <div className="absolute bottom-3 left-3">
          <PalmTree />
        </div>
        <div className="absolute bottom-3 right-3">
          <PalmTree flip />
        </div>

        {/* Content: motif (upper area) + text (lower area), fading in per screen */}
        <div
          key={step}
          className="flex-1 flex flex-col animate-in fade-in duration-500"
        >
          <div className="flex-1 flex items-center justify-center">
            <Motif motif={screen.motif} />
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-10 text-center">
            {screen.lines.map((line, i) => (
              <p key={i} className={`${LINE_CLASS[line.kind]} leading-relaxed`}>
                {line.text}
              </p>
            ))}

            {isLast && (
              <div className="mt-10 w-full flex flex-col items-center">
                <button
                  onClick={handleBegin}
                  className="w-full max-w-xs px-8 py-4 bg-[#8B2626] text-[#FAF6F0] font-bold text-sm tracking-[0.2em] uppercase ring-1 ring-inset ring-[#FAF6F0]/70 shadow-[0_4px_0_#5e1919] active:translate-y-0.5 active:shadow-[0_2px_0_#5e1919] transition-all cursor-pointer"
                >
                  BEGIN TRAINING
                </button>
                {/* Only offer sign-in to signed-out users — opening the Clerk
                    modal while already signed in errors in single-session mode. */}
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <button className="mt-6 text-[11px] tracking-[0.15em] text-[#232323]/50 hover:text-[#232323]/80 transition-colors cursor-pointer uppercase">
                      Log in to save progress →
                    </button>
                  </SignInButton>
                </Show>
              </div>
            )}
          </div>
        </div>

        {/* Pagination (bottom-centre, above the palms) */}
        <div className="absolute bottom-7 left-1/2 -translate-x-1/2">
          <Pagination active={step} />
        </div>
      </div>
    </div>
  );
};

export { OnboardingFlow };

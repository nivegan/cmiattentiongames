"use client";
// read_designs/page.tsx
// The Read Between Designs game — a dark-pattern detection exercise:
//   1. INTRO   → briefing + BEGIN ANALYSIS (starts the timer)
//   2. PHASE1  → 2×2 grid of TEXT/UI/AD/GRAPH tiles; tap the one that is a
//                deceptive dark pattern (vector_mcq)
//   3. PHASE2  → name the manipulation technique used (manipulation_mcq)
//   4. RESULTS → detection metrics, explanation, final score
//
// Both phases are retry-until-correct: a wrong tap increments that phase's wrong
// counter (patternWrong / techniqueWrong) and fires a "wrong" toast; only the
// correct tap advances (with a "correct" toast). The RESULTS screen reports the
// try each phase was solved on (wrong taps + 1).
//
// SCORING:
//   elapsedSeconds = (PHASE2 correct answer − BEGIN ANALYSIS) / 1000
//   Score = Max(0, round( 100 * 0.7^(patternWrong + techniqueWrong) − Max(0, elapsedSeconds − 8) * 2 ))

import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import { fetchServerGameData } from "./actions";
import { saveUserGameStat } from "@/utils/saveUserGameStat";
import { logFunnelEvent } from "@/utils/logFunnelEvent";
import type { DarkDesignData } from "@/utils/generate_dark_design";
import { useRouter } from "next/navigation";
import { useDeviceId } from "@/hooks/useDeviceId";
import { GameShell } from "@/components/GameShell";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { GameErrorScreen } from "@/components/GameErrorScreen";

// All possible game phases — drives which section of the UI is displayed.
type AppPhase = "INTRO" | "PHASE1" | "PHASE2" | "RESULTS";

// The four fixed Phase-1 tiles. Icon + label are constant per quadrant; only the
// body text varies (from vector_mcq.options). Render order is fixed here and
// matches the correct_vector_index produced by the generator.
const VECTORS = [
  { key: "text", label: "TEXT", icon: "📄" },
  { key: "ui", label: "UI", icon: "🖥️" },
  { key: "ad", label: "AD", icon: "📢" },
  { key: "graph", label: "GRAPH", icon: "📊" },
] as const;

type VectorKey = (typeof VECTORS)[number]["key"];

// English ordinal ("1st", "2nd", "3rd", "4th", "11th", "21st"). Handles the
// 11–13 teens exception, since a phase can take many wrong taps before the
// correct one.
const ordinal = (n: number): string => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

const ReadDesignsPage = () => {
  const router = useRouter();

  // AI-generated game content (the two MCQs + explanation).
  const [gameData, setGameData] = useState<DarkDesignData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmittingDb, setIsSubmittingDb] = useState<boolean>(false);

  // Anonymous device ID from localStorage (identity for non-signed-in users).
  const deviceIdRef = useDeviceId();

  const [phase, setPhase] = useState<AppPhase>("INTRO");

  // Wrong taps per phase. Their sum drives the 0.7^n score decay; individually
  // they give each phase's "solved on the Nth try" (wrong taps + 1) for RESULTS.
  const [patternWrong, setPatternWrong] = useState<number>(0);
  const [techniqueWrong, setTechniqueWrong] = useState<number>(0);
  // Seconds of play time, ticked by a useEffect interval while PHASE1/PHASE2 are
  // active. Counting via an effect (rather than Date.now() in a handler) keeps
  // impure clock access out of the render path — the react-hooks/purity rule
  // forbids Date.now() feeding state. Frozen once RESULTS is reached.
  const [playSeconds, setPlaySeconds] = useState<number>(0);

  // Guards against extra taps during the brief PHASE1→PHASE2 transition delay.
  const transitioningRef = useRef<boolean>(false);

  // Tick play-seconds once per second while a play phase is active. Cleaned up
  // (and frozen) when leaving PHASE1/PHASE2 — so playSeconds holds the total
  // play time once RESULTS renders. playSeconds persists across the PHASE1→PHASE2
  // effect re-run; only the interval is recreated.
  useEffect(() => {
    if (phase !== "PHASE1" && phase !== "PHASE2") return;
    const id = setInterval(() => setPlaySeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Load game data once on mount. Checks daily lock, returns cached or fresh data.
  useEffect(() => {
    const loadGame = async () => {
      setIsLoading(true);
      try {
        const response = await fetchServerGameData(deviceIdRef.current);
        if (!response.success && response.error === "ALREADY_PLAYED") {
          router.push("/"); // already played today — redirect home
          return;
        }
        if (response.data) {
          setGameData(response.data);
        }
        // setIsLoading(false) AFTER setGameData so there is no intermediate render
        // where isLoading=false and gameData=null (which would flash the error screen).
        setIsLoading(false);
      } catch {
        // Network / server error: gameData stays null → <GameErrorScreen> renders.
        setIsLoading(false);
      }
    };
    loadGame();
  }, [deviceIdRef, router]);

  // INTERIM SCORING: exponential decay per wrong tap, minus a time penalty
  // beyond an 8-second grace window. Bounded to 0 (and naturally to 100).
  const finalScore = Math.max(
    0,
    Math.round(
      100 * Math.pow(0.7, patternWrong + techniqueWrong) -
        Math.max(0, playSeconds - 8) * 2,
    ),
  );

  // Detection skill tier shown on the RESULTS screen (display only).
  const skillTier =
    finalScore >= 80 ? "EXPERT" : finalScore >= 50 ? "SKILLED" : "NOVICE";

  const handleBackToHome = () => {
    router.push("/");
  };

  // INTRO → PHASE1: fire GAME_START. The play-seconds timer starts via the
  // useEffect above once the phase becomes PHASE1.
  const handleBeginAnalysis = () => {
    logFunnelEvent("GAME_START", deviceIdRef.current, "READ_BETWEEN_DESIGNS");
    setPhase("PHASE1");
  };

  // PHASE1 tile tap. Correct vector → success toast + auto-advance; wrong → penalty.
  const handleVectorTap = (vectorKey: VectorKey) => {
    if (!gameData || transitioningRef.current) return;
    logFunnelEvent("GAME_CLICK", deviceIdRef.current, "READ_BETWEEN_DESIGNS");

    if (vectorKey === gameData.vector_mcq.correct_vector) {
      transitioningRef.current = true;
      toast.success("Correct — that's the dark pattern.");
      // Brief delay so the success toast registers before the phase swaps.
      setTimeout(() => {
        setPhase("PHASE2");
        transitioningRef.current = false;
      }, 700);
    } else {
      setPatternWrong((n) => n + 1);
      toast.error("Not quite — look again.");
    }
  };

  // PHASE2 option tap. Correct technique → stop timer + go to RESULTS; wrong → penalty.
  const handleManipulationTap = (optionIndex: number) => {
    if (!gameData) return;
    logFunnelEvent("GAME_CLICK", deviceIdRef.current, "READ_BETWEEN_DESIGNS");

    if (optionIndex === gameData.manipulation_mcq.correct_manipulation_index) {
      toast.success("Correct technique identified.");
      // playSeconds already holds total play time; the tick effect stops on RESULTS.
      setPhase("RESULTS");
    } else {
      setTechniqueWrong((n) => n + 1);
      toast.error("Wrong technique — try again.");
    }
  };

  // RESULTS → save the score, then return home.
  const handleContinue = async () => {
    setIsSubmittingDb(true);
    try {
      const dbTransaction = await saveUserGameStat(
        finalScore,
        deviceIdRef.current,
        "READ_BETWEEN_DESIGNS",
        "web_read_designs_v1",
      );
      if (dbTransaction.success) {
        logFunnelEvent(
          "GAME_COMPLETE",
          deviceIdRef.current,
          "READ_BETWEEN_DESIGNS",
        );
        router.push("/");
      } else if (dbTransaction.error === "ALREADY_PLAYED") {
        router.push("/");
      } else {
        alert(
          "Metrics Sync Interrupted. Database tracking records could not verify save.",
        );
      }
    } catch {
      alert(
        "Metrics Sync Interrupted. Database tracking records could not verify save.",
      );
    } finally {
      setIsSubmittingDb(false);
    }
  };

  if (isLoading) return <GameLoadingScreen />;
  if (!gameData) return <GameErrorScreen />;

  const { vector_mcq, manipulation_mcq, short_explanation } = gameData;

  // The Phase-1 manipulative tile, recapped at the top of PHASE2.
  const correctVector =
    VECTORS.find((v) => v.key === vector_mcq.correct_vector) ?? VECTORS[0];

  // Header title varies per phase.
  const headerTitle =
    phase === "INTRO"
      ? "READ BETWEEN DESIGNS"
      : phase === "PHASE1"
        ? "PHASE 1: SPOT THE TRICK"
        : phase === "PHASE2"
          ? "PHASE 2: NAME TECHNIQUE"
          : "ANALYSIS COMPLETE";

  return (
    <GameShell title={headerTitle} onBack={handleBackToHome}>
      <Toaster position="top-center" richColors />

      {/* min-h-0 lets the flex child actually overflow-scroll; paddingBottom clears
          the absolute footer button on small screens (same pattern as extract_facts). */}
      <main
        className="flex-1 overflow-y-auto px-6 py-6 scroll-smooth min-h-0"
        style={{ paddingBottom: "100px" }}
      >
        {phase === "INTRO" && (
          <div className="max-w-md mx-auto space-y-6 pt-2">
            <h2 className="text-center font-black tracking-[0.2em] text-base text-[#8B2626] uppercase">
              Read Between Designs
            </h2>

            <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-5 shadow-[4px_4px_0px_rgba(217,205,179,0.6)] rounded-sm space-y-4">
              <p className="text-[13px] leading-relaxed text-[#3A221D]">
                Detect dark patterns and visual manipulation in modern media.
              </p>
              <div className="space-y-1.5 text-[12px] leading-relaxed text-[#5C4540]">
                <p>
                  <span className="font-bold text-[#8B2626]">PHASE 1:</span>{" "}
                  Find the manipulative design
                </p>
                <p>
                  <span className="font-bold text-[#8B2626]">PHASE 2:</span>{" "}
                  Name the technique used
                </p>
              </div>
            </div>
          </div>
        )}

        {phase === "PHASE1" && (
          <div className="max-w-md mx-auto space-y-5">
            <p className="text-center text-[12px] leading-relaxed text-[#5C4540]">
              One of these tiles is designed to persuade or mislead. Find it.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {VECTORS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => handleVectorTap(v.key)}
                  className="text-left bg-[#FAF8F5] border border-[#D9CDB3] p-3.5 shadow-[4px_4px_0px_rgba(217,205,179,0.6)] rounded-sm hover:border-[#B5A88F] active:translate-x-px active:translate-y-px active:shadow-[2px_2px_0px_rgba(217,205,179,0.6)] transition-all flex flex-col"
                >
                  <span className="text-2xl text-center block mb-1">
                    {v.icon}
                  </span>
                  <span className="text-center text-[10px] font-bold tracking-widest text-[#8B2626] uppercase block mb-2">
                    {v.label}
                  </span>
                  <span className="text-[12px] leading-snug text-[#5C4540]">
                    {vector_mcq.options[v.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "PHASE2" && (
          <div className="max-w-md mx-auto space-y-5">
            <p className="text-center text-[12px] leading-relaxed text-[#5C4540]">
              What manipulation technique is being used?
            </p>

            {/* Recap of the Phase-1 manipulative tile */}
            <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.6)] rounded-sm">
              <div className="text-center mb-2">
                <span className="text-2xl block">{correctVector.icon}</span>
                <span className="text-[10px] font-bold tracking-widest text-[#8B2626] uppercase">
                  MANIPULATIVE {correctVector.label}
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-[#5C4540]">
                {vector_mcq.options[vector_mcq.correct_vector as VectorKey]}
              </p>
            </div>

            <div className="space-y-3">
              {manipulation_mcq.options.map((option, optIdx) => (
                <button
                  key={optIdx}
                  onClick={() => handleManipulationTap(optIdx)}
                  className="w-full text-left bg-[#FAF8F5] border border-[#D9CDB3] p-3.5 shadow-[3px_3px_0px_rgba(217,205,179,0.5)] rounded-sm flex items-start gap-3 hover:border-[#B5A88F] active:translate-x-px active:translate-y-px active:shadow-[1px_1px_0px_rgba(217,205,179,0.5)] transition-all"
                >
                  <div className="w-5 h-5 border border-[#7C6560] bg-white text-[#7C6560] shrink-0 mt-0.5 flex items-center justify-center rounded-sm text-[10px] font-black">
                    {/* charCode 65 = 'A'; yields A/B/C/D for option indices 0–3 */}
                    {String.fromCharCode(65 + optIdx)}
                  </div>
                  <span className="text-[13px] leading-tight text-[#5C4540]">
                    {option}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "RESULTS" && (
          <div className="max-w-md mx-auto space-y-4">
            <div className="border-4 border-double border-[#D9CDB3] bg-[#FAF8F5] p-5 shadow-[6px_6px_0px_rgba(217,205,179,0.5)] rounded-sm space-y-4">
              <div className="bg-[#232323] py-2.5 rounded-sm text-center border border-[#2D3B31]">
                <span className="text-[#00FF33] font-extrabold text-xs tracking-widest block animate-pulse">
                  DETECTION METRICS
                </span>
              </div>

              {/* Final score + bar */}
              <div className="space-y-1 bg-[#FAF8F5] border border-[#D9CDB3] p-3 rounded-sm">
                <div className="flex justify-between items-center font-bold text-xs">
                  <span>FINAL SCORE:</span>
                  <span className="text-[#8B2626]">{finalScore}/100</span>
                </div>
                <div className="h-2.5 bg-[#232323] rounded-sm p-px border border-[#1A1514]">
                  <div
                    className="h-full bg-[#00FF33] rounded-xs transition-all duration-500"
                    style={{ width: `${finalScore}%` }}
                  />
                </div>
              </div>

              {/* Both phases were passed (you can't reach RESULTS otherwise); each
                  line reports the try it was solved on (wrong taps + 1). */}
              <div className="flex justify-between items-center bg-[#FAF8F5] border border-[#D9CDB3] p-2.5 rounded-sm text-xs font-bold">
                <span>PATTERN IDENTIFIED:</span>
                <span className="text-[#22C55E]">
                  ✓ {ordinal(patternWrong + 1).toUpperCase()} TRY
                </span>
              </div>
              <div className="flex justify-between items-center bg-[#FAF8F5] border border-[#D9CDB3] p-2.5 rounded-sm text-xs font-bold">
                <span>TECHNIQUE NAMED:</span>
                <span className="text-[#22C55E]">
                  ✓ {ordinal(techniqueWrong + 1).toUpperCase()} TRY
                </span>
              </div>

              {/* Explanation: bold technique name + short_explanation */}
              <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 rounded-sm space-y-2">
                <span className="text-[11px] font-bold text-[#8B2626] tracking-wider block uppercase">
                  Technique Explanation:
                </span>
                <p className="text-[12px] leading-relaxed text-[#5C4540]">
                  <span className="font-bold text-[#3A221D]">
                    {manipulation_mcq.correct_manipulation_name}:
                  </span>{" "}
                  {short_explanation}
                </p>
              </div>

              <div className="flex justify-between items-center bg-[#FAF8F5] border border-[#D9CDB3] p-2.5 rounded-sm text-xs font-bold">
                <span>DETECTION SKILL:</span>
                <span className="text-[#8B2626]">⚡ {skillTier}</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer button only on INTRO (BEGIN ANALYSIS) and RESULTS (CONTINUE).
          PHASE1/PHASE2 advance on the correct tap, so they have no footer button. */}
      {(phase === "INTRO" || phase === "RESULTS") && (
        <footer className="absolute bottom-0 inset-x-0 bg-linear-to-t from-[#FAF6F0] via-[#FAF6F0] to-[#FAF6F0]/0 px-6 pb-6 pt-8 z-20 flex justify-center">
          {phase === "INTRO" && (
            <button
              onClick={handleBeginAnalysis}
              className="w-full max-w-md py-3.5 bg-[#8B2626] text-white font-extrabold text-xs tracking-widest uppercase rounded-sm shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75 transition-all"
            >
              Begin Analysis
            </button>
          )}

          {phase === "RESULTS" && (
            <button
              disabled={isSubmittingDb}
              onClick={handleContinue}
              className="w-full max-w-md py-3.5 bg-[#8B2626] text-white font-extrabold text-xs tracking-widest uppercase rounded-sm shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75 transition-all flex items-center justify-center gap-2"
            >
              {isSubmittingDb ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Syncing Records...</span>
                </>
              ) : (
                <span>Continue</span>
              )}
            </button>
          )}
        </footer>
      )}
    </GameShell>
  );
};

export default ReadDesignsPage;

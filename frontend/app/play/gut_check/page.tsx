"use client";
// gut_check/page.tsx
// The Gut Check game page — a multi-round calibration game where players:
//   1. Read an anchor statement (yes/no numeric claim)
//   2. Answer the real question (guess an exact number)
//   3. Rate their own confidence in that answer (0–100%)
// At the end, the game scores how well their confidence *matched* their actual accuracy.
//
// GAME PHASES (AppPhase):
//   WELCOME         → intro screen with theme info
//   ANCHOR          → yes/no baseline claim for the current round
//   REAL_QUESTION   → numeric input for the real question
//   CONFIDENCE_CHECK → slider: how confident are you?
//   METRICS         → dashboard showing calibration scores before saving
//   RESULTS         → final breakdown with correct answers revealed
//
// SCORING:
//   Accuracy%     = Max(0, Min(100, round((1 − |true−guess| / |true|) × 100)))
//   Calibration   = Max(0, 100 − |Accuracy% − Confidence%|)   ← rewards alignment
//   Round score   = Accuracy% × 0.5 + Calibration × 0.5
//   Overall score = average of all round scores

import { useState, useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { fetchServerGameData } from "./actions";
import { saveUserGameStat } from "@/utils/saveUserGameStat";
import { logFunnelEvent } from "@/utils/logFunnelEvent";
import type { GutCheckData } from "@/utils/generate_gut_check";
import { useRouter } from "next/navigation";
import { useDeviceId } from "@/hooks/useDeviceId";
import { GameShell } from "@/components/GameShell";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { GameErrorScreen } from "@/components/GameErrorScreen";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// All the possible game phases — drives which UI section is shown
type AppPhase =
  | "WELCOME"
  | "ANCHOR"
  | "REAL_QUESTION"
  | "CONFIDENCE_CHECK"
  | "METRICS"
  | "RESULTS";

// Stores the player's responses for a single round (all three steps)
interface RoundResponse {
  anchorGuess: boolean; // did they think the anchor statement was true?
  realGuess: number; // their numeric answer to the real question
  confidence: number; // their self-rated confidence (0–100)
}

// The computed breakdown for a single round, used in the METRICS and RESULTS phases
interface CalibrationItemBreakdown {
  roundNum: number;
  confidence: number;
  accuracy: number; // how close their guess was to the actual value (0–100)
  score: number; // final round score combining accuracy + calibration
  questionText: string;
  unit: string;
  guess: number; // what they entered
  actual: number; // the real answer from the AI-generated game data
}

// Summary stats computed from all rounds
interface PerformanceMetrics {
  overallScore: number;
  avgConfidence: number;
  avgAccuracy: number;
  breakdowns: CalibrationItemBreakdown[]; // one entry per round
}

const GutCheckPage = () => {
  const router = useRouter(); // for programmatic navigation (redirect to home)

  // AI-generated game content from the server (questions, theme, answers)
  const [gameData, setGameData] = useState<GutCheckData | null>(null);
  // true while the server action is fetching game data
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // true while the score is being saved to the DB (prevents double-submit)
  const [isSubmittingDb, setIsSubmittingDb] = useState<boolean>(false);

  // Anonymous device ID from localStorage (used as identity if not signed in)
  const deviceIdRef = useDeviceId();

  // Which screen is currently shown
  const [phase, setPhase] = useState<AppPhase>("WELCOME");
  // Which question (0-indexed) the player is currently on
  const [currentRoundIndex, setCurrentRoundIndex] = useState<number>(0);
  // Dictionary mapping round index → partial response for that round.
  // Partial<> means not all fields are required — they're filled in one by one
  // as the player moves through ANCHOR → REAL_QUESTION → CONFIDENCE_CHECK.
  const [roundResponses, setRoundResponses] = useState<
    Record<number, Partial<RoundResponse>>
  >({});

  // Controlled input value for the numeric answer field
  const [numericInput, setNumericInput] = useState<string>("");
  // Controlled value for the confidence slider (0–100, defaults to 50)
  const [confidenceInput, setConfidenceInput] = useState<number>(50);

  // Ref to the scrollable main content area — used to scroll to top on phase change
  const containerScrollRef = useRef<HTMLDivElement>(null);

  // Wall-clock timestamps for completion_time_sec: start-button tap → last
  // confidence submit. Refs (not state) — read only at save time, no re-renders.
  const startedAtRef = useRef<number | null>(null);
  const endedAtRef = useRef<number | null>(null);

  // Load game data once on mount. Checks the daily lock and fetches (or returns
  // cached) AI-generated questions. Redirects home if already played today.
  useEffect(() => {
    const loadGame = async () => {
      setIsLoading(true);
      try {
        const response = await fetchServerGameData(deviceIdRef.current);
        if (!response.success) {
          if (response.error === "ALREADY_PLAYED") {
            router.push("/"); // already played today — send home
            return;
          }
        }
        if (response.data) {
          setGameData(response.data);
        }
        setIsLoading(false);
      } catch {
        // On unexpected error, stop loading so the error state can be shown
        setIsLoading(false);
      }
    };
    loadGame();
  }, [deviceIdRef, router]); // deviceIdRef is a stable ref, so this only runs once

  // Scroll back to the top of the card whenever the phase or round changes,
  // so the user never lands mid-page when a new question appears.
  useEffect(() => {
    if (containerScrollRef.current) {
      containerScrollRef.current.scrollTop = 0;
    }
  }, [phase, currentRoundIndex]);

  const handleBackToHome = () => {
    router.push("/");
  };

  // Total number of rounds in this session (from the AI-generated data, usually 3)
  const totalRounds = gameData?.questions?.length ?? 3;
  // The currently active question object (switches as currentRoundIndex advances)
  const activeQuestion = gameData?.questions?.[currentRoundIndex];

  // Merges partial fields into the current round's response record without
  // overwriting already-saved fields. Called once per phase:
  //   ANCHOR phase       → saves anchorGuess
  //   REAL_QUESTION phase → saves realGuess
  //   CONFIDENCE_CHECK   → saves confidence
  const saveCurrentRoundSlice = (updatedFields: Partial<RoundResponse>) => {
    setRoundResponses((prev) => ({
      ...prev,
      // Spread existing fields for this round, then overwrite with new fields
      [currentRoundIndex]: { ...prev[currentRoundIndex], ...updatedFields },
    }));
  };

  // Computes performance metrics for all rounds. Wrapped in useMemo so it only
  // recalculates when the player's responses (or game data) actually change —
  // not on every render. This is important because it runs inside the render
  // and could be slow if called unnecessarily.
  //
  // SCORING FORMULA:
  //   Accuracy% = Max(0, Min(100, round((1 − |true−guess| / |true|) × 100)))
  //     → how close was the guess? 100 = exact, 0 = wildly off
  //   Calibration = Max(0, 100 − |Accuracy% − Confidence%|)
  //     → how well did confidence match accuracy? 100 = perfectly aligned
  //   Round score = Accuracy% × 0.5 + Calibration × 0.5
  //   Overall = average of all round scores
  const calculatedPerformanceMetrics = useMemo<PerformanceMetrics>(() => {
    if (!gameData || !gameData.questions) {
      return {
        overallScore: 0,
        avgConfidence: 0,
        avgAccuracy: 0,
        breakdowns: [],
      };
    }

    let accumulatedConfidence = 0;
    let accumulatedAccuracy = 0;
    const itemsList: CalibrationItemBreakdown[] = [];

    gameData.questions.forEach((q, idx) => {
      const recorded = roundResponses[idx];
      const guessVal = recorded?.realGuess ?? 0;
      const trueVal = q.the_real_number;
      const confVal = recorded?.confidence ?? 50;

      accumulatedConfidence += confVal;

      let calculatedAcc = 0;
      if (recorded?.realGuess === undefined) {
        // Question not answered — no accuracy awarded regardless of trueVal.
        calculatedAcc = 0;
      } else if (trueVal === guessVal) {
        calculatedAcc = 100;
      } else if (trueVal === 0) {
        // trueVal is 0 but guessVal is not — division would be Infinity.
        calculatedAcc = 0;
      } else {
        const errorRatio = Math.abs(trueVal - guessVal) / Math.abs(trueVal);
        calculatedAcc = Math.max(
          0,
          Math.min(100, Math.round((1 - errorRatio) * 100)),
        );
      }
      accumulatedAccuracy += calculatedAcc;

      // Calibration score: 100 when confidence perfectly matches accuracy,
      // falling linearly to 0 when they are 100 points apart.
      const calibration = Math.max(0, 100 - Math.abs(calculatedAcc - confVal));
      const roundCalibrationScore = Math.round(
        calculatedAcc * 0.5 + calibration * 0.5,
      );

      itemsList.push({
        roundNum: idx + 1,
        confidence: confVal,
        accuracy: calculatedAcc,
        score: roundCalibrationScore,
        questionText: q.the_real_question,
        unit: q.unit,
        guess: guessVal,
        actual: trueVal,
      });
    });

    const roundCount = itemsList.length;
    if (roundCount === 0) {
      return {
        overallScore: 0,
        avgConfidence: 0,
        avgAccuracy: 0,
        breakdowns: [],
      };
    }
    const averageConfidence = Math.round(accumulatedConfidence / roundCount);
    const averageAccuracy = Math.round(accumulatedAccuracy / roundCount);
    const finalComputedOverallScore = Math.round(
      itemsList.reduce((sum, item) => sum + item.score, 0) / roundCount,
    );

    return {
      overallScore: finalComputedOverallScore,
      avgConfidence: averageConfidence,
      avgAccuracy: averageAccuracy,
      breakdowns: itemsList,
    };
  }, [gameData, roundResponses]);

  // Called when the player clicks "VIEW ANSWERS" on the METRICS screen.
  // Saves the overall score to the DB, then transitions to RESULTS.
  // setIsSubmittingDb(true) disables the button to prevent double-clicking.
  const handleProcessAndSyncScores = async () => {
    setIsSubmittingDb(true);
    try {
      const { overallScore, avgConfidence, avgAccuracy, breakdowns } =
        calculatedPerformanceMetrics;
      const completionTimeSec =
        startedAtRef.current !== null && endedAtRef.current !== null
          ? Math.round((endedAtRef.current - startedAtRef.current) / 1000)
          : 0;
      const connectionResult = await saveUserGameStat({
        score: overallScore,
        deviceId: deviceIdRef.current,
        mode: "GUT_CHECK",
        source: "web_gut_check_v1",
        completionTimeSec,
        details: { avgConfidence, avgAccuracy, breakdowns },
      });
      if (connectionResult.success) {
        logFunnelEvent("GAME_COMPLETE", deviceIdRef.current, "GUT_CHECK");
        setPhase("RESULTS");
      } else if (connectionResult.error === "ALREADY_PLAYED") {
        router.push("/");
      } else {
        alert(
          "Metrics Sync Interrupted. Database tracking records could not verify save operations.",
        );
      }
    } catch {
      alert(
        "Metrics Sync Interrupted. Database tracking records could not verify save operations.",
      );
    } finally {
      setIsSubmittingDb(false);
    }
  };

  // Still waiting for the server to return game data → show loading spinner
  if (isLoading) return <GameLoadingScreen />;
  // Game data arrived but is missing or empty → show error screen
  if (!gameData || !gameData.questions || gameData.questions.length === 0)
    return <GameErrorScreen />;

  return (
    <GameShell
      title="GUT CHECK"
      onBack={handleBackToHome}
      badge={
        phase !== "WELCOME" && phase !== "METRICS" && phase !== "RESULTS" ? (
          <Badge className="rounded-none h-auto bg-[#232323] text-[#00FF33] font-bold text-[10px] px-2 py-1 border border-[#232323] tracking-widest">
            ROUND {currentRoundIndex + 1}/{totalRounds}
          </Badge>
        ) : undefined
      }
    >
      <main
        ref={containerScrollRef}
        className="flex-1 overflow-y-auto px-6 py-4 flex flex-col justify-center min-h-0 pb-24 scroll-smooth"
      >
        {/* WELCOME PHASE */}
        {phase === "WELCOME" && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="bg-[#FAF6F0] border border-[#232323] p-5 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0]">
              <p className="text-xs leading-relaxed text-[#232323] font-medium mb-5">
                Train your metacognition – how well do you know what you know?
              </p>
              <div className="space-y-2 border-t border-dashed border-[#232323]/30 pt-4 text-[11px]">
                <div className="flex gap-1.5">
                  <span className="font-bold text-[#8B2626] uppercase w-14 inline-block">
                    THEME:
                  </span>
                  <span className="text-[#232323] font-semibold">
                    {gameData.industry_theme}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <span className="font-bold text-[#8B2626] uppercase w-14 inline-block">
                    ROUNDS:
                  </span>
                  <span className="text-[#232323] font-semibold">
                    {totalRounds}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <span className="font-bold text-[#8B2626] uppercase w-14 inline-block">
                    GOAL:
                  </span>
                  <span className="text-[#232323] font-semibold">
                    Calibrate confidence with accuracy
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                logFunnelEvent("GAME_START", deviceIdRef.current, "GUT_CHECK");
                startedAtRef.current = Date.now();
                setPhase("ANCHOR");
              }}
              className="w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 border border-[#232323]"
            >
              START GUT CHECK
            </button>
          </div>
        )}

        {/* ANCHOR PHASE */}
        {phase === "ANCHOR" && activeQuestion && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="bg-[#FAF6F0] border border-[#232323] p-5 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0]">
              <p className="text-xs leading-relaxed text-[#232323] font-medium">
                {activeQuestion.anchor_statement}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => {
                  logFunnelEvent(
                    "GAME_CLICK",
                    deviceIdRef.current,
                    "GUT_CHECK",
                  );
                  saveCurrentRoundSlice({ anchorGuess: true });
                  setPhase("REAL_QUESTION");
                }}
                className="py-3.5 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase border border-[#232323] shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5"
              >
                YES
              </button>
              <button
                onClick={() => {
                  logFunnelEvent(
                    "GAME_CLICK",
                    deviceIdRef.current,
                    "GUT_CHECK",
                  );
                  saveCurrentRoundSlice({ anchorGuess: false });
                  setPhase("REAL_QUESTION");
                }}
                className="py-3.5 bg-[#FAF6F0] text-[#232323] font-black text-xs tracking-widest uppercase border border-[#232323] shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5"
              >
                NO
              </button>
            </div>
          </div>
        )}

        {/* REAL QUESTION PHASE */}
        {phase === "REAL_QUESTION" && activeQuestion && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="bg-[#FAF6F0] border border-[#232323] p-5 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0]">
              <p className="text-xs leading-relaxed text-[#232323] font-medium">
                {activeQuestion.the_real_question}
              </p>
            </div>
            <div className="space-y-4">
              {/* rounded-none h-auto: shadcn Input base has rounded-lg and a fixed h-8 — both fight the retro flat look.
                  focus-visible:ring-0: shadcn base applies a 3px gray ring on keyboard focus — suppressed here. */}
              <Input
                type="number"
                value={numericInput}
                onChange={(e) => setNumericInput(e.target.value)}
                placeholder="Enter your answer..."
                className="w-full bg-[#FAF6F0] border-2 border-[#232323] px-4 py-3 text-xs font-mono font-bold tracking-wider text-[#232323] shadow-[3px_3px_0px_rgba(35,35,35,0.1)] rounded-none h-auto focus:outline-none focus-visible:ring-0 focus-visible:border-[#232323]"
              />
              <button
                disabled={!numericInput.trim()}
                onClick={() => {
                  saveCurrentRoundSlice({ realGuess: Number(numericInput) });
                  setNumericInput("");
                  setPhase("CONFIDENCE_CHECK");
                }}
                className={`w-full py-3.5 font-black text-xs tracking-widest uppercase border border-[#232323] ${numericInput.trim() ? "bg-[#8B2626] text-[#FAF6F0] shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5" : "bg-[#C29393] text-[#FAF6F0]/60 cursor-not-allowed shadow-[4px_4px_0px_rgba(35,35,35,0.15)]"}`}
              >
                SUBMIT ANSWER
              </button>
            </div>
          </div>
        )}

        {/* CONFIDENCE CHECK PHASE */}
        {phase === "CONFIDENCE_CHECK" && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="bg-[#FAF6F0] border border-[#232323] p-5 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0] text-center space-y-2">
              <p className="text-xs text-[#232323]/80 font-medium">
                How confident are you in your answer?
              </p>
              <p className="text-xs font-black tracking-wider text-[#8B2626] uppercase">
                YOUR ANSWER: {roundResponses[currentRoundIndex]?.realGuess}
              </p>
            </div>
            <div className="space-y-4 pt-2">
              <div className="text-center">
                <span className="text-xl font-black text-[#8B2626] block">
                  {confidenceInput}%
                </span>
                <span className="text-[9px] font-bold tracking-widest text-[#232323]/50 block uppercase">
                  CONFIDENCE
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={confidenceInput}
                onChange={(e) => setConfidenceInput(Number(e.target.value))}
                className="w-full h-1.5 appearance-none bg-[#232323]/10 outline-none cursor-pointer accent-[#8B2626]"
                style={{
                  background: `linear-gradient(to right, #8B2626 0%, #8B2626 ${confidenceInput}%, rgba(35,35,35,0.1) ${confidenceInput}%, rgba(35,35,35,0.1) 100%)`,
                }}
              />
              <div className="flex justify-between items-center text-[9px] font-bold text-[#232323]/60 tracking-wider">
                <span>0% – TOTAL GUESS</span>
                <span>100% – ABSOLUTELY CERTAIN</span>
              </div>
            </div>
            <button
              onClick={() => {
                saveCurrentRoundSlice({ confidence: confidenceInput });
                if (currentRoundIndex < totalRounds - 1) {
                  setConfidenceInput(50);
                  setCurrentRoundIndex((prev) => prev + 1);
                  setPhase("ANCHOR");
                } else {
                  endedAtRef.current = Date.now();
                  setPhase("METRICS");
                }
              }}
              className="w-full py-3.5 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase border border-[#232323] shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5"
            >
              SUBMIT CONFIDENCE
            </button>
          </div>
        )}

        {/* METRICS DASHBOARD PHASE */}
        {phase === "METRICS" && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="text-center">
              <h2 className="text-[11px] font-black tracking-widest text-[#8B2626] uppercase">
                CALIBRATION METRICS
              </h2>
            </div>
            <div className="border border-[#232323] bg-[#FAF6F0] p-4 shadow-[5px_5px_0px_#232323] outline-double outline-4 outline-[#FAF6F0] space-y-4">
              <div className="bg-[#232323] p-4 text-center border border-[#3A3A3A]">
                <span className="text-[9px] font-black text-[#00FF33]/60 tracking-widest block uppercase mb-1">
                  OVERALL CALIBRATION
                </span>
                <span className="text-2xl font-black tracking-widest text-[#00FF33] block">
                  {calculatedPerformanceMetrics.overallScore}/100
                </span>
              </div>
              <div className="space-y-1 border border-[#232323]/20 p-2.5">
                <div className="flex justify-between font-black text-[10px] tracking-wider text-[#232323]/80">
                  <span>AVG CONFIDENCE:</span>
                  <span>{calculatedPerformanceMetrics.avgConfidence}%</span>
                </div>
                <div className="h-2 bg-[#232323]/10 border p-px">
                  <div
                    className="h-full bg-[#232323]"
                    style={{
                      width: `${calculatedPerformanceMetrics.avgConfidence}%`,
                    }}
                  />
                </div>
              </div>
              <div className="space-y-1 border border-[#232323]/20 p-2.5">
                <div className="flex justify-between font-black text-[10px] tracking-wider text-[#232323]/80">
                  <span>AVG ACCURACY:</span>
                  <span>{calculatedPerformanceMetrics.avgAccuracy}%</span>
                </div>
                <div className="h-2 bg-[#232323]/10 border p-px">
                  <div
                    className="h-full bg-[#232323]"
                    style={{
                      width: `${calculatedPerformanceMetrics.avgAccuracy}%`,
                    }}
                  />
                </div>
              </div>
              <div className="border border-[#232323]/20 p-3 text-[10px] space-y-2 font-mono">
                <span className="font-bold text-[#8B2626] block text-[9px] tracking-wider uppercase border-b border-[#232323]/10 pb-1">
                  ROUND BY ROUND:
                </span>
                <div className="space-y-1.5 pt-1">
                  {calculatedPerformanceMetrics.breakdowns.map(
                    (item: CalibrationItemBreakdown) => (
                      <div
                        key={item.roundNum}
                        className="flex justify-between text-[#232323]/90 text-[10px] leading-none"
                      >
                        <span className="w-16 shrink-0">
                          ROUND {item.roundNum}:
                        </span>
                        <span className="w-20 text-right shrink-0">
                          {item.confidence}% conf
                        </span>
                        <span className="w-20 text-right shrink-0">
                          {item.accuracy}% acc
                        </span>
                        <span className="w-10 text-right font-bold text-[#8B2626] shrink-0">
                          {item.score}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center border border-[#232323]/20 p-2.5 text-[10px] font-black tracking-wider">
                <span>CALIBRATION QUALITY:</span>
                <span className="text-[#8B2626]">
                  {calculatedPerformanceMetrics.overallScore >= 75
                    ? "✓ EXCELLENT"
                    : calculatedPerformanceMetrics.overallScore >= 50
                      ? "✓ GOOD"
                      : calculatedPerformanceMetrics.overallScore >= 25
                        ? "~ FAIR"
                        : "✗ POOR"}
                </span>
              </div>
            </div>
            <button
              disabled={isSubmittingDb}
              onClick={handleProcessAndSyncScores}
              className="w-full py-3.5 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase border border-[#232323] shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 flex items-center justify-center gap-2"
            >
              {isSubmittingDb ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>SYNCING RECORDS...</span>
                </>
              ) : (
                <span>VIEW ANSWERS</span>
              )}
            </button>
          </div>
        )}

        {/* ITEMISED RESULTS PHASE */}
        {phase === "RESULTS" && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="text-center">
              <h2 className="text-[11px] font-black tracking-widest text-[#8B2626] uppercase">
                CALIBRATION RESULTS
              </h2>
            </div>
            <div className="border border-[#232323] bg-[#FAF6F0] p-4 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0] space-y-3">
              <div className="bg-[#232323] p-3 text-center border border-[#3A3A3A]">
                <span className="text-[9px] font-bold text-[#00FF33]/60 tracking-widest block uppercase mb-0.5">
                  CALIBRATION SCORE
                </span>
                <span className="text-xl font-black text-[#00FF33] tracking-widest block">
                  {calculatedPerformanceMetrics.overallScore}/100
                </span>
              </div>
              <div className="text-[10px] space-y-1.5 font-mono pt-1">
                {calculatedPerformanceMetrics.breakdowns.map(
                  (item: CalibrationItemBreakdown) => (
                    <div
                      key={item.roundNum}
                      className="flex justify-between text-[#232323]/80 text-[10px]"
                    >
                      <span className="w-16 shrink-0">
                        ROUND {item.roundNum}
                      </span>
                      <span className="w-20 text-right shrink-0">
                        {item.confidence}% CONF
                      </span>
                      <span className="w-20 text-right shrink-0">
                        {item.accuracy}% ACC
                      </span>
                      <span className="w-10 text-right font-bold text-[#8B2626] shrink-0">
                        {item.score}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
            <div className="border border-[#232323] bg-[#FAF6F0] p-4 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0] space-y-4">
              <h3 className="text-center font-black text-[10px] tracking-widest text-[#8B2626] uppercase border-b border-[#232323]/10 pb-2">
                ACTUAL ANSWERS
              </h3>
              <div className="space-y-4 divide-y divide-dashed divide-[#232323]/20">
                {calculatedPerformanceMetrics.breakdowns.map(
                  (item: CalibrationItemBreakdown) => (
                    <div
                      key={item.roundNum}
                      className={`text-[11px] space-y-1.5 ${item.roundNum > 1 ? "pt-3" : ""}`}
                    >
                      <p className="font-bold text-[#8B2626] leading-tight">
                        Q{item.roundNum}: {item.questionText}
                      </p>
                      <div className="flex justify-between font-mono font-bold text-[#8B2626] text-[10px] pt-0.5">
                        <span>Your guess: {item.guess}</span>
                        <span>Actual: {item.actual}</span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
            <button
              onClick={handleBackToHome}
              className="w-full py-3.5 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase border border-[#232323] shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5"
            >
              CONTINUE
            </button>
          </div>
        )}
      </main>
    </GameShell>
  );
};

export default GutCheckPage;

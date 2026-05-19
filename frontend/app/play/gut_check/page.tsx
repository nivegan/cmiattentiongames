"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { fetchServerGameData, saveUserGameStats } from "./actions";
import { GutCheckGame } from "@/utils/generate_game";

type AppPhase =
  | "WELCOME"
  | "ANCHOR"
  | "REAL_QUESTION"
  | "CONFIDENCE_CHECK"
  | "METRICS"
  | "RESULTS";

interface RoundResponse {
  anchorGuess: boolean;
  realGuess: number;
  confidence: number;
}

interface CalibrationItemBreakdown {
  roundNum: number;
  confidence: number;
  accuracy: number;
  score: number;
  questionText: string;
  unit: string;
  guess: number;
  actual: number;
}

interface PerformanceMetrics {
  overallScore: number;
  avgConfidence: number;
  avgAccuracy: number;
  breakdowns: CalibrationItemBreakdown[];
}

export default function GutCheckPage() {
  const [gameData, setGameData] = useState<GutCheckGame | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmittingDb, setIsSubmittingDb] = useState<boolean>(false);

  const [phase, setPhase] = useState<AppPhase>("WELCOME");
  const [currentRoundIndex, setCurrentRoundIndex] = useState<number>(0);
  const [roundResponses, setRoundResponses] = useState<
    Record<number, Partial<RoundResponse>>
  >({});

  const [numericInput, setNumericInput] = useState<string>("");
  const [confidenceInput, setConfidenceInput] = useState<number>(50);

  const containerScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadGame() {
      setIsLoading(true);
      const data = await fetchServerGameData();
      if (data) {
        setGameData(data);
      }
      setIsLoading(false);
    }
    loadGame();
  }, []);

  useEffect(() => {
    if (containerScrollRef.current) {
      containerScrollRef.current.scrollTop = 0;
    }
  }, [phase, currentRoundIndex]);

  const handleBackToHome = () => {
    window.location.href = "/";
  };

  const totalRounds = gameData?.questions?.length ?? 3;
  const activeQuestion = gameData?.questions?.[currentRoundIndex];

  const saveCurrentRoundSlice = (updatedFields: Partial<RoundResponse>) => {
    setRoundResponses((prev) => ({
      ...prev,
      [currentRoundIndex]: { ...prev[currentRoundIndex], ...updatedFields },
    }));
  };

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
      if (trueVal === guessVal) {
        calculatedAcc = 100;
      } else {
        const errorRatio = Math.abs(trueVal - guessVal) / trueVal;
        calculatedAcc = Math.max(
          0,
          Math.min(100, Math.round((1 - errorRatio) * 100)),
        );
      }
      accumulatedAccuracy += calculatedAcc;

      const distance = Math.abs(confVal - calculatedAcc);
      const roundCalibrationScore = Math.max(0, 100 - distance);

      itemsList.push({
        roundNum: idx + 1,
        confidence: confVal,
        accuracy: calculatedAcc,
        score: roundCalibrationScore,
        questionText: q.anchor_statement,
        unit: q.unit,
        guess: guessVal,
        actual: trueVal,
      });
    });

    const averageConfidence = Math.round(accumulatedConfidence / totalRounds);
    const averageAccuracy = Math.round(accumulatedAccuracy / totalRounds);
    const finalVarianceDelta = Math.abs(averageConfidence - averageAccuracy);
    const finalComputedOverallScore = Math.max(
      0,
      Math.min(100, 100 - finalVarianceDelta),
    );

    return {
      overallScore: finalComputedOverallScore,
      avgConfidence: averageConfidence,
      avgAccuracy: averageAccuracy,
      breakdowns: itemsList,
    };
  }, [gameData, roundResponses, totalRounds]);

  const handleProcessAndSyncScores = async () => {
    setIsSubmittingDb(true);
    const connectionResult = await saveUserGameStats(
      calculatedPerformanceMetrics.overallScore,
    );
    setIsSubmittingDb(false);

    if (connectionResult.success) {
      setPhase("RESULTS");
    } else {
      alert(
        "Metrics Sync Interrupted. Database tracking records could not verify save operations.",
      );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-9 h-9 border-2 border-[#8B2626] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-[#8B2626] font-black tracking-widest text-xs uppercase animate-pulse">
            LOADING CALIBRATION MATRIX...
          </p>
        </div>
      </div>
    );
  }

  if (!gameData || !gameData.questions || gameData.questions.length === 0) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-4">
        <div className="bg-[#FAF6F0] border-2 border-[#8B2626] p-6 max-w-sm text-center shadow-[4px_4px_0px_#8B2626]">
          <p className="text-xs font-black text-[#8B2626] uppercase mb-2">
            SYSTEM ERROR
          </p>
          <p className="text-xs leading-relaxed text-[#232323]/80">
            Telemetry metrics payload failed verification configurations.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-xs font-black underline text-[#8B2626] uppercase"
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#232323] font-mono flex items-center justify-center p-0 sm:p-4 relative antialiased select-none">
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage: "linear-gradient(#232323 1px, transparent 1px)",
          backgroundSize: "100% 20px",
        }}
      />

      <div className="w-full max-w-md h-screen sm:h-170 bg-[#FAF6F0] sm:border-2 border-[#232323] flex flex-col overflow-hidden relative shadow-[8px_8px_0px_rgba(35,35,35,0.15)]">
        {/* Corner Brackets */}
        <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-[#8B2626]/30 pointer-events-none" />
        <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-[#8B2626]/30 pointer-events-none" />

        <header className="px-6 pt-5 pb-3 bg-[#FAF6F0] z-20 shrink-0">
          <div className="flex items-center justify-between relative">
            <button
              onClick={handleBackToHome}
              className="w-9 h-9 flex items-center justify-center bg-[#FAF6F0] border border-[#232323] shadow-[2px_2px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
            >
              <ArrowLeft className="w-4 h-4 stroke-3" />
            </button>
            <h1 className="text-xs font-black tracking-[0.25em] text-[#8B2626] uppercase">
              GUT CHECK
            </h1>
            <div>
              {phase !== "WELCOME" &&
              phase !== "METRICS" &&
              phase !== "RESULTS" ? (
                <div className="bg-[#232323] text-[#00FF33] font-bold text-[10px] px-2 py-1 border border-[#232323] tracking-widest">
                  ROUND {currentRoundIndex + 1}/{totalRounds}
                </div>
              ) : (
                <div className="w-8 h-8 flex items-center justify-center opacity-40">
                  <div
                    className="w-6 h-6 rounded-full border-2 border-dashed border-[#8B2626] animate-spin"
                    style={{ animationDuration: "8s" }}
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          ref={containerScrollRef}
          className="flex-1 overflow-y-auto px-6 py-4 flex flex-col justify-center min-h-0 pb-24 scroll-smooth"
        >
          {/* WELCOME PHASE */}
          {phase === "WELCOME" && (
            <div className="space-y-6 animate-fadeIn">
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
                onClick={() => setPhase("ANCHOR")}
                className="w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 border border-[#232323]"
              >
                START GUT CHECK
              </button>
            </div>
          )}

          {/* ANCHOR PHASE */}
          {phase === "ANCHOR" && activeQuestion && (
            <div className="space-y-6 animate-fadeIn">
              <div className="text-center">
                <h2 className="text-[11px] font-black tracking-widest text-[#8B2626] uppercase">
                  THE ANCHOR
                </h2>
              </div>
              <div className="bg-[#FAF6F0] border border-[#232323] p-5 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0]">
                <p className="text-xs leading-relaxed text-[#232323] font-medium">
                  {activeQuestion.anchor_statement} {activeQuestion.unit}?
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => {
                    saveCurrentRoundSlice({ anchorGuess: true });
                    setPhase("REAL_QUESTION");
                  }}
                  className="py-3.5 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase border border-[#232323] shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5"
                >
                  YES
                </button>
                <button
                  onClick={() => {
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
            <div className="space-y-5 animate-fadeIn">
              <div className="text-center">
                <h2 className="text-[11px] font-black tracking-widest text-[#8B2626] uppercase">
                  THE REAL QUESTION
                </h2>
              </div>
              <div className="bg-[#FAF6F0] border border-[#232323] p-5 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0]">
                <p className="text-xs leading-relaxed text-[#232323] font-medium">
                  To the nearest whole unit, what is the actual amount or size
                  in {activeQuestion.unit}?
                </p>
              </div>
              <div className="space-y-4">
                <input
                  type="number"
                  value={numericInput}
                  onChange={(e) => setNumericInput(e.target.value)}
                  placeholder="Enter your answer..."
                  className="w-full bg-[#FAF6F0] border-2 border-[#232323] px-4 py-3 text-xs font-mono font-bold tracking-wider text-[#232323] shadow-[3px_3px_0px_rgba(35,35,35,0.1)] focus:outline-none"
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
            <div className="space-y-6 animate-fadeIn">
              <div className="text-center">
                <h2 className="text-[11px] font-black tracking-widest text-[#8B2626] uppercase">
                  CONFIDENCE CHECK
                </h2>
              </div>
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
            <div className="space-y-5 animate-fadeIn">
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
                  {calculatedPerformanceMetrics.breakdowns.map(
                    (item: CalibrationItemBreakdown) => (
                      <div
                        key={item.roundNum}
                        className="flex justify-between items-center text-[#232323]/90"
                      >
                        <span>ROUND {item.roundNum}:</span>
                        <span>
                          {item.confidence}% conf &nbsp;{item.accuracy}% acc
                          &nbsp;
                          <span className="font-bold text-[#8B2626]">
                            {item.score}
                          </span>
                        </span>
                      </div>
                    ),
                  )}
                </div>
                <div className="flex justify-between items-center border border-[#232323]/20 p-2.5 text-[10px] font-black tracking-wider">
                  <span>CALIBRATION QUALITY:</span>
                  <span className="text-[#8B2626]">✓ GOOD</span>
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
            <div className="space-y-5 animate-fadeIn">
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
                        className="flex justify-between text-[#232323]/80"
                      >
                        <span>ROUND {item.roundNum}</span>
                        <span>{item.confidence}% CONF</span>
                        <span>{item.accuracy}% ACC</span>
                        <span className="font-bold text-[#8B2626]">
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
                          Q{item.roundNum}: {item.questionText} {item.unit}?
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
      </div>
    </div>
  );
}

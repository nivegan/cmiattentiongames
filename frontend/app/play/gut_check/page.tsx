"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { fetchServerGameData } from "./actions";
import { saveUserGameStat } from "@/utils/saveUserGameStat";
import { GutCheckGame } from "@/utils/generate_game";
import { useRouter } from "next/navigation";
import { useDeviceId } from "@/hooks/useDeviceId";
import { GameShell } from "@/components/GameShell";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { GameErrorScreen } from "@/components/GameErrorScreen";

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

const GutCheckPage = () => {
  const router = useRouter();
  const [gameData, setGameData] = useState<GutCheckGame | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmittingDb, setIsSubmittingDb] = useState<boolean>(false);

  const deviceIdRef = useDeviceId();

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
      try {
        const response = await fetchServerGameData(deviceIdRef.current);
        if (!response.success) {
          if (response.error === "ALREADY_PLAYED") {
            router.push("/");
            return;
          }
        }
        if (response.data) {
          setGameData(response.data);
        }
        setIsLoading(false);
      } catch {
        setIsLoading(false);
      }
    }
    loadGame();
  }, [deviceIdRef, router]);

  // Scroll back to the top whenever the phase or round changes so the user
  // never lands mid-page on a new question.
  useEffect(() => {
    if (containerScrollRef.current) {
      containerScrollRef.current.scrollTop = 0;
    }
  }, [phase, currentRoundIndex]);

  const handleBackToHome = () => {
    router.push("/");
  };

  const totalRounds = gameData?.questions?.length ?? 3;
  const activeQuestion = gameData?.questions?.[currentRoundIndex];

  // Merges partial fields into the current round's response record. Called
  // separately for anchorGuess, realGuess, and confidence across different
  // phases so each update doesn't overwrite the others.
  const saveCurrentRoundSlice = (updatedFields: Partial<RoundResponse>) => {
    setRoundResponses((prev) => ({
      ...prev,
      [currentRoundIndex]: { ...prev[currentRoundIndex], ...updatedFields },
    }));
  };

  // Scoring formula (runs only when roundResponses changes, i.e. after each round):
  //   Accuracy%   = Max(0, Min(100, round((1 - |true - guess| / true) * 100)))
  //   Calibration = Max(0, 100 - |Accuracy% - Confidence%|)  ← reward alignment
  //   Round score = Accuracy% * 0.5 + Calibration * 0.5
  //   Overall     = average of all round scores
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
      return { overallScore: 0, avgConfidence: 0, avgAccuracy: 0, breakdowns: [] };
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

  const handleProcessAndSyncScores = async () => {
    setIsSubmittingDb(true);
    try {
      const connectionResult = await saveUserGameStat(
        calculatedPerformanceMetrics.overallScore,
        deviceIdRef.current,
        "GUT_CHECK",
        "web_gut_check_v1",
      );
      if (connectionResult.success) {
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

  if (isLoading) return <GameLoadingScreen />;
  if (!gameData || !gameData.questions || gameData.questions.length === 0)
    return <GameErrorScreen />;

  return (
    <GameShell
      title="GUT CHECK"
      onBack={handleBackToHome}
      badge={
        phase !== "WELCOME" && phase !== "METRICS" && phase !== "RESULTS" ? (
          <div className="bg-[#232323] text-[#00FF33] font-bold text-[10px] px-2 py-1 border border-[#232323] tracking-widest">
            ROUND {currentRoundIndex + 1}/{totalRounds}
          </div>
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
              onClick={() => setPhase("ANCHOR")}
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
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="bg-[#FAF6F0] border border-[#232323] p-5 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0]">
              <p className="text-xs leading-relaxed text-[#232323] font-medium">
                {activeQuestion.the_real_question}
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
          <div className="space-y-6 animate-in fade-in duration-200">
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

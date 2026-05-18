"use client";

import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Check, HelpCircle } from "lucide-react";
import { fetchServerGameData } from "./actions";
import { ExtractFactsGame } from "@/utils/generate_game";

type AppPhase = "INTRO" | "QUIZ" | "TAKEAWAY" | "METRICS" | "COMPLETE";

export default function ExtractFactsPage() {
  // Server Data Hydration States
  const [gameData, setGameData] = useState<ExtractFactsGame | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Layout Machine Navigation & Tracking States
  const [phase, setPhase] = useState<AppPhase>("INTRO");
  const [currentQuizIndex, setCurrentQuizIndex] = useState<number>(0);
  const [quizSelections, setQuizSelections] = useState<Record<number, number>>(
    {},
  );
  const [takeawayText, setTakeawayText] = useState<string>("");

  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Initialize Game Data strictly from our Server Action boundary
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
  console.log("Data = ", gameData);
  // Auto-scroll layout container to top during phase mutations
  useEffect(() => {
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [phase, currentQuizIndex]);

  // Fallback / Validation logic if Server Action misfires
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F4EFE6] text-[#3A221D] font-mono flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-[#8B2626] border-t-transparent rounded-full animate-spin mx-auto" />
          <div className="text-[#8B2626] font-bold tracking-widest text-xs uppercase animate-pulse pt-2">
            CALIBRATING ...
          </div>
        </div>
      </div>
    );
  }

  if (
    !gameData ||
    !gameData.mcq_questions ||
    gameData.mcq_questions.length === 0
  ) {
    return (
      <div className="min-h-screen bg-[#F4EFE6] text-[#3A221D] font-mono flex items-center justify-center p-4">
        <div className="bg-[#FAF8F5] border border-[#EF4444] p-6 max-w-sm text-center rounded shadow-sm">
          <p className="text-sm font-bold text-[#EF4444] uppercase mb-2">
            System Interruption
          </p>
          <p className="text-xs text-[#5C4540]">
            Unable to generate exercise telemetry records. Please try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-xs font-bold underline text-[#8B2626]"
          >
            RETRY CONNECTION
          </button>
        </div>
      </div>
    );
  }

  // Handle Global Navigation Routing Backwards
  const handleBackToHome = () => {
    window.location.href = "/";
  };

  // Safe References to Server Data arrays
  const questions = gameData.mcq_questions;
  const currentQuestionItem = questions[currentQuizIndex];

  // Client Validation Rule Logic
  const takeawayWordCount = takeawayText.trim()
    ? takeawayText.trim().split(/\s+/).filter(Boolean).length
    : 0;

  const correctCount = questions.reduce((score, q, idx) => {
    return quizSelections[idx] === q.correct_answer_index ? score + 1 : score;
  }, 0);

  // Fixed Structural Takeaway Facts Array
  const verifiedFactsMock = [
    "6G networks utilize distinct high-band spectrum architectures.",
    "Edge computing execution objectives focus on reducing raw latency metrics.",
    "Real-time holographic processing requires clean multi-band signals.",
    "Factual reporting frames differentiate infrastructure deployment from speculation.",
    "Subjective analysis maps technological integration trajectories cleanly.",
  ];

  return (
    <div className="min-h-screen bg-[#F4EFE6] text-[#3A221D] font-mono flex items-center justify-center p-0 sm:p-4 select-none antialiased relative selection:bg-[#8B2626]/20">
      {/* Background Lined Notebook Texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: "linear-gradient(#3A221D 1px, transparent 1px)",
          backgroundSize: "100% 24px",
        }}
      />

      {/* Main Responsive Dossier Master Shell */}
      <div className="w-full max-w-160 h-screen sm:h-220 bg-[#F9F6EE] sm:rounded-xl shadow-[0_16px_40px_rgba(58,34,29,0.15)] border-0 sm:border border-[#E6DEC9] flex flex-col overflow-hidden relative">
        {/* Tactical Corner Overlays */}
        <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-[#3A221D]/20 pointer-events-none" />
        <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-[#3A221D]/20 pointer-events-none" />
        <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-[#3A221D]/20 pointer-events-none" />
        <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-[#3A221D]/20 pointer-events-none" />

        {/* HEADER REGION */}
        {phase !== "COMPLETE" && (
          <header className="px-6 pt-5 pb-3 border-b border-[#E6DEC9]/60 bg-[#F9F6EE] z-20 shrink-0">
            <div className="flex items-center justify-between relative mb-4">
              <button
                onClick={handleBackToHome}
                className="w-10 h-10 flex items-center justify-center bg-[#F9F6EE] border border-[#D9CDB3] shadow-[2px_2px_0px_#D9CDB3] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_#D9CDB3] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all rounded-sm"
              >
                <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
              </button>

              <div className="text-center">
                <h1 className="text-base font-extrabold tracking-wider text-[#8B2626] uppercase">
                  Extract Facts
                </h1>
                <span className="text-[9px] font-bold tracking-widest text-[#7C6560] block uppercase opacity-80">
                  TOPIC: {gameData.topic}
                </span>
              </div>

              <div className="relative flex items-center justify-center w-11 h-8">
                <div className="absolute inset-0 opacity-10 flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full border border-[#8B2626] animate-pulse" />
                </div>
                <div className="bg-[#1C261F] text-[#42F56C] font-bold text-xs px-2.5 py-1 rounded-sm shadow-inner border border-[#2D3B31]">
                  {phase === "INTRO" ? "1/3" : phase === "QUIZ" ? "2/3" : "3/3"}
                </div>
              </div>
            </div>

            <div className="h-2.5 bg-[#2A2321] rounded-full p-0.5 overflow-hidden shadow-inner border border-[#1A1514]">
              <div className="h-full flex rounded-full overflow-hidden">
                <div className="w-1/4 bg-[#22C55E]" />
                <div className="w-3/4 bg-[#EF4444]" />
              </div>
            </div>
          </header>
        )}

        {/* SCROLLABLE INTERACTION WORKSPACE */}
        <main
          ref={contentScrollRef}
          className="flex-1 overflow-y-auto px-6 py-6 scroll-smooth min-h-0"
          style={{ paddingBottom: "100px" }}
        >
          {/* PHASE 1: NARRATIVE READ BLOCK */}
          {phase === "INTRO" && (
            <div className="space-y-6 max-w-md mx-auto">
              <h2 className="text-center font-bold tracking-wide text-xs text-[#8B2626]/80 uppercase">
                Read Both Narratives
              </h2>

              <div className="bg-[#FAF8F5] border-l-4 border-[#EF4444] border-y border-r p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.5)] rounded-r-sm">
                <span className="text-xs font-bold text-[#EF4444] tracking-wider block mb-2">
                  NARRATIVE A
                </span>
                <p className="text-[13px] leading-relaxed text-[#5C4540]">
                  {gameData.paragraph_a}
                </p>
              </div>

              <div className="bg-[#FAF8F5] border-l-4 border-[#3B82F6] border-y border-r p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.5)] rounded-r-sm">
                <span className="text-xs font-bold text-[#3B82F6] tracking-wider block mb-2">
                  NARRATIVE B
                </span>
                <p className="text-[13px] leading-relaxed text-[#5C4540]">
                  {gameData.paragraph_b}
                </p>
              </div>

              <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.3)] rounded-sm border-dashed text-center">
                <p className="text-[12px] leading-relaxed text-[#7C6560]">
                  Analyze the paragraphs carefully. One represents checked,
                  empirical facts; the other incorporates speculative anomalies.
                </p>
              </div>
            </div>
          )}

          {/* PHASE 2: DYNAMIC SYSTEM MCQ RUNTIME */}
          {phase === "QUIZ" && currentQuestionItem && (
            <div className="space-y-5 max-w-md mx-auto">
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold tracking-tight text-[#8B2626] text-sm uppercase">
                  QUESTION {currentQuizIndex + 1} / {questions.length}
                </h3>
                <div className="bg-[#1C261F] text-[#42F56C] font-bold text-[11px] px-2 py-0.5 rounded-sm border border-[#2D3B31]">
                  0/{questions.length}
                </div>
              </div>

              <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.6)] rounded-sm">
                <p className="text-[14px] font-medium leading-relaxed text-[#3A221D]">
                  {currentQuestionItem.question}
                </p>
              </div>

              <div className="space-y-3 pt-1">
                {currentQuestionItem.options.map((option, optIdx) => {
                  const isSelected =
                    quizSelections[currentQuizIndex] === optIdx;
                  return (
                    <button
                      key={optIdx}
                      onClick={() =>
                        setQuizSelections({
                          ...quizSelections,
                          [currentQuizIndex]: optIdx,
                        })
                      }
                      className={`w-full text-left bg-[#FAF8F5] border p-3.5 shadow-[3px_3px_0px_rgba(217,205,179,0.5)] rounded-sm flex items-start gap-3 transition-all ${
                        isSelected
                          ? "border-[#8B2626] bg-[#8B2626]/5 shadow-[2px_2px_0px_#8B2626]"
                          : "border-[#D9CDB3] hover:border-[#B5A88F]"
                      }`}
                    >
                      <div
                        className={`w-4.5 h-4.5 border shrink-0 mt-0.5 flex items-center justify-center rounded-sm ${
                          isSelected
                            ? "border-[#8B2626] bg-[#8B2626]"
                            : "border-[#7C6560] bg-white"
                        }`}
                      >
                        {isSelected && (
                          <div className="w-1.5 h-1.5 bg-white rounded-xs" />
                        )}
                      </div>
                      <span className="text-[13px] leading-tight text-[#5C4540]">
                        {option}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-dashed border-[#D9CDB3] pt-4 mt-6" />
              <span className="text-[10px] font-bold tracking-widest text-[#8B2626]/80 block uppercase">
                REFERENCE PANELS:
              </span>
              <div className="space-y-2 opacity-75 text-[11px] leading-relaxed">
                <div className="bg-[#FAF8F5] border-l-2 border-[#EF4444] border-y border-r p-2.5">
                  <span className="font-bold text-[#EF4444] block text-[9px] mb-0.5">
                    NARRATIVE A
                  </span>
                  {gameData.paragraph_a}
                </div>
                <div className="bg-[#FAF8F5] border-l-2 border-[#3B82F6] border-y border-r p-2.5">
                  <span className="font-bold text-[#3B82F6] block text-[9px] mb-0.5">
                    NARRATIVE B
                  </span>
                  {gameData.paragraph_b}
                </div>
              </div>
            </div>
          )}

          {/* PHASE 3: REFLECTIVE ANALYSIS INPUT */}
          {phase === "TAKEAWAY" && (
            <div className="space-y-5 max-w-md mx-auto">
              <h2 className="text-center font-extrabold tracking-wide text-xs text-[#8B2626] uppercase">
                Your Takeaway
              </h2>

              <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.6)] rounded-sm">
                <div className="flex items-center gap-2 text-xs font-bold text-[#22C55E] tracking-wider border-b border-[#E6DEC9] pb-2 mb-3 uppercase">
                  <span>✓</span> Empirical Facts Extracted
                </div>
                <ol className="space-y-2.5 text-[12px] leading-relaxed text-[#5C4540]">
                  {verifiedFactsMock.map((fact, index) => (
                    <li key={index} className="flex gap-2 items-start">
                      <span className="font-bold text-[#8B2626] shrink-0">
                        {index + 1}.
                      </span>
                      <span>{fact}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.4)] rounded-sm space-y-3">
                <label className="text-[12px] font-medium text-[#3A221D] block">
                  Now write your own subjective interpretation. What do you
                  think about this event?
                </label>
                <div className="relative">
                  <textarea
                    value={takeawayText}
                    onChange={(e) => setTakeawayText(e.target.value)}
                    placeholder="In my opinion, this event shows that...&#10;I believe the key issue is...&#10;My perspective is..."
                    className="w-full h-32 bg-[#FAF8F5] border-2 border-[#3A221D] p-3 text-[13px] font-mono leading-relaxed placeholder:text-[#3A221D]/30 text-[#3A221D] rounded-sm focus:outline-none focus:ring-2 focus:ring-[#8B2626]/20 resize-none shadow-inner"
                  />
                  <div className="absolute bottom-2.5 right-3 text-[9px] font-bold px-1.5 py-0.5 rounded-xs bg-[#1C261F] text-[#42F56C] border border-[#2D3B31]">
                    {takeawayWordCount} / 10 WORDS
                  </div>
                </div>
                <p className="text-[11px] font-medium leading-tight text-[#8B2626]">
                  This is your space for opinions and emotions – clearly
                  separate from facts above.
                </p>
              </div>
            </div>
          )}

          {/* PHASE 4: TELEMETRY & METRIC EVALUATION RESULTS */}
          {phase === "METRICS" && (
            <div className="max-w-md mx-auto space-y-4">
              <h2 className="text-center font-extrabold tracking-wide text-xs text-[#8B2626] uppercase">
                Fact Extraction Metrics
              </h2>

              <div className="border-4 border-double border-[#D9CDB3] bg-[#FAF8F5] p-5 shadow-[6px_6px_0px_rgba(217,205,179,0.5)] rounded-sm space-y-4">
                <div className="bg-[#1C261F] py-2.5 rounded-sm text-center border border-[#2D3B31]">
                  <span className="text-[#42F56C] font-extrabold text-xs tracking-widest block animate-pulse">
                    ANALYSIS COMPLETE
                  </span>
                </div>

                <div className="space-y-1 bg-[#FAF8F5] border border-[#D9CDB3] p-3 rounded-sm">
                  <div className="flex justify-between items-center font-bold text-xs">
                    <span>MCQ ACCURACY:</span>
                    <span className="text-[#8B2626]">
                      {correctCount}/{questions.length}
                    </span>
                  </div>
                  <div className="h-2 bg-[#2A2321] rounded-full p-px border border-[#1A1514]">
                    <div
                      className="h-full bg-[#42F56C] rounded-full transition-all duration-300"
                      style={{
                        width: `${(correctCount / questions.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 rounded-sm space-y-3">
                  <span className="text-[11px] font-bold text-[#8B2626] tracking-wider block border-b border-[#E6DEC9] pb-1.5 uppercase">
                    Question Breakdown:
                  </span>
                  <div className="space-y-3">
                    {questions.map((q, idx) => {
                      const isUserCorrect =
                        quizSelections[idx] === q.correct_answer_index;
                      return (
                        <div key={idx} className="text-[11px] space-y-1">
                          <div className="flex justify-between font-bold">
                            <span className="text-[#3A221D]">Q{idx + 1}:</span>
                            <span
                              className={
                                isUserCorrect
                                  ? "text-[#22C55E]"
                                  : "text-[#EF4444]"
                              }
                            >
                              {isUserCorrect ? "✓ CORRECT" : "✗ INCORRECT"}
                            </span>
                          </div>
                          <p className="text-[#7C6560] leading-normal text-[11px]">
                            Expected Option Index: {q.correct_answer_index}.
                            Provided Index: {quizSelections[idx] ?? "None"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2 text-xs font-bold">
                  <div className="flex justify-between items-center bg-[#FAF8F5] border border-[#D9CDB3] p-2.5 rounded-sm">
                    <span>TAKEAWAY DEPTH:</span>
                    <span className="text-[#8B2626]">
                      ⊙ {takeawayWordCount >= 20 ? "DETAILED" : "BRIEF"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-[#FAF8F5] border border-[#D9CDB3] p-2.5 rounded-sm">
                    <span>BIAS RECOGNITION:</span>
                    <span className="text-[#8B2626]">
                      ⊙{" "}
                      {correctCount === questions.length
                        ? "EXCELLENT"
                        : "IMPROVING"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PHASE 5: SUCCESS ARCHIVE TERMINAL */}
          {phase === "COMPLETE" && (
            <div className="max-w-md mx-auto text-center space-y-5 pt-6">
              <div className="inline-flex items-center justify-center w-11 h-11 bg-[#FAF8F5] border border-[#D9CDB3] shadow-[3px_3px_0px_#D9CDB3] rounded-sm">
                <Check className="w-4 h-4 text-[#8B2626] stroke-3" />
              </div>

              <div>
                <h2 className="text-xl font-black tracking-tight text-[#8B2626] uppercase">
                  Facts Extracted!
                </h2>
                <p className="text-[10px] font-bold tracking-widest text-[#7C6560] uppercase mt-0.5">
                  Extract the Facts Completed
                </p>
              </div>

              <div className="border-4 border-double border-[#D9CDB3] bg-[#FAF8F5] p-5 shadow-[6px_6px_0px_rgba(217,205,179,0.5)] rounded-sm max-w-xs mx-auto space-y-3">
                <div className="bg-[#1C261F] border border-[#2D3B31] py-3 rounded-sm">
                  <span className="text-[10px] font-bold tracking-widest text-[#42F56C]/60 block mb-0.5 uppercase">
                    Final Score
                  </span>
                  <span className="text-2xl font-black tracking-widest text-[#42F56C] block">
                    {String(correctCount * 30 + takeawayWordCount).padStart(
                      3,
                      "0",
                    )}
                  </span>
                </div>
                <div className="pt-2 border-t border-[#E6DEC9]">
                  <span className="text-[10px] font-bold tracking-wider text-[#8B2626] block uppercase">
                    Skill Developed
                  </span>
                  <span className="text-xs font-extrabold text-[#3A221D] block mt-0.5">
                    Bias Recognition
                  </span>
                  <p className="text-[10px] text-[#7C6560] mt-1 leading-normal">
                    Bias filtered from truth data parameters successfully.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* VIEWPORT BALANCED FIXED ACTION FOOTER CONTROLLER */}
        <footer className="absolute bottom-0 inset-x-0 bg-linear-to-t from-[#F9F6EE] via-[#F9F6EE] to-[#F9F6EE]/0 px-6 pb-6 pt-8 z-20 flex flex-items justify-center">
          {phase === "INTRO" && (
            <button
              onClick={() => setPhase("QUIZ")}
              className="w-full max-w-md py-3.5 bg-[#8B2626] text-white font-extrabold text-xs tracking-widest uppercase rounded-sm shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75 transition-all"
            >
              Start Questions
            </button>
          )}

          {phase === "QUIZ" &&
            (() => {
              const isAnswered = quizSelections[currentQuizIndex] !== undefined;
              const isLast = currentQuizIndex === questions.length - 1;
              return (
                <button
                  disabled={!isAnswered}
                  onClick={() =>
                    isLast
                      ? setPhase("TAKEAWAY")
                      : setCurrentQuizIndex((prev) => prev + 1)
                  }
                  className={`w-full max-w-md py-3.5 font-extrabold text-xs tracking-widest uppercase rounded-sm transition-all ${
                    isAnswered
                      ? "bg-[#8B2626] text-white shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75"
                      : "bg-[#8B2626]/30 text-[#8B2626]/40 cursor-not-allowed pointer-events-none"
                  }`}
                >
                  {isLast ? "Continue" : "Next Question"}
                </button>
              );
            })()}

          {phase === "TAKEAWAY" &&
            (() => {
              const isValid = takeawayWordCount >= 10;
              return (
                <button
                  disabled={!isValid}
                  onClick={() => setPhase("METRICS")}
                  className={`w-full max-w-md py-3.5 font-extrabold text-xs tracking-widest uppercase rounded-sm transition-all ${
                    isValid
                      ? "bg-[#8B2626] text-white shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75"
                      : "bg-[#8B2626]/30 text-[#8B2626]/40 cursor-not-allowed pointer-events-none"
                  }`}
                >
                  View Results
                </button>
              );
            })()}

          {(phase === "METRICS" || phase === "COMPLETE") && (
            <button
              onClick={() =>
                phase === "METRICS" ? setPhase("COMPLETE") : handleBackToHome()
              }
              className="w-full max-w-md py-3.5 bg-[#8B2626] text-white font-extrabold text-xs tracking-widest uppercase rounded-sm shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75 transition-all"
            >
              Continue
            </button>
          )}
        </footer>

        <button className="absolute bottom-4 right-4 w-7 h-7 bg-[#1A1514] hover:bg-[#2A2321] text-white rounded-full flex items-center justify-center shadow-lg transition-colors z-30">
          <HelpCircle className="w-3.5 h-3.5 text-[#FAF8F5]/80" />
        </button>
      </div>
    </div>
  );
}

"use client";
// extract_facts/page.tsx
// The Extract Facts game — a multi-phase media literacy exercise where players:
//   1. Read two narratives about the same event (A = factual, B = spin)
//   2. Answer 3 MCQs testing their ability to distinguish fact from framing
//   3. Write a personal takeaway (≥10 words) reflecting on what they learned
//   4. See their metric breakdown
//
// GAME PHASES (AppPhase):
//   INTRO    → read both narratives side by side
//   QUIZ     → answer 3 multiple-choice questions
//   TAKEAWAY → write a personal reflection (min 10 words)
//   METRICS  → see accuracy breakdown + bias recognition score
//   COMPLETE → score saved, completion screen
//
// INTERIM SCORING:
//   Score = (correct MCQs × 30) + takeaway word count
//   (Full formula with Takeaway Depth tiers and Loaded Words penalty is TBD)

import { useState, useEffect, useMemo, useRef } from "react";
import { Check, Loader2 } from "lucide-react";
import { fetchServerGameData } from "./actions";
import { saveUserGameStat } from "@/utils/saveUserGameStat";
import { logFunnelEvent } from "@/utils/logFunnelEvent";
import type { ExtractFactsData } from "@/utils/generate_extract_facts";
import { useRouter } from "next/navigation";
import { useDeviceId } from "@/hooks/useDeviceId";
import { GameShell } from "@/components/GameShell";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { GameErrorScreen } from "@/components/GameErrorScreen";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

// All possible game phases — drives which section of the UI is displayed
type AppPhase = "INTRO" | "QUIZ" | "TAKEAWAY" | "METRICS" | "COMPLETE";

const ExtractFactsPage = () => {
  const router = useRouter(); // for programmatic navigation (redirect to home)

  // AI-generated game content (topic, two paragraphs, MCQ questions + answers)
  const [gameData, setGameData] = useState<ExtractFactsData | null>(null);
  // true while the server action is fetching game data
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // true while the score is being saved (prevents double-submit)
  const [isSubmittingDb, setIsSubmittingDb] = useState<boolean>(false);

  // Anonymous device ID from localStorage (identity for non-signed-in users)
  const deviceIdRef = useDeviceId();

  // Current phase of the game
  const [phase, setPhase] = useState<AppPhase>("INTRO");
  // Which MCQ question (0-indexed) the player is currently answering
  const [currentQuizIndex, setCurrentQuizIndex] = useState<number>(0);
  // Stores the player's selected option index for each question (key = question index)
  const [quizSelections, setQuizSelections] = useState<Record<number, number>>(
    {},
  );
  // The player's free-text takeaway response
  const [takeawayText, setTakeawayText] = useState<string>("");

  // Ref to the scrollable content area — used to scroll to top on phase/question change
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Extracts up to 5 sentences from paragraph_a to show as "verified facts" in the
  // TAKEAWAY phase. paragraph_a is the factual narrative; paragraph_b is the spin.
  // The >20 character filter removes very short fragments that appear after splitting
  // on sentence-ending punctuation (.!?).
  const verifiedFacts = useMemo(() => {
    if (!gameData || !gameData.paragraph_a) return [];

    return gameData.paragraph_a
      .split(/[.!?]/) // split into sentences
      .map((sentence) => sentence.trim()) // remove leading/trailing whitespace
      .filter((sentence) => sentence.length > 20) // drop very short fragments
      .slice(0, 5); // cap at 5 bullets
  }, [gameData]);

  // Load game data once on mount. Checks daily lock, returns cached or fresh data.
  useEffect(() => {
    const loadGame = async () => {
      setIsLoading(true);
      try {
        const response = await fetchServerGameData(deviceIdRef.current);
        if (!response.success) {
          if (response.error === "ALREADY_PLAYED") {
            router.push("/"); // already played today — redirect home
            return;
          }
          // Any other !success case falls through: gameData stays null, and
          // the `!gameData` guard below renders <GameErrorScreen> implicitly.
        }
        if (response.data) {
          setGameData(response.data);
        }
        // setIsLoading(false) is called AFTER setGameData so there is no
        // intermediate render where isLoading=false and gameData=null, which
        // would flash <GameErrorScreen> for one frame.
        setIsLoading(false);
      } catch {
        // Network / server error: gameData stays null → <GameErrorScreen> renders.
        setIsLoading(false);
      }
    };
    loadGame();
  }, [deviceIdRef, router]);

  // Scroll to top whenever the active phase or question changes
  useEffect(() => {
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [phase, currentQuizIndex]);

  // Count words in the takeaway textarea (splits on whitespace, ignores empty tokens)
  const takeawayWordCount = takeawayText.trim()
    ? takeawayText.trim().split(/\s+/).filter(Boolean).length
    : 0;

  const questions = gameData?.mcq_questions ?? [];
  const currentQuestionItem = questions[currentQuizIndex];

  // Count how many MCQs the player answered correctly across all questions
  const correctCount = questions.reduce((score, q, idx) => {
    return quizSelections[idx] === q.correct_answer_index ? score + 1 : score;
  }, 0);

  // INTERIM SCORING: each correct MCQ = 30 points + 1 point per takeaway word.
  // Wrapped in useMemo so it only recalculates when inputs actually change.
  const finalComputedScore = useMemo(() => {
    return correctCount * 30 + takeawayWordCount;
  }, [correctCount, takeawayWordCount]);

  // Called when the player clicks "Continue" on the METRICS screen.
  // Saves the score then transitions to COMPLETE.
  const handleMetricsCompletionSubmit = async () => {
    setIsSubmittingDb(true);
    try {
      const dbTransaction = await saveUserGameStat(
        finalComputedScore,
        deviceIdRef.current,
        "EXTRACT_THE_FACTS",
        "web_extract_facts_v1",
      );
      if (dbTransaction.success) {
        logFunnelEvent(
          "GAME_COMPLETE",
          deviceIdRef.current,
          "EXTRACT_THE_FACTS",
        );
        setPhase("COMPLETE");
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

  const handleBackToHome = () => {
    router.push("/");
  };

  // Whether the player has selected an answer for the current question
  const isCurrentQuizAnswered = quizSelections[currentQuizIndex] !== undefined;
  // Whether this is the last MCQ question (determines button label: Next vs Continue)
  const isLastQuestion = currentQuizIndex === questions.length - 1;
  // The "Continue" button on the TAKEAWAY screen is only enabled once the player
  // has written at least 10 words — enforces a minimum reflection depth.
  const isTakeawayValid = takeawayWordCount >= 10;

  if (isLoading) return <GameLoadingScreen />;
  // Two conditions that warrant an error screen:
  //   1. gameData is null — server action failed or returned no data
  //   2. questions is empty — Gemini returned a game object with no MCQs (schema mismatch / partial parse)
  if (!gameData || questions.length === 0) return <GameErrorScreen />;

  return (
    <GameShell
      title="EXTRACT FACTS"
      onBack={handleBackToHome}
      badge={
        <Badge className="rounded-none h-auto bg-[#232323] text-[#00FF33] font-bold text-[10px] px-2 py-1 border border-[#232323] tracking-widest">
          {phase === "INTRO" ? "1/3" : phase === "QUIZ" ? "2/3" : "3/3"}
        </Badge>
      }
    >
      {phase !== "COMPLETE" && (
        <div className="px-6 pb-3 shrink-0 border-b border-[#232323]/10">
          <p className="text-center text-[9px] font-bold tracking-widest text-[#8B2626]/60 uppercase truncate mb-2">
            TOPIC: {gameData.topic}
          </p>
          <div className="h-2 bg-[#232323]/10 border border-[#232323]/20 p-0.5">
            <div className="h-full flex">
              {/* Green fill advances: 1/3 → 2/3 → full across INTRO/QUIZ/TAKEAWAY+ */}
              <div
                className={`bg-[#22C55E] transition-all duration-300 ${
                  phase === "INTRO"
                    ? "w-1/3"
                    : phase === "QUIZ"
                      ? "w-2/3"
                      : "w-full"
                }`}
              />
              {/* Red-tinted remainder visually represents remaining progress */}
              <div className="flex-1 bg-[#EF4444]/30" />
            </div>
          </div>
        </div>
      )}

      {/* min-h-0: flex children default to min-height:auto, which lets them grow
          past the parent and prevents overflow-y-auto from scrolling. Explicitly
          setting min-h-0 allows the flex item to shrink and actually overflow. */}
      {/* paddingBottom inline style: Tailwind's largest pb-* (~96 = 24rem) isn't
          enough on small screens to clear the absolute-positioned footer button.
          100px inline override guarantees the last content item is always visible. */}
      <main
        ref={contentScrollRef}
        className="flex-1 overflow-y-auto px-6 py-6 scroll-smooth min-h-0"
        style={{ paddingBottom: "100px" }}
      >
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

            <div className="bg-[#FAF8F5] border-l-4 border-y border-r border-[#D9CDB3] p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.5)] rounded-r-sm">
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

        {phase === "QUIZ" && currentQuestionItem && (
          <div className="space-y-5 max-w-md mx-auto">
            <div className="flex items-center">
              <h3 className="font-extrabold tracking-tight text-[#8B2626] text-sm uppercase">
                QUESTION {currentQuizIndex + 1} / {questions.length}
              </h3>
            </div>

            <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.6)] rounded-sm">
              <p className="text-[14px] font-medium leading-relaxed text-[#3A221D]">
                {currentQuestionItem.question}
              </p>
            </div>

            <div className="space-y-3 pt-1">
              {currentQuestionItem.options.map((option, optIdx) => {
                const isSelected = quizSelections[currentQuizIndex] === optIdx;
                return (
                  <button
                    key={optIdx}
                    onClick={() => {
                      logFunnelEvent(
                        "GAME_CLICK",
                        deviceIdRef.current,
                        "EXTRACT_THE_FACTS",
                      );
                      setQuizSelections({
                        ...quizSelections,
                        [currentQuizIndex]: optIdx,
                      });
                    }}
                    className={`w-full text-left bg-[#FAF8F5] border p-3.5 shadow-[3px_3px_0px_rgba(217,205,179,0.5)] rounded-sm flex items-start gap-3 transition-all ${
                      isSelected
                        ? "border-[#8B2626] bg-[#8B2626]/5 shadow-[2px_2px_0px_#8B2626]"
                        : "border-[#D9CDB3] hover:border-[#B5A88F]"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 border shrink-0 mt-0.5 flex items-center justify-center rounded-sm text-[10px] font-black ${
                        isSelected
                          ? "border-[#8B2626] bg-[#8B2626] text-white"
                          : "border-[#7C6560] bg-white text-[#7C6560]"
                      }`}
                    >
                      {/* charCode 65 = 'A'; yields A/B/C/D labels for option indices 0/1/2/3 */}
                      {String.fromCharCode(65 + optIdx)}
                    </div>
                    <span className="text-[13px] leading-tight text-[#5C4540]">
                      {option}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Reference panels reprint both narratives inline at reduced size/opacity
                so the player doesn't have to scroll back to the INTRO to re-read them
                while answering questions. Read-only; no interaction. */}
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
                {verifiedFacts.map((fact, index) => (
                  <li key={index} className="flex gap-2 items-start">
                    <span className="font-bold text-[#8B2626] shrink-0">
                      {index + 1}.
                    </span>
                    <span>{fact}.</span>
                  </li>
                ))}
                {verifiedFacts.length === 0 && (
                  <li className="text-[#7C6560] text-center italic py-2 text-[11px]">
                    Compiling informational facts directly from payload
                    metrics...
                  </li>
                )}
              </ol>
            </div>

            <div className="bg-[#FAF8F5] border border-[#D9CDB3] p-4 shadow-[4px_4px_0px_rgba(217,205,179,0.4)] rounded-sm space-y-3">
              <label className="text-[12px] font-medium text-[#3A221D] block">
                Now write your own subjective interpretation. What do you think
                about this event?
              </label>
              <div className="relative">
                {/* field-sizing-fixed: shadcn Textarea base includes field-sizing-content which auto-expands against h-32.
                    focus-visible:ring-0: shadcn base also applies a 3px gray ring on keyboard focus — suppressed here. */}
                <Textarea
                  value={takeawayText}
                  onChange={(e) => setTakeawayText(e.target.value)}
                  placeholder="In my opinion, this event shows that...&#10;I believe the key issue is...&#10;My perspective is..."
                  className="w-full h-32 bg-[#FAF8F5] border-2 border-[#3A221D] p-3 text-[13px] font-mono leading-relaxed placeholder:text-[#3A221D]/30 text-[#3A221D] rounded-sm focus:outline-none focus:ring-2 focus:ring-[#8B2626]/20 focus-visible:ring-0 focus-visible:border-[#3A221D] field-sizing-fixed resize-none shadow-inner"
                />
                <div className="absolute bottom-2.5 right-3 text-[9px] font-bold px-1.5 py-0.5 rounded-xs bg-[#1C261F] text-[#42F56C] border border-[#2D3B31]">
                  {takeawayWordCount} / 10 WORDS
                </div>
              </div>
              <p className="text-[11px] font-medium leading-tight text-[#8B2626]">
                This is your space for opinions and emotions – clearly separate
                from facts above.
              </p>
            </div>
          </div>
        )}

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
                        {!isUserCorrect && (
                          <p className="text-[#7C6560] leading-normal text-[11px]">
                            Correct:{" "}
                            <span className="font-bold text-[#22C55E]">
                              {String.fromCharCode(65 + q.correct_answer_index)}
                              . {q.options[q.correct_answer_index]}
                            </span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 text-xs font-bold">
                {/* TAKEAWAY DEPTH: ≥20 words = "DETAILED", fewer = "BRIEF".
                    The 10-word minimum already passed to reach this screen;
                    20 words is a second, higher tier for display only. */}
                <div className="flex justify-between items-center bg-[#FAF8F5] border border-[#D9CDB3] p-2.5 rounded-sm">
                  <span>TAKEAWAY DEPTH:</span>
                  <span className="text-[#8B2626]">
                    ⊙ {takeawayWordCount >= 20 ? "DETAILED" : "BRIEF"}
                  </span>
                </div>
                {/* BIAS RECOGNITION: binary label — "EXCELLENT" only when every
                    MCQ was answered correctly, otherwise "IMPROVING". */}
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
                {/* padStart(3, "0") gives terminal-style zero-padded display: 007, 042, 120 */}
                <span className="text-2xl font-black tracking-widest text-[#42F56C] block">
                  {String(finalComputedScore).padStart(3, "0")}
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

      {/* Footer is absolute so it overlays the scrollable <main> without pushing it.
          The linear gradient fades from opaque at the bottom to transparent at the
          top, making the button appear to float above the scrollable content. */}
      <footer className="absolute bottom-0 inset-x-0 bg-linear-to-t from-[#FAF6F0] via-[#FAF6F0] to-[#FAF6F0]/0 px-6 pb-6 pt-8 z-20 flex justify-center">
        {phase === "INTRO" && (
          <button
            onClick={() => {
              // GAME_START fires here — after the player has read the narratives
              // and is actively choosing to begin the quiz, not on page load.
              logFunnelEvent(
                "GAME_START",
                deviceIdRef.current,
                "EXTRACT_THE_FACTS",
              );
              setPhase("QUIZ");
            }}
            className="w-full max-w-md py-3.5 bg-[#8B2626] text-white font-extrabold text-xs tracking-widest uppercase rounded-sm shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75 transition-all"
          >
            Start Questions
          </button>
        )}

        {phase === "QUIZ" && (
          // pointer-events-none disables click events at the CSS level without
          // the browser's native disabled styling — keeps visual control fully
          // in Tailwind rather than fighting the UA stylesheet.
          <button
            disabled={!isCurrentQuizAnswered}
            onClick={() =>
              isLastQuestion
                ? setPhase("TAKEAWAY")
                : setCurrentQuizIndex((prev) => prev + 1)
            }
            className={`w-full max-w-md py-3.5 font-extrabold text-xs tracking-widest uppercase rounded-sm transition-all ${
              isCurrentQuizAnswered
                ? "bg-[#8B2626] text-white shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75"
                : "bg-[#8B2626]/30 text-[#8B2626]/40 cursor-not-allowed pointer-events-none"
            }`}
          >
            {isLastQuestion ? "Continue" : "Next Question"}
          </button>
        )}

        {phase === "TAKEAWAY" && (
          <button
            disabled={!isTakeawayValid}
            onClick={() => setPhase("METRICS")}
            className={`w-full max-w-md py-3.5 font-extrabold text-xs tracking-widest uppercase rounded-sm transition-all ${
              isTakeawayValid
                ? "bg-[#8B2626] text-white shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75"
                : "bg-[#8B2626]/30 text-[#8B2626]/40 cursor-not-allowed pointer-events-none"
            }`}
          >
            View Results
          </button>
        )}

        {phase === "METRICS" && (
          <button
            disabled={isSubmittingDb}
            onClick={handleMetricsCompletionSubmit}
            className="w-full max-w-md py-3.5 bg-[#8B2626] text-white font-extrabold text-xs tracking-widest uppercase rounded-sm shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75 transition-all flex items-center justify-center gap-2"
          >
            {isSubmittingDb ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>SYNCING RECORDS...</span>
              </>
            ) : (
              <span>Continue</span>
            )}
          </button>
        )}

        {phase === "COMPLETE" && (
          <button
            onClick={handleBackToHome}
            className="w-full max-w-md py-3.5 bg-[#8B2626] text-white font-extrabold text-xs tracking-widest uppercase rounded-sm shadow-[4px_4px_0px_#4A1212] hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0px_#4A1212] active:translate-x-0.75 active:translate-y-0.75 transition-all"
          >
            Continue
          </button>
        )}
      </footer>
    </GameShell>
  );
};

export default ExtractFactsPage;

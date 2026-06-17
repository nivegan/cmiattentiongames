"use client";
// mental_reflex/page.tsx
// The Mental Reflex game — a cognitive-flexibility / response-inhibition test.
//
// All game content is generated CLIENT-SIDE from today's IST date via a single
// seeded PRNG. No server call is needed for game data (only for the daily-lock
// check). Two players on the same day get an IDENTICAL game (targets, the full
// falling-object schedule, order) — it only changes at the IST day boundary.
//
// GAME STRUCTURE:
//   4 rounds × 20 s of play. A 5 s gap between rounds (not before R1 / after R4),
//   during which a Sonner toast warns the rules are about to change. One object
//   falls at a time; tap it if it matches the round's rule, let it fall if not.
//
//   Round 1 — COLOR_MATCH   : "Tap the {COLOR} shapes"  (match by color)
//   Round 2 — SHAPE_EXCLUDE : "Tap what is NOT a {SHAPE}" (match by shape ≠ target)
//   Round 3 — STROOP_WORD   : "Tap the word {WORD}"     (match by text, ignore ink)
//   Round 4 — STROOP_INK    : "Tap the {COLOR} ink"     (match by ink, ignore text)
//
// SCORING (pooled across all rounds, 0–100):
//   Score = Max(0, Min(100, round((correctTaps − WRONG_TAP_WEIGHT·wrongTaps) / ELITE_BENCHMARK × 100)))
//
// GAME PHASES: WELCOME → PLAYING → SAVING → RESULTS
//
// WHY requestAnimationFrame (RAF)? The fall animation runs at 60 fps. Mutating
// the falling element's transform via a ref avoids 60 re-renders/sec. React
// state is only updated at low frequency (item spawn/resolve, ~200 ms HUD ticks).

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast, Toaster } from "sonner";
import { checkAlreadyPlayed } from "./actions";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { GameErrorScreen } from "@/components/GameErrorScreen";
import { useRouter } from "next/navigation";
import { GameShell } from "@/components/GameShell";
import { saveUserGameStat } from "@/utils/saveUserGameStat";
import { logFunnelEvent } from "@/utils/logFunnelEvent";
import { useDeviceId } from "@/hooks/useDeviceId";
import { getTodayIST, getDailySeed, mulberry32 } from "@/utils/seedRng";

// ── Tunable config ──────────────────────────────────────────────────────────
// All single-line constants so timing / difficulty can be adjusted later.

const ROUND_COUNT = 4;
const ROUND_DURATION_SEC = 20; // play time per round
const TOTAL_DURATION_SEC = ROUND_COUNT * ROUND_DURATION_SEC; // global countdown (play time only)
const GAP_BETWEEN_ROUNDS_SEC = 5; // intermission between rounds (toast warns of rule change)
// Fall is STEPPED (tetris-style): the object drops FALL_STEP_PX pixels, then
// holds still for FALL_STEP_INTERVAL_SEC, then drops again — repeat until it
// exits the bottom. Effective speed ≈ FALL_STEP_PX / FALL_STEP_INTERVAL_SEC.
// Tune these two to make objects fall faster/slower or stutter more/less.
const FALL_STEP_PX = 10; // pixels the object drops per step
const FALL_STEP_INTERVAL_SEC = 0.1; // pause between steps
const SPAWN_GAP_MS = 350; // pause after an object resolves before the next spawns
const ITEMS_PER_ROUND = 16; // precomputed pool per round (more than can fit in 20 s)
const ELITE_BENCHMARK = 24; // correct-tap count that maps to a perfect 100
const WRONG_TAP_WEIGHT = 1; // each wrong tap cancels this many correct taps
const MATCH_PROB = 0.55; // share of falling objects that match the rule
const ITEM_SIZE = 60; // px — shape box size / word line-height box

// Changeable palettes — every round rule derives from these, nothing hardcoded.
const GAME_COLORS = [
  { key: "RED", hex: "#C62828" },
  { key: "GREEN", hex: "#2E7D32" },
  { key: "BLUE", hex: "#1565C0" },
] as const;
const GAME_SHAPES = ["SQUARE", "CIRCLE", "TRIANGLE", "PENTAGON"] as const;

type ColorKey = (typeof GAME_COLORS)[number]["key"];
type ShapeKey = (typeof GAME_SHAPES)[number];
const colorHex = (key: ColorKey): string =>
  GAME_COLORS.find((c) => c.key === key)!.hex;

// CSS clip-path polygons for the non-trivial shapes (square = plain box).
const SHAPE_CLIP: Record<ShapeKey, string | undefined> = {
  SQUARE: undefined,
  CIRCLE: undefined, // rendered via border-radius
  TRIANGLE: "polygon(50% 0%, 0% 100%, 100% 100%)",
  PENTAGON: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
};

// ── Types ──────────────────────────────────────────────────────────────────

type GamePhase = "WELCOME" | "PLAYING" | "SAVING" | "RESULTS";
type RuleKind = "COLOR_MATCH" | "SHAPE_EXCLUDE" | "STROOP_WORD" | "STROOP_INK";

// One falling object. Shape rounds use {shape, colorKey}; Stroop rounds use
// {word, ink}. `isMatch` is precomputed against the round's rule.
interface ItemData {
  shape?: ShapeKey;
  colorKey?: ColorKey; // fill color (shape rounds)
  word?: ColorKey; // text (Stroop rounds)
  ink?: ColorKey; // ink color (Stroop rounds)
  isMatch: boolean;
  xFrac: number; // 0–1 horizontal position fraction
}

interface RoundDef {
  kind: RuleKind;
  target: string; // ColorKey / ShapeKey / word, depending on kind
  items: ItemData[];
}

type GameData = ReturnType<typeof computeGameData>;

// ── Daily content generation — FULLY DETERMINISTIC per IST day ───────────────
// Everything below flows from the single seeded `rng`. No Math.random anywhere.

const computeGameData = () => {
  const today = getTodayIST();
  const rng = mulberry32(getDailySeed(today + "mental_reflex"));

  const pick = <T,>(arr: readonly T[]): T =>
    arr[Math.floor(rng() * arr.length)];
  const otherColor = (exclude: ColorKey): ColorKey =>
    pick(GAME_COLORS.filter((c) => c.key !== exclude)).key;
  const otherShape = (exclude: ShapeKey): ShapeKey =>
    pick(GAME_SHAPES.filter((s) => s !== exclude));

  const rounds: RoundDef[] = [];

  // Round 1 — COLOR_MATCH: mixed-color shapes; tap the target color.
  {
    const target = pick(GAME_COLORS).key;
    const items: ItemData[] = [];
    for (let i = 0; i < ITEMS_PER_ROUND; i++) {
      const wantMatch = rng() < MATCH_PROB;
      const colorKey = wantMatch ? target : otherColor(target);
      items.push({
        shape: pick(GAME_SHAPES),
        colorKey,
        isMatch: colorKey === target,
        xFrac: rng(),
      });
    }
    rounds.push({ kind: "COLOR_MATCH", target, items });
  }

  // Round 2 — SHAPE_EXCLUDE: tap anything that is NOT the target shape.
  {
    const target = pick(GAME_SHAPES);
    const items: ItemData[] = [];
    for (let i = 0; i < ITEMS_PER_ROUND; i++) {
      const wantMatch = rng() < MATCH_PROB; // match = NOT the target shape
      const shape = wantMatch ? otherShape(target) : target;
      items.push({
        shape,
        colorKey: pick(GAME_COLORS).key, // color is irrelevant here, just variety
        isMatch: shape !== target,
        xFrac: rng(),
      });
    }
    rounds.push({ kind: "SHAPE_EXCLUDE", target, items });
  }

  // Round 3 — STROOP_WORD: color names in random ink; tap by TEXT == target.
  {
    const target = pick(GAME_COLORS).key;
    const items: ItemData[] = [];
    for (let i = 0; i < ITEMS_PER_ROUND; i++) {
      const wantMatch = rng() < MATCH_PROB;
      const word = wantMatch ? target : otherColor(target);
      items.push({
        word,
        ink: pick(GAME_COLORS).key, // ink random & independent of text
        isMatch: word === target,
        xFrac: rng(),
      });
    }
    rounds.push({ kind: "STROOP_WORD", target, items });
  }

  // Round 4 — STROOP_INK: color names in random ink; tap by INK == target.
  {
    const target = pick(GAME_COLORS).key;
    const items: ItemData[] = [];
    for (let i = 0; i < ITEMS_PER_ROUND; i++) {
      const wantMatch = rng() < MATCH_PROB;
      const ink = wantMatch ? target : otherColor(target);
      items.push({
        word: pick(GAME_COLORS).key, // text random & independent of ink
        ink,
        isMatch: ink === target,
        xFrac: rng(),
      });
    }
    rounds.push({ kind: "STROOP_INK", target, items });
  }

  return { rounds };
};

// Plain-text rule (used in the round-change toast).
const plainBanner = (round: RoundDef): string => {
  switch (round.kind) {
    case "COLOR_MATCH":
      return `Tap the ${round.target} shapes`;
    case "SHAPE_EXCLUDE":
      return `Tap what is NOT a ${round.target}`;
    case "STROOP_WORD":
      return `Tap the word ${round.target}`;
    case "STROOP_INK":
      return `Tap the ${round.target} ink`;
  }
};

// ── Mutable game state (lives in a ref, mutated by the RAF loop) ─────────────

interface GameState {
  roundIndex: number; // 0..ROUND_COUNT-1
  roundTimeLeft: number; // seconds left in the current round
  playElapsed: number; // accumulated PLAY time (drives the global countdown)
  inGap: boolean; // true during the inter-round intermission
  gapTimeLeft: number; // seconds left in the current gap
  item: (ItemData & { y: number; stepTimer: number; resolved: boolean }) | null; // y = px descended from the spawn point; stepTimer = sec to next step
  itemIndex: number; // next item to spawn within the current round
  spawnTimer: number; // seconds until the next spawn (when no item is active)
  correctTaps: number; // pooled across all rounds
  wrongTaps: number;
  lastFrame: number;
  lastDisplay: number;
  areaWidth: number;
  areaHeight: number;
  active: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

const MentalReflexPage = () => {
  const router = useRouter();
  const data = useMemo<GameData>(() => computeGameData(), []);

  const [phase, setPhase] = useState<GamePhase>("WELCOME");
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_DURATION_SEC);
  const [displayRound, setDisplayRound] = useState(0); // round whose banner is shown
  const [isGap, setIsGap] = useState(false);
  const [gapLeft, setGapLeft] = useState(GAP_BETWEEN_ROUNDS_SEC);
  // Currently visible falling object (state so its content renders declaratively;
  // its POSITION is driven by the RAF loop via itemRef, not React).
  const [currentItem, setCurrentItem] = useState<ItemData | null>(null);
  const [itemX, setItemX] = useState(0);
  const [result, setResult] = useState({ score: 0, correct: 0, wrong: 0 });

  const deviceIdRef = useDeviceId();
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isError, setIsError] = useState(false);

  const gameAreaRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const gs = useRef<GameState | null>(null);

  // Stops the RAF loop.
  const stopGame = useCallback(() => {
    if (gs.current) gs.current.active = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Computes the pooled final score and transitions to SAVING.
  const endGame = useCallback(() => {
    const state = gs.current;
    if (!state) return;
    state.active = false;
    setCurrentItem(null);
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          ((state.correctTaps - WRONG_TAP_WEIGHT * state.wrongTaps) /
            ELITE_BENCHMARK) *
            100,
        ),
      ),
    );
    setResult({
      score,
      correct: state.correctTaps,
      wrong: state.wrongTaps,
    });
    setPhase("SAVING");
  }, []);

  // Spawns the next object of the current round (if any remain).
  const spawnNext = useCallback(() => {
    const state = gs.current;
    if (!state) return;
    const round = data.rounds[state.roundIndex];
    const item = round.items[state.itemIndex];
    if (!item) {
      // Round pool exhausted — wait out the remaining round time.
      state.spawnTimer = SPAWN_GAP_MS / 1000;
      return;
    }
    state.itemIndex++;
    state.item = {
      ...item,
      y: 0,
      stepTimer: FALL_STEP_INTERVAL_SEC,
      resolved: false,
    };
    const margin = 36;
    const centerX =
      margin + item.xFrac * Math.max(0, state.areaWidth - 2 * margin);
    setItemX(centerX);
    setCurrentItem(item);
  }, [data]);

  // Initialises state and starts the RAF loop.
  const startGame = useCallback(() => {
    const area = gameAreaRef.current;
    if (!area) return;

    gs.current = {
      roundIndex: 0,
      roundTimeLeft: ROUND_DURATION_SEC,
      playElapsed: 0,
      inGap: false,
      gapTimeLeft: 0,
      item: null,
      itemIndex: 0,
      spawnTimer: 0.4, // brief lead-in before the first object
      correctTaps: 0,
      wrongTaps: 0,
      lastFrame: 0,
      lastDisplay: 0,
      areaWidth: area.clientWidth,
      areaHeight: area.clientHeight,
      active: true,
    };
    setDisplayRound(0);
    setIsGap(false);

    const loop = (timestamp: number) => {
      const state = gs.current;
      if (!state?.active) return;

      if (state.lastFrame === 0) state.lastFrame = timestamp;
      // Cap dt so a backgrounded tab resuming doesn't fast-forward the game.
      const dt = Math.min((timestamp - state.lastFrame) / 1000, 0.05);
      state.lastFrame = timestamp;
      // Keep area dimensions fresh (flex layout may settle after first frame).
      state.areaWidth = area.clientWidth;
      state.areaHeight = area.clientHeight;

      if (state.inGap) {
        // ── Intermission: countdown frozen, nothing falling ──
        state.gapTimeLeft -= dt;
        if (state.gapTimeLeft <= 0) {
          state.roundIndex++;
          state.roundTimeLeft = ROUND_DURATION_SEC;
          state.itemIndex = 0;
          state.item = null;
          state.spawnTimer = 0.4;
          state.inGap = false;
          setIsGap(false);
          setDisplayRound(state.roundIndex);
          setCurrentItem(null);
        }
      } else {
        // ── Active play ──
        state.roundTimeLeft -= dt;
        state.playElapsed += dt;

        if (state.item && !state.item.resolved) {
          // Stepped descent: advance one FALL_STEP_PX hop each time the step
          // timer elapses (while-loop in case a large dt covers several steps).
          state.item.stepTimer -= dt;
          while (state.item.stepTimer <= 0) {
            state.item.y += FALL_STEP_PX;
            state.item.stepTimer += FALL_STEP_INTERVAL_SEC;
          }
          if (state.item.y >= state.areaHeight + ITEM_SIZE) {
            // Reached the bottom untapped — just disappears (no penalty).
            state.item = null;
            setCurrentItem(null);
            state.spawnTimer = SPAWN_GAP_MS / 1000;
          } else if (itemRef.current) {
            const y = -ITEM_SIZE + state.item.y;
            itemRef.current.style.transform = `translate(-50%, ${y.toFixed(1)}px)`;
          }
        } else if (!state.item) {
          state.spawnTimer -= dt;
          if (state.spawnTimer <= 0) spawnNext();
        }

        // Round boundary?
        if (state.roundTimeLeft <= 0) {
          if (state.roundIndex < ROUND_COUNT - 1) {
            state.inGap = true;
            state.gapTimeLeft = GAP_BETWEEN_ROUNDS_SEC;
            state.item = null;
            setCurrentItem(null);
            setIsGap(true);
            setGapLeft(GAP_BETWEEN_ROUNDS_SEC);
            const next = data.rounds[state.roundIndex + 1];
            toast("Rules are changing!", {
              description: `Round ${state.roundIndex + 2}: ${plainBanner(next)}`,
            });
          } else {
            endGame();
            return;
          }
        }
      }

      // Low-frequency HUD updates (~200 ms): global countdown + gap countdown.
      if (timestamp - state.lastDisplay >= 200) {
        state.lastDisplay = timestamp;
        setSecondsLeft(
          Math.max(0, Math.ceil(TOTAL_DURATION_SEC - state.playElapsed)),
        );
        if (state.inGap) setGapLeft(Math.max(0, Math.ceil(state.gapTimeLeft)));
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [data, endGame, spawnNext]);

  // Tap on a falling object: correct if it matches the rule, wrong otherwise.
  const handleItemTap = useCallback(() => {
    const state = gs.current;
    if (!state?.active || !state.item || state.item.resolved) return;
    state.item.resolved = true;
    logFunnelEvent("GAME_CLICK", deviceIdRef.current, "MENTAL_REFLEX");
    if (state.item.isMatch) state.correctTaps++;
    else state.wrongTaps++;
    state.item = null;
    setCurrentItem(null);
    state.spawnTimer = SPAWN_GAP_MS / 1000;
  }, [deviceIdRef]);

  // Start / stop the loop when entering / leaving PLAYING.
  useEffect(() => {
    if (phase === "PLAYING") {
      startGame();
      return () => stopGame();
    }
  }, [phase, startGame, stopGame]);

  // Daily-lock check on mount.
  useEffect(() => {
    const checkLock = async () => {
      try {
        const { alreadyPlayed } = await checkAlreadyPlayed(deviceIdRef.current);
        if (alreadyPlayed) router.push("/");
        else setIsChecking(false);
      } catch {
        setIsChecking(false);
        setIsError(true);
      }
    };
    checkLock();
  }, [deviceIdRef, router]);

  // Persist the score when entering SAVING.
  useEffect(() => {
    if (phase !== "SAVING") return;
    const save = async () => {
      try {
        const res = await saveUserGameStat(
          result.score,
          deviceIdRef.current,
          "MENTAL_REFLEX",
          "web_mental_reflex_v1",
        );
        if (res.error === "ALREADY_PLAYED") setAlreadyPlayed(true);
        else if (!res.success) setSaveFailed(true);
        else
          logFunnelEvent("GAME_COMPLETE", deviceIdRef.current, "MENTAL_REFLEX");
      } catch {
        setSaveFailed(true);
      } finally {
        setPhase("RESULTS");
      }
    };
    save();
  }, [deviceIdRef, phase, result.score]);

  // Cancel any pending frame on unmount.
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const handleBackToHome = () => {
    stopGame();
    router.push("/");
  };

  // ── Renderers ──────────────────────────────────────────────────────────────

  // Renders the persistent rule banner for a given round.
  const renderBanner = (round: RoundDef) => {
    const base = "text-base font-black tracking-[0.15em] text-[#8B2626]";
    switch (round.kind) {
      case "COLOR_MATCH":
        return (
          <span className={base}>
            Tap the{" "}
            <span style={{ color: colorHex(round.target as ColorKey) }}>
              {round.target}
            </span>{" "}
            shapes
          </span>
        );
      case "SHAPE_EXCLUDE":
        return <span className={base}>Tap what is NOT a {round.target}</span>;
      case "STROOP_WORD":
        return <span className={base}>Tap the word {round.target}</span>;
      case "STROOP_INK":
        return <span className={base}>Tap the {round.target} ink</span>;
    }
  };

  // Renders the visual of a falling object.
  const renderItemContent = (item: ItemData) => {
    if (item.word) {
      // Stroop rounds: a color word rendered in its ink color.
      return (
        <span
          className="font-black tracking-widest leading-none select-none"
          style={{ color: colorHex(item.ink!), fontSize: 34 }}
        >
          {item.word}
        </span>
      );
    }
    // Shape rounds: a colored shape.
    const shape = item.shape!;
    return (
      <div
        style={{
          width: ITEM_SIZE,
          height: ITEM_SIZE,
          backgroundColor: colorHex(item.colorKey!),
          borderRadius: shape === "CIRCLE" ? "50%" : 0,
          clipPath: SHAPE_CLIP[shape],
        }}
      />
    );
  };

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (isChecking) return <GameLoadingScreen />;
  if (isError) return <GameErrorScreen />;

  const headerTimer = (
    <span className="inline-block bg-[#232323] text-[#00FF33] font-bold text-xs px-3 py-1 border border-[#232323] tracking-widest tabular-nums">
      {secondsLeft}s
    </span>
  );

  return (
    <GameShell
      title={phase === "PLAYING" ? headerTimer : "MENTAL REFLEX"}
      onBack={handleBackToHome}
    >
      <Toaster position="top-center" richColors />
      <AnimatePresence>
        {phase === "WELCOME" && (
          <motion.main
            key="welcome"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="flex-1 overflow-y-auto px-6 py-4 flex flex-col justify-center min-h-0 pb-24"
          >
            <div className="space-y-6">
              <div className="bg-[#FAF6F0] border border-[#232323]/30 p-5 shadow-[4px_4px_0px_#232323]">
                <p className="text-sm leading-relaxed text-[#232323] mb-5">
                  Stay sharp as the rules flip on you. Objects fall one at a
                  time — tap only the ones that match the current rule, ignore
                  the rest.
                </p>
                <div className="space-y-2 text-[11px]">
                  {[
                    {
                      label: "ROUNDS",
                      value: `${ROUND_COUNT} × ${ROUND_DURATION_SEC}s`,
                    },
                    { label: "GOAL", value: "Tap matches, suppress the rest" },
                    { label: "WATCH", value: "The rule changes every round" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-1.5">
                      <span className="font-bold text-[#8B2626] uppercase w-20 inline-block shrink-0">
                        {label}:
                      </span>
                      <span className="text-[#232323]">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  logFunnelEvent(
                    "GAME_START",
                    deviceIdRef.current,
                    "MENTAL_REFLEX",
                  );
                  setPhase("PLAYING");
                }}
                className="w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 border border-[#232323]"
              >
                BEGIN TEST
              </button>
            </div>
          </motion.main>
        )}

        {phase === "PLAYING" && (
          <motion.div
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="flex-1 min-h-0 flex flex-col"
          >
            {/* Persistent rule banner — raised panel with inset border */}
            <div className="px-4 pt-1 pb-3 shrink-0">
              <div className="relative bg-[#FAF6F0] border border-[#232323] shadow-[4px_4px_0px_#232323] px-4 py-4 text-center">
                <div className="absolute inset-1 border border-[#232323]/20 pointer-events-none" />
                <span className="absolute top-1.5 left-2 text-[8px] font-black tracking-widest text-[#232323]/40 uppercase">
                  R{displayRound + 1}/{ROUND_COUNT}
                </span>
                {renderBanner(data.rounds[displayRound])}
              </div>
            </div>

            {/* Play area — single falling object */}
            <div
              ref={gameAreaRef}
              className="flex-1 relative overflow-hidden bg-[#FAF6F0]"
            >
              {currentItem && !isGap && (
                <div
                  ref={itemRef}
                  onClick={handleItemTap}
                  className="absolute top-0 flex items-center justify-center cursor-pointer"
                  style={{
                    left: itemX,
                    minWidth: ITEM_SIZE,
                    height: ITEM_SIZE,
                    transform: `translate(-50%, ${-ITEM_SIZE}px)`,
                  }}
                >
                  {renderItemContent(currentItem)}
                </div>
              )}

              {isGap && (
                <motion.div
                  key="gap"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#FAF6F0] px-6 text-center"
                >
                  <p className="text-[11px] font-black tracking-widest text-[#8B2626] uppercase">
                    Rules Changing
                  </p>
                  <div className="bg-[#232323] text-[#00FF33] font-black text-3xl px-5 py-2 border border-[#232323] tabular-nums">
                    {gapLeft}
                  </div>
                  {displayRound + 1 < ROUND_COUNT && (
                    <div className="pt-1">
                      <p className="text-[8px] font-black tracking-widest text-[#232323]/40 uppercase mb-1">
                        Next
                      </p>
                      {renderBanner(data.rounds[displayRound + 1])}
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {phase === "SAVING" && (
          <motion.main
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center gap-4"
          >
            <Loader2 className="w-8 h-8 animate-spin text-[#8B2626]" />
            <p className="text-xs font-black tracking-widest text-[#8B2626] uppercase">
              SYNCING RECORDS...
            </p>
          </motion.main>
        )}

        {phase === "RESULTS" && (
          <motion.main
            key="results"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto px-6 py-4 flex flex-col justify-center min-h-0 pb-24"
          >
            <div className="space-y-5">
              <div className="text-center space-y-1">
                <h2 className="text-[11px] font-black tracking-widest text-[#8B2626] uppercase">
                  SESSION COMPLETE
                </h2>
                {alreadyPlayed && (
                  <p className="text-[9px] font-bold tracking-wider text-[#232323]/50 uppercase">
                    Score not saved — already played today
                  </p>
                )}
                {saveFailed && (
                  <p className="text-[9px] font-bold tracking-wider text-[#232323]/50 uppercase">
                    Score not saved — sync failed
                  </p>
                )}
              </div>

              <div className="border border-[#232323] bg-[#FAF6F0] p-4 shadow-[5px_5px_0px_#232323] outline-double outline-4 outline-[#FAF6F0] space-y-4">
                <div className="bg-[#232323] p-4 text-center border border-[#3A3A3A]">
                  <span className="text-[9px] font-black text-[#00FF33]/60 tracking-widest block uppercase mb-1">
                    REFLEX SCORE
                  </span>
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                    className="text-2xl font-black tracking-widest text-[#00FF33] block"
                  >
                    {result.score}/100
                  </motion.span>
                </div>

                <div className="space-y-2 border border-[#232323]/20 p-3 text-[10px] font-black tracking-wider">
                  {[
                    {
                      label: "CORRECT TAPS",
                      value: String(result.correct),
                      accent: true,
                    },
                    {
                      label: "WRONG TAPS",
                      value: String(result.wrong),
                      accent: result.wrong > 0,
                    },
                  ].map((row, i) => (
                    <motion.div
                      key={row.label}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 * i }}
                      className="flex justify-between"
                    >
                      <span>{row.label}:</span>
                      <span
                        className={
                          row.accent ? "text-[#8B2626]" : "text-[#232323]"
                        }
                      >
                        {row.value}
                      </span>
                    </motion.div>
                  ))}
                  <div className="h-2 bg-[#232323]/10 border p-px mt-1">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${result.score}%` }}
                      transition={{
                        delay: 0.2,
                        duration: 0.5,
                        ease: "easeOut",
                      }}
                      className="h-full bg-[#8B2626]"
                    />
                  </div>
                </div>

                <div className="flex justify-between border border-[#232323]/20 p-2.5 text-[10px] font-black tracking-wider">
                  <span>PERFORMANCE:</span>
                  <span className="text-[#8B2626]">
                    {result.score >= 80
                      ? "✓ EXCELLENT"
                      : result.score >= 55
                        ? "✓ GOOD"
                        : result.score >= 30
                          ? "~ FAIR"
                          : "✗ NEEDS WORK"}
                  </span>
                </div>
              </div>

              <button
                onClick={handleBackToHome}
                className="w-full py-3.5 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase border border-[#232323] shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5"
              >
                CONTINUE
              </button>
            </div>
          </motion.main>
        )}
      </AnimatePresence>
    </GameShell>
  );
};

export default MentalReflexPage;

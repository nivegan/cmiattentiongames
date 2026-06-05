"use client";
// clear_the_air/page.tsx
// The Clear the Air game — a 60-second canvas-based bubble-clearing game.
//
// All game content is generated CLIENT-SIDE from today's IST date (no server
// content fetch, only a daily-lock check). The game loop runs on a <canvas>
// element via requestAnimationFrame.
//
// GAME MECHANICS:
//   - Gray squares (distractions) spawn, grow, and bounce — click to clear (+points)
//   - Red diamonds (focus) spawn, grow, and bounce — clicking one = lose a life
//   - 3 lives total; clicking the 3rd red diamond ends the game immediately
//   - Bubbles auto-burst when they reach BUBBLE_MAX_SIZE (−25 pts each)
//   - Adaptive spawn rate: performing well → faster spawns; poorly → slower
//
// SCORING:
//   ratio = graysClicked / totalGraysSpawned × 100
//   Score = Max(0, round(ratio − graysAutoBurst × 25 − redsClicked × 30))
//
// GAME PHASES:
//   WELCOME  → intro with mechanics explanation
//   PLAYING  → active canvas game loop
//   SAVING   → brief screen while score is written to DB
//   RESULTS  → final score breakdown
//
// WHY CANVAS?
// This game renders dozens of moving, growing bubbles every frame. Using React
// state for each bubble would cause constant re-renders and terrible performance.
// Canvas lets us draw everything imperatively (clear → draw each bubble → done)
// without React knowing about individual bubble positions.

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type MouseEvent,
} from "react";
import { Loader2, Trophy, Zap, Target } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { checkAlreadyPlayed } from "./actions";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { GameErrorScreen } from "@/components/GameErrorScreen";
import { useRouter } from "next/navigation";
import { GameShell } from "@/components/GameShell";
import { saveUserGameStat } from "@/utils/saveUserGameStat";
import { useDeviceId } from "@/hooks/useDeviceId";
import { getTodayIST, getDailySeed, mulberry32 } from "@/utils/seedRng";

// Generates the spawn seed from today's IST date. All bubble positions and
// sequences are deterministic — same day → same game for all players.
const computeGameData = () => {
  const today = getTodayIST();
  return { spawnSeed: getDailySeed(today + "clear_air_v2") };
};

// ── Constants ──────────────────────────────────────────────────────────────

type GamePhase = "WELCOME" | "PLAYING" | "SAVING" | "RESULTS";
// "distraction" = gray square (tap to score), "focus" = red diamond (avoid)
type BubbleType = "distraction" | "focus";

const GAME_DURATION = 60;          // seconds
const MAX_LIVES = 3;               // red diamond hits before game over
const BUBBLE_START_SIZE = 3;       // starting half-side in px (bubbles start tiny)
const BUBBLE_MAX_SIZE = 46;        // half-side px at which a bubble auto-bursts
const BUBBLE_GROWTH_BASE = 5.5;    // px per second growth rate (base)
const SPAWN_INTERVAL_BASE = 1.6;   // seconds between spawns at neutral performance
const MAX_DENSITY = 18;            // maximum live bubbles on screen at once
const DISTRACTION_RATIO = 0.65;    // 65% gray, 35% red
const BUBBLE_SPEED_BASE = 38;      // px per second movement speed (base)
const PERF_WINDOW = 10;            // rolling window size for adaptive difficulty

const DISTRACTION_COLOR = "#9E9E9E"; // gray bubble fill
const FOCUS_COLOR = "#8B2626";        // red diamond fill

// ── Types ──────────────────────────────────────────────────────────────────

// One bubble in the game world
interface Bubble {
  id: number;
  type: BubbleType;
  x: number;           // centre X position in canvas coordinates
  y: number;           // centre Y position
  vx: number;          // velocity in px/sec (horizontal)
  vy: number;          // velocity in px/sec (vertical)
  size: number;        // current half-side in px (grows each frame)
  growthRate: number;  // px per second this bubble grows
  alive: boolean;      // false when clicked or auto-burst (removed next cleanup)
}

// Full mutable game state — lives in a ref (gs.current), mutated by the RAF loop.
// React state is only updated for HUD values (timer, score, lives) every 200 ms.
interface GameState {
  bubbles: Bubble[];
  nextId: number;          // incrementing ID counter for new bubbles
  hits: number;            // gray bubbles clicked
  penalties: number;       // red bubbles clicked (lives lost)
  livesLeft: number;       // remaining lives
  timeLeft: number;        // seconds remaining
  spawnTimer: number;      // seconds until the next bubble spawns
  lastFrame: number;       // timestamp of the previous RAF frame (ms)
  lastDisplay: number;     // last time the HUD React state was refreshed (ms)
  active: boolean;         // set to false to stop the loop
  rng: () => number;       // seeded PRNG for deterministic positions
  w: number;               // canvas width in px
  h: number;               // canvas height in px
  ctx: CanvasRenderingContext2D; // canvas 2D rendering context
  perfWindow: number[];    // rolling array of recent outcomes: 1=good, 0=bad
  totalGrays: number;      // total gray bubbles spawned (denominator for score ratio)
  graysAutoBurst: number;  // gray bubbles that grew to max without being clicked
}

// Adjusts the spawn interval based on recent performance.
// Good play (hit rate > 60%) → shorter interval → faster spawns (harder).
// Poor play (hit rate < 30%) → longer interval → slower spawns (easier).
const adaptiveSpawnInterval = (perfWindow: number[]): number => {
  if (perfWindow.length === 0) return SPAWN_INTERVAL_BASE;
  const rate = perfWindow.reduce((a, b) => a + b, 0) / perfWindow.length;
  const factor = rate > 0.6 ? 0.7 : rate < 0.3 ? 1.6 : 1.0;
  return SPAWN_INTERVAL_BASE * factor;
};

// ── Component ──────────────────────────────────────────────────────────────

const ClearTheAirPage = () => {
  const router = useRouter();
  // computeGameData() is memoized — only runs once, returns stable spawnSeed
  const data = useMemo(() => computeGameData(), []);
  const [phase, setPhase] = useState<GamePhase>("WELCOME");

  // HUD display values — updated from the RAF loop every 200 ms to avoid
  // calling setState 60 times per second.
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [cleared, setCleared] = useState(0);        // gray bubbles clicked
  const [livesLeft, setLivesLeft] = useState(MAX_LIVES);
  const [displayScore, setDisplayScore] = useState(0); // live score estimate

  // Final result snapshot, set by endGame() and displayed in RESULTS
  const [result, setResult] = useState({
    score: 0,
    hits: 0,
    penalties: 0,
    totalGrays: 0,
    graysAutoBurst: 0,
  });

  const deviceIdRef = useDeviceId();
  const [alreadyPlayed, setAlreadyPlayed] = useState(false); // shown in RESULTS if true
  const [saveFailed, setSaveFailed] = useState(false);        // shown in RESULTS if true
  const [isChecking, setIsChecking] = useState(true);         // daily-lock check in flight
  const [isError, setIsError] = useState(false);              // lock check threw an error

  // Ref to the container div — used to read width/height for canvas resize
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref to the <canvas> element — the entire game renders here
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Ref holding the requestAnimationFrame ID for cleanup
  const rafRef = useRef<number | null>(null);
  // Entire live game state — mutated in-place by the RAF loop
  const gs = useRef<GameState | null>(null);

  // Clears the canvas and redraws all live bubbles.
  // Called once per RAF frame. Gray bubbles are axis-aligned squares;
  // red diamonds are the same square shape but rotated 45° via ctx.rotate().
  // Opacity fades in as size grows from 0 to 12 px (smooth appear animation).
  const drawFrame = useCallback(() => {
    const state = gs.current;
    if (!state) return;
    const { ctx, w, h, bubbles } = state;
    // Clear the entire canvas before redrawing (standard canvas rendering pattern)
    ctx.clearRect(0, 0, w, h);

    for (const b of bubbles) {
      if (!b.alive || b.size <= 0) continue;
      const s = b.size;
      // alpha ramps from 0 to 1 as size grows from 0 to 12 px — natural fade-in
      const alpha = Math.min(1, s / 12);

      ctx.save(); // save the current transform so restore() undoes translate/rotate
      ctx.globalAlpha = alpha;
      ctx.translate(b.x, b.y); // move origin to bubble centre

      // Red diamonds: rotate the coordinate system 45° before drawing the square.
      // The square is drawn relative to the translated origin so it appears as a diamond.
      if (b.type === "focus") ctx.rotate(Math.PI / 4);

      ctx.fillStyle = b.type === "distraction" ? DISTRACTION_COLOR : FOCUS_COLOR;
      ctx.fillRect(-s, -s, s * 2, s * 2); // draw square centred on origin

      ctx.strokeStyle = "rgba(35,35,35,0.25)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-s, -s, s * 2, s * 2); // thin border

      ctx.restore(); // undo the translate/rotate so the next bubble starts from scratch
    }
    ctx.globalAlpha = 1; // reset global alpha for any future drawing
  }, []);

  const stopGame = useCallback(() => {
    if (gs.current) gs.current.active = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const endGame = useCallback((state: GameState) => {
    state.active = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const ratio = state.totalGrays > 0 ? (state.hits / state.totalGrays) * 100 : 0;
    const finalScore = Math.max(
      0,
      Math.round(ratio - state.graysAutoBurst * 25 - state.penalties * 30),
    );
    setResult({
      score: finalScore,
      hits: state.hits,
      penalties: state.penalties,
      totalGrays: state.totalGrays,
      graysAutoBurst: state.graysAutoBurst,
    });
    setPhase("SAVING");
  }, []);

  const spawnBubble = useCallback(() => {
    const state = gs.current;
    if (!state) return;
    const { rng, w, h } = state;

    const type: BubbleType = rng() < DISTRACTION_RATIO ? "distraction" : "focus";
    const spd = BUBBLE_SPEED_BASE * (0.5 + rng() * 1.0);
    const growthRate = BUBBLE_GROWTH_BASE * (0.7 + rng() * 0.7);
    const angle = rng() * Math.PI * 2;

    // Spawn randomly inside canvas (bubbles grow from tiny so they appear gradually)
    const margin = 30;
    const x = margin + rng() * (w - margin * 2);
    const y = margin + rng() * (h - margin * 2);

    if (type === "distraction") state.totalGrays++;

    state.bubbles.push({
      id: state.nextId++,
      type,
      x,
      y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      size: BUBBLE_START_SIZE,
      growthRate,
      alive: true,
    });
  }, []);

  const startGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    gs.current = {
      bubbles: [],
      nextId: 0,
      hits: 0,
      penalties: 0,
      livesLeft: MAX_LIVES,
      timeLeft: GAME_DURATION,
      spawnTimer: 0,
      lastFrame: 0,
      lastDisplay: 0,
      active: true,
      rng: mulberry32(data.spawnSeed),
      w: 1,
      h: 1,
      ctx,
      perfWindow: [],
      totalGrays: 0,
      graysAutoBurst: 0,
    };

    const loop = (ts: number) => {
      const state = gs.current;
      if (!state?.active) return;

      // Sync canvas size every frame so it always matches the laid-out container
      const container = containerRef.current;
      if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        if (cw > 1 && ch > 1 && (canvas.width !== cw || canvas.height !== ch)) {
          canvas.width = cw;
          canvas.height = ch;
          state.w = cw;
          state.h = ch;
        }
      }

      if (state.lastFrame === 0) state.lastFrame = ts;
      const dt = Math.min((ts - state.lastFrame) / 1000, 0.05);
      state.lastFrame = ts;

      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        endGame(state);
        return;
      }

      // Spawn
      state.spawnTimer -= dt;
      const live = state.bubbles.filter((b) => b.alive).length;
      if (state.spawnTimer <= 0 && live < MAX_DENSITY) {
        spawnBubble();
        state.spawnTimer = adaptiveSpawnInterval(state.perfWindow);
      }

      // Update
      for (const b of state.bubbles) {
        if (!b.alive) continue;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.size += b.growthRate * dt;

        if (b.size >= BUBBLE_MAX_SIZE) {
          b.alive = false;
          if (b.type === "distraction") state.graysAutoBurst++;
          state.perfWindow.push(0);
          if (state.perfWindow.length > PERF_WINDOW) state.perfWindow.shift();
          continue;
        }

        // Bounce off canvas walls
        const s = b.size;
        if (b.x - s < 0) { b.x = s; b.vx = Math.abs(b.vx); }
        else if (b.x + s > state.w) { b.x = state.w - s; b.vx = -Math.abs(b.vx); }
        if (b.y - s < 0) { b.y = s; b.vy = Math.abs(b.vy); }
        else if (b.y + s > state.h) { b.y = state.h - s; b.vy = -Math.abs(b.vy); }
      }

      if (state.bubbles.length > 200) {
        state.bubbles = state.bubbles.filter((b) => b.alive);
      }

      drawFrame();

      if (ts - state.lastDisplay >= 200) {
        state.lastDisplay = ts;
        setTimeLeft(Math.ceil(state.timeLeft));
        setCleared(state.hits);
        const ratio = state.totalGrays > 0 ? (state.hits / state.totalGrays) * 100 : 0;
        setDisplayScore(
          Math.max(0, Math.round(ratio - state.graysAutoBurst * 25 - state.penalties * 30)),
        );
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [data, endGame, spawnBubble, drawFrame]);

  // Handles clicks on the canvas. Checks all live bubbles in reverse order
  // (so the topmost/most-recently-drawn bubble gets priority) for a hit.
  //
  // HIT TESTING:
  //   Gray squares: AABB test — |dx| ≤ s AND |dy| ≤ s
  //   Red diamonds: rotate the click offset by −45° then apply the same AABB test.
  //     The diamond is just a square drawn with a 45° rotation. To test a click
  //     against it, we un-rotate the click coordinates by −45° and test against
  //     the underlying un-rotated square. Math.SQRT1_2 = cos(45°) = sin(45°) ≈ 0.707.
  //
  // Scaling: canvas.width/rect.width accounts for CSS vs physical canvas size.
  // The canvas element might be 400 px wide in CSS but 800 px wide in canvas coords
  // (for high-DPI screens). We scale the click position accordingly.
  const handleCanvasClick = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const state = gs.current;
      if (!state?.active) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      // rect = canvas position and size in CSS pixels
      const rect = canvas.getBoundingClientRect();
      // Convert click from CSS pixels to canvas pixels
      const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const cy = (e.clientY - rect.top) * (canvas.height / rect.height);

      // Only check live bubbles; iterate newest-first (highest z-order first)
      const live = state.bubbles.filter((b) => b.alive);
      for (let i = live.length - 1; i >= 0; i--) {
        const b = live[i];
        const dx = cx - b.x; // horizontal distance from click to bubble centre
        const dy = cy - b.y; // vertical distance
        const s = b.size;
        let hit = false;

        if (b.type === "distraction") {
          // Gray square: axis-aligned bounding box (AABB) test
          hit = Math.abs(dx) <= s && Math.abs(dy) <= s;
        } else {
          // Red diamond: un-rotate the click by −45° then AABB-test the underlying square.
          // Math.SQRT1_2 = 1/√2 ≈ 0.707 = cos(45°) = sin(45°)
          const c45 = Math.SQRT1_2;
          const rx = dx * c45 + dy * c45;  // rotated x
          const ry = -dx * c45 + dy * c45; // rotated y
          hit = Math.abs(rx) <= s && Math.abs(ry) <= s;
        }

        if (hit) {
          b.alive = false;
          if (b.type === "distraction") {
            state.hits++;
            state.perfWindow.push(1); // good outcome
            setCleared(state.hits);   // update HUD
          } else {
            // Red diamond hit — lose a life
            state.penalties++;
            state.livesLeft--;
            state.perfWindow.push(0); // bad outcome
            setLivesLeft(state.livesLeft);
            if (state.livesLeft <= 0) {
              endGame(state); // third red hit = game over immediately
              return;
            }
          }
          // Keep the performance window at most PERF_WINDOW entries
          if (state.perfWindow.length > PERF_WINDOW) state.perfWindow.shift();
          return; // stop at the first hit bubble (don't process clicks through stacked bubbles)
        }
      }
    },
    [endGame],
  );

  // Start the canvas game loop when PLAYING begins; stop it when PLAYING ends.
  useEffect(() => {
    if (phase === "PLAYING") {
      startGame();
      return () => stopGame(); // cleanup: called when phase changes away from PLAYING
    }
  }, [phase, startGame, stopGame]);

  // On mount: check the daily lock. Redirect home if already played, show error
  // screen if the check threw, otherwise clear the loading state.
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

  // When SAVING phase begins: write the score to the DB, then always transition
  // to RESULTS regardless of success/failure.
  useEffect(() => {
    if (phase !== "SAVING") return;
    const save = async () => {
      try {
        const res = await saveUserGameStat(
          result.score,
          deviceIdRef.current,
          "CLEAR_THE_AIR",
          "web_clear_the_air_v1",
        );
        if (res.error === "ALREADY_PLAYED") setAlreadyPlayed(true);
        else if (!res.success) setSaveFailed(true);
      } catch {
        setSaveFailed(true);
      } finally {
        setPhase("RESULTS"); // always show results even if save failed
      }
    };
    save();
  }, [deviceIdRef, phase, result.score]);

  // Cleanup: cancel any pending RAF when the component unmounts to prevent
  // the loop from running after the user has navigated away.
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const handleBackToHome = () => {
    stopGame(); // cancel RAF loop before navigating
    router.push("/");
  };

  if (isChecking) return <GameLoadingScreen />;
  if (isError) return <GameErrorScreen />;

  return (
    <GameShell
      title="CLEAR THE AIR"
      onBack={handleBackToHome}
      badge={
        phase === "PLAYING" ? (
          <div className="bg-[#8B2626] text-[#FAF6F0] font-black text-[9px] px-2 py-0.5 tracking-widest border border-[#232323]">
            STAGE 1/1
          </div>
        ) : undefined
      }
    >
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
                  Eliminate distracting thought bubbles before they grow too
                  large. Stay focused — three red mistakes and it&apos;s over.
                </p>
                <div className="space-y-3 border-t border-dashed border-[#232323]/30 pt-4">
                  <div className="flex items-center gap-3 text-[11px]">
                    <div className="w-5 h-5 bg-[#9E9E9E] border border-[#232323]/40 shrink-0" />
                    <span className="font-bold text-[#232323] uppercase tracking-wide">
                      GRAY SQUARES — tap to clear (+points)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <div
                      className="w-5 h-5 bg-[#8B2626] border border-[#232323]/40 shrink-0"
                      style={{ transform: "rotate(45deg)" }}
                    />
                    <span className="font-bold text-[#232323] uppercase tracking-wide">
                      RED DIAMONDS — avoid! (lose a life)
                    </span>
                  </div>
                  <p className="text-[11px] font-bold text-[#8B2626] tracking-widest uppercase pt-1">
                    BUBBLES GROW — tap before they burst!
                  </p>
                </div>
              </div>

              <button
                onClick={() => setPhase("PLAYING")}
                className="w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 border border-[#232323]"
              >
                INSERT COIN
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
            {/* HUD: score + lives + target icon */}
            <div className="px-4 py-2 flex items-center justify-between border-b border-[#232323]/10 shrink-0">
              <div className="flex items-center gap-1.5">
                <Trophy className="w-3 h-3 text-[#8B2626]" />
                <div className="bg-[#232323] text-[#00FF33] font-black text-[9px] px-2 py-0.5 tracking-widest tabular-nums">
                  SCORE: {String(displayScore).padStart(6, "0")}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-[#8B2626]" />
                <div className="flex gap-0.5">
                  {Array.from({ length: MAX_LIVES }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3.5 h-3.5 border border-[#232323]/30 transition-colors duration-150 ${
                        i < livesLeft ? "bg-[#8B2626]" : "bg-[#232323]/15"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Target className="w-3 h-3 text-[#8B2626]" />
              </div>
            </div>

            {/* Stats row: time + cleared */}
            <div className="px-3 py-2 flex items-center justify-between shrink-0">
              <div className="bg-[#232323] text-[#00FF33] font-black text-[9px] px-3 py-1 tracking-widest tabular-nums shadow-[2px_2px_0px_#232323]">
                TIME: {String(timeLeft).padStart(2, "0")}
              </div>
              <div className="bg-[#232323] text-[#00FF33] font-black text-[9px] px-3 py-1 tracking-widest tabular-nums shadow-[2px_2px_0px_#232323]">
                CLEARED: {String(cleared).padStart(3, "0")}
              </div>
            </div>

            {/* Canvas area */}
            <div ref={containerRef} className="flex-1 relative overflow-hidden">
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="absolute inset-0 w-full h-full"
                style={{ background: "#FAF6F0", cursor: "crosshair" }}
              />
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
                    CLARITY SCORE
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
                      label: "CLEARED / TOTAL",
                      value: `${result.hits} / ${result.totalGrays}`,
                      accent: true,
                    },
                    {
                      label: "MAXED OUT (−25 each)",
                      value: String(result.graysAutoBurst),
                      accent: result.graysAutoBurst > 0,
                    },
                    {
                      label: "RED HITS (−30 each)",
                      value: String(result.penalties),
                      accent: result.penalties > 0,
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
                      <span className={row.accent ? "text-[#8B2626]" : "text-[#232323]"}>
                        {row.value}
                      </span>
                    </motion.div>
                  ))}
                  <div className="h-2 bg-[#232323]/10 border p-px mt-1">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${result.score}%` }}
                      transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
                      className="h-full bg-[#8B2626]"
                    />
                  </div>
                </div>

                <div className="flex justify-between border border-[#232323]/20 p-2.5 text-[10px] font-black tracking-wider">
                  <span>CLARITY LEVEL:</span>
                  <span className="text-[#8B2626]">
                    {result.score >= 80
                      ? "✓ FOCUSED"
                      : result.score >= 55
                        ? "✓ CLEAR"
                        : result.score >= 30
                          ? "~ HAZY"
                          : "✗ SCATTERED"}
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

export default ClearTheAirPage;

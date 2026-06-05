"use client";
// steady_gaze/page.tsx
// The Steady Gaze game — a 60-second dot-catching attention game.
//
// All game content is generated CLIENT-SIDE from today's IST date. No server
// call is needed for game data (only for the daily-lock check).
//
// GAME MECHANICS:
//   - A dot spawns at a random position seeded by today's date (same every day)
//   - The dot fades from invisible to fully visible over 10 seconds
//   - TAP ANYWHERE to catch the dot (any tap while visible = hit)
//   - If you miss (dot visible for 10 s without a tap) = 1 miss
//   - 2 misses = game ends early
//   - Tapping when no dot is visible = penalty tap
//
// SCORING:
//   Score = Max(0, Min(100, hits × 25 − misses × 20 − penaltyTaps × 5))
//
// GAME PHASES:
//   WELCOME  → intro screen
//   PLAYING  → active game loop running via requestAnimationFrame
//   SAVING   → brief screen while score is saved to DB
//   RESULTS  → final score display
//
// WHY requestAnimationFrame (RAF)?
// The game loop runs at 60 fps. Using React state for the dot's position and
// opacity would cause 60 re-renders per second and destroy performance. Instead,
// we mutate the dot's DOM node directly (via dotRef) — React never re-renders
// the game area at 60 fps. Only the timer and miss counter update React state
// (and only every 500 ms).

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { checkAlreadyPlayed } from "./actions";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { GameErrorScreen } from "@/components/GameErrorScreen";
import { useRouter } from "next/navigation";
import { GameShell } from "@/components/GameShell";
import { saveUserGameStat } from "@/utils/saveUserGameStat";
import { useDeviceId } from "@/hooks/useDeviceId";
import { getTodayIST, getDailySeed, mulberry32 } from "@/utils/seedRng";

// ── Client-side game data computation ─────────────────────────────────────

// Converts HSL color values to a hex string like "#FF0033".
// HSL = Hue (0–360°), Saturation (0–100%), Lightness (0–100%).
// This is standard color math; the algorithm is a well-known formula.
const hslToHex = (h: number, s: number, l: number): string => {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

// Computes all game parameters from today's IST date — no server needed.
// Results are deterministic: same date → same colors and spawn sequence.
const computeGameData = () => {
  const today = getTodayIST();
  // getDailySeed returns a uint32 integer — needed for mulberry32's PRNG.
  const seedInt = getDailySeed(today + "steady_gaze");
  // Normalise to [0, 1) for computing human-readable values (hue, speed, etc.)
  const seed = seedInt / 0x100000000;
  const baseHue = Math.floor(seed * 360); // a hue angle in 0–360°
  return {
    theme_title: `Pure Awareness Run #${baseHue}`,
    speed: parseFloat((0.8 + seed * 1.5).toFixed(2)),
    screen_color: hslToHex(baseHue, 55, 50),   // background: same hue, medium saturation
    dot_color: hslToHex(baseHue, 70, 28),       // dot: same hue but darker
    spawn_pattern_seed: seedInt,                 // raw uint32 → passed to mulberry32
    miss_deceleration_factor: 0.8,
    max_expansion_cap_seconds: 10,               // dot visible for 10 s before auto-miss
  };
};

// ── Types ──────────────────────────────────────────────────────────────────

// Which screen is currently displayed
type GamePhase = "WELCOME" | "PLAYING" | "SAVING" | "RESULTS";
// Current state of the dot
type DotState = "hidden" | "catchable" | "missed";
// TypeScript utility: infer the return type of computeGameData so we don't
// have to write a separate interface that might get out of sync.
type GameData = ReturnType<typeof computeGameData>;

const GAME_DURATION = 60;       // total game time in seconds
const DOT_BASE_RADIUS = 10;     // dot radius in px (never changes)
const DOT_MAX_RADIUS = 80;      // unused — kept for future reference
const FADE_IN_DURATION = 10;    // seconds for the dot to go from invisible to visible
const HIT_POINTS = 25;          // score per caught dot
const MISS_PENALTY = 20;        // score deducted per missed dot
const TAP_PENALTY = 5;          // score deducted per tap when no dot is visible

// Mutable game state object mutated directly by the RAF loop — NOT React state.
// Using React state here would cause 60 re-renders per second. Instead, this
// object lives in a ref (gs.current) and is mutated in-place each frame.
interface GameState {
  timeLeft: number;
  dotState: DotState;
  dotX: number;          // dot centre X in px (from left edge of game area)
  dotY: number;          // dot centre Y in px (from top edge of game area)
  dotAge: number;        // seconds the current dot has been visible
  dotRadius: number;     // current radius (fixed at DOT_BASE_RADIUS)
  spawnTimer: number;    // seconds until the next dot spawns
  hits: number;          // dots caught
  misses: number;        // dots that expired without being caught
  penaltyTaps: number;   // taps when no dot was visible
  lastFrameTime: number; // timestamp of the previous RAF frame (ms)
  lastDisplayUpdate: number; // last time React state was updated from the loop (ms)
  areaWidth: number;     // game area width in px (used for spawn bounds)
  areaHeight: number;    // game area height in px
  active: boolean;       // set to false to stop the loop
  rng: () => number;     // seeded PRNG (mulberry32) for deterministic spawn positions
}

// ── Component ──────────────────────────────────────────────────────────────

const SteadyGazePage = () => {
  const router = useRouter();

  // computeGameData() runs once ([] dependency) and is memoized so the same
  // object is returned on every render — colors and seed don't change mid-game.
  const data = useMemo<GameData>(() => computeGameData(), []);

  // Which screen is shown
  const [phase, setPhase] = useState<GamePhase>("WELCOME");
  // Displayed timer (updated every 500 ms from the RAF loop)
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  // Miss indicator dots in the UI (updated in React so they animate)
  const [displayMisses, setDisplayMisses] = useState(0);
  // Final game stats, populated when endGame() fires and shown in RESULTS
  const [result, setResult] = useState({
    score: 0,
    hits: 0,
    misses: 0,
    penaltyTaps: 0,
  });

  const deviceIdRef = useDeviceId();
  // true if the DB returned ALREADY_PLAYED when saving (show a notice in RESULTS)
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);
  // true if saveUserGameStat failed for any other reason
  const [saveFailed, setSaveFailed] = useState(false);
  // true while the daily-lock server check is in flight
  const [isChecking, setIsChecking] = useState(true);
  // true if the daily-lock check threw an unexpected error
  const [isError, setIsError] = useState(false);

  // Ref to the game area div — needed to read clientWidth/Height for spawn bounds
  const gameAreaRef = useRef<HTMLDivElement>(null);
  // Ref to the dot div — mutated directly at 60 fps to avoid React re-renders
  const dotRef = useRef<HTMLDivElement>(null);
  // Ref holding the requestAnimationFrame ID so we can cancel it on cleanup
  const rafRef = useRef<number | null>(null);
  // Mutable game state object — the entire live game world lives here
  const gs = useRef<GameState | null>(null);

  // ── Game-loop helpers ──────────────────────────────────────────────────────
  // All wrapped in useCallback so they have stable references across renders.
  // This is required because startGame lists them as dependencies — if they
  // were re-created on every render, startGame would also be re-created,
  // causing the PLAYING useEffect to re-run and restart the game.

  // Picks a random position (within safe margins) and makes the dot visible.
  const spawnDot = useCallback(() => {
    const state = gs.current;
    if (!state) return;
    const margin = DOT_MAX_RADIUS + 16;
    state.dotX = margin + state.rng() * (state.areaWidth - 2 * margin);
    state.dotY = margin + state.rng() * (state.areaHeight - 2 * margin);
    state.dotAge = 0;
    state.dotRadius = DOT_BASE_RADIUS;
    state.dotState = "catchable";
    if (dotRef.current) dotRef.current.style.display = "";
  }, []);

  // Stops the RAF loop and hides the dot. Called when the player navigates away
  // or the game transitions out of PLAYING.
  const stopGame = useCallback(() => {
    if (gs.current) gs.current.active = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (dotRef.current) dotRef.current.style.display = "none";
  }, []);

  // Computes the final score and transitions to SAVING (which triggers the DB write).
  const endGame = useCallback(() => {
    const state = gs.current;
    if (!state) return;
    state.active = false;
    if (dotRef.current) dotRef.current.style.display = "none";
    const score = Math.max(
      0,
      Math.min(
        100,
        state.hits * HIT_POINTS -
          state.misses * MISS_PENALTY -
          state.penaltyTaps * TAP_PENALTY,
      ),
    );
    setResult({
      score,
      hits: state.hits,
      misses: state.misses,
      penaltyTaps: state.penaltyTaps,
    });
    setPhase("SAVING");
  }, []);

  // Initialises the game state and starts the requestAnimationFrame loop.
  const startGame = useCallback(() => {
    const area = gameAreaRef.current;
    if (!area) return;
    // Create the seeded PRNG — same seed every day → same spawn sequence
    const rng = mulberry32(data.spawn_pattern_seed);

    gs.current = {
      timeLeft: GAME_DURATION,
      dotState: "hidden",
      dotX: 0,
      dotY: 0,
      dotAge: 0,
      dotRadius: DOT_BASE_RADIUS,
      spawnTimer: 2 + rng() * 18, // first dot within 2–20 s
      hits: 0,
      misses: 0,
      penaltyTaps: 0,
      lastFrameTime: 0,
      lastDisplayUpdate: 0,
      areaWidth: area.clientWidth,
      areaHeight: area.clientHeight,
      active: true,
      rng,
    };

    if (dotRef.current) dotRef.current.style.display = "none";

    const loop = (timestamp: number) => {
      const state = gs.current;
      if (!state?.active) return;

      if (state.lastFrameTime === 0) state.lastFrameTime = timestamp;
      // Cap dt at 50 ms so a backgrounded tab resuming after seconds doesn't
      // advance the clock by more than one frame and instantly expire the dot.
      const dt = Math.min((timestamp - state.lastFrameTime) / 1000, 0.05);
      state.lastFrameTime = timestamp;

      state.timeLeft -= dt;

      if (state.timeLeft <= 0) {
        endGame();
        return;
      }

      if (state.dotState === "hidden") {
        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) spawnDot();
      } else {
        state.dotAge += dt;

        // Time expired — register miss
        if (
          state.dotState === "catchable" &&
          state.dotAge >= data.max_expansion_cap_seconds
        ) {
          state.misses++;
          state.dotState = "hidden";
          if (dotRef.current) dotRef.current.style.display = "none";
          state.spawnTimer = 5 + state.rng() * 25;
          setDisplayMisses(state.misses);
          if (state.misses >= 2) {
            endGame();
            return;
          }
        }

        // Update dot DOM directly — avoid React re-renders at 60 fps
        if (dotRef.current && state.dotState === "catchable") {
          const radius = state.dotRadius;
          const opacity = Math.min(1, state.dotAge / FADE_IN_DURATION);
          const size = radius * 2;

          dotRef.current.style.width = `${size}px`;
          dotRef.current.style.height = `${size}px`;
          dotRef.current.style.transform = `translate(${(state.dotX - radius).toFixed(1)}px, ${(state.dotY - radius).toFixed(1)}px)`;
          dotRef.current.style.opacity = opacity.toFixed(2);
          dotRef.current.style.boxShadow = `0 0 8px 4px ${data.dot_color}55`;
        }
      }

      if (timestamp - state.lastDisplayUpdate >= 500) {
        state.lastDisplayUpdate = timestamp;
        setTimeLeft(Math.ceil(state.timeLeft));
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [data, endGame, spawnDot]);

  // Global tap handler. Attached to `document` (not the game div) so any tap
  // anywhere on the screen counts — the player doesn't need to aim precisely.
  //
  // Why useCallback with []? It needs to be a stable reference to add and
  // remove the same listener. Without useCallback, a new function would be
  // created on every render, and removeEventListener would fail to find it.
  const handleBackgroundTap = useCallback(() => {
    const state = gs.current;
    if (!state?.active) return;
    if (state.dotState === "catchable") {
      // Successfully caught the dot
      state.hits++;
      state.dotState = "hidden";
      if (dotRef.current) dotRef.current.style.display = "none";
      state.spawnTimer = 5 + state.rng() * 25; // next dot in 5–30 s
    } else if (state.dotState === "hidden") {
      // Tapped when no dot was visible — penalty
      state.penaltyTaps++;
    }
  }, []);

  // When phase transitions to PLAYING: start the RAF loop and attach the global
  // tap listener. The returned cleanup function runs when PLAYING phase ends
  // (stopGame cancels the RAF loop; removeEventListener removes the tap handler).
  useEffect(() => {
    if (phase === "PLAYING") {
      startGame();
      document.addEventListener("click", handleBackgroundTap);
      return () => {
        stopGame();
        document.removeEventListener("click", handleBackgroundTap);
      };
    }
  }, [phase, startGame, stopGame, handleBackgroundTap]);

  // On mount: check the daily lock. If already played → redirect home.
  // On error → show the error screen (setIsError). On success → setIsChecking(false).
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

  // When phase transitions to SAVING: write the score to the DB.
  // Always transitions to RESULTS afterwards (even if the save failed), so the
  // player sees their score — we just show a "score not saved" notice.
  useEffect(() => {
    if (phase !== "SAVING") return;
    const save = async () => {
      try {
        const res = await saveUserGameStat(
          result.score,
          deviceIdRef.current,
          "STEADY_GAZE",
          "web_steady_gaze_v1",
        );
        if (res.error === "ALREADY_PLAYED") setAlreadyPlayed(true);
        else if (!res.success) setSaveFailed(true);
      } catch {
        setSaveFailed(true);
      } finally {
        setPhase("RESULTS"); // always show results, even if save failed
      }
    };
    save();
  }, [deviceIdRef, phase, result.score]);

  // Cleanup: cancel any pending RAF frame when the component is unmounted.
  // Without this, the loop would keep running after the user navigates away
  // and would try to call setState on an unmounted component.
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ── Event handlers ──────────────────────────────────────────────────────────

  const handleBackToHome = () => {
    stopGame(); // cancel RAF loop before navigating away
    router.push("/");
  };

  // Formats seconds as MM:SS (e.g. 61 → "01:01", 5 → "00:05")
  const formatTime = (sec: number) => {
    const s = Math.max(0, sec);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  // Show spinner while the daily-lock server check is in flight
  if (isChecking) return <GameLoadingScreen />;
  // Show error card if the lock check threw an unexpected error
  if (isError) return <GameErrorScreen />;

  return (
    <GameShell
      title="STEADY GAZE"
      onBack={handleBackToHome}
      badge={
        phase === "PLAYING" ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-[#232323] text-[#00FF33] font-bold text-[10px] px-2 py-1 border border-[#232323] tracking-widest tabular-nums"
          >
            {formatTime(timeLeft)}
          </motion.div>
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
                  Train pure awareness. Notice subtle changes in a world of
                  overstimulation.
                </p>
                <div className="space-y-2 text-[11px]">
                  {[
                    { label: "DURATION", value: "60 seconds" },
                    { label: "GOAL", value: "Tap when you see the shimmer" },
                    { label: "FOCUS", value: "Watch for subtle visual changes" },
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
                onClick={() => setPhase("PLAYING")}
                className="w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 border border-[#232323]"
              >
                BEGIN MEDITATION
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
            <div
              ref={gameAreaRef}
              className="flex-1 relative overflow-hidden"
              style={{ backgroundColor: data.screen_color }}
            >
              {/* Miss indicators */}
              <div className="absolute top-3 left-3 z-10 flex gap-2 pointer-events-none">
                {[0, 1].map((i) => (
                  <motion.div
                    key={i}
                    animate={
                      i < displayMisses
                        ? { scale: [1, 1.5, 1], backgroundColor: "#8B2626" }
                        : { scale: 1, backgroundColor: "rgba(0, 0, 0, 0)" }
                    }
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="w-3 h-3 rounded-full border"
                    style={{
                      borderColor:
                        i < displayMisses ? "#8B2626" : "rgba(35,35,35,0.35)",
                    }}
                  />
                ))}
              </div>

              {/* The dot — position and opacity driven entirely by RAF */}
              <div
                ref={dotRef}
                className="absolute rounded-full"
                style={{
                  left: 0,
                  top: 0,
                  width: DOT_BASE_RADIUS * 2,
                  height: DOT_BASE_RADIUS * 2,
                  backgroundColor: data.dot_color,
                  display: "none",
                  cursor: "default",
                }}
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
                    ATTENTION SCORE
                  </span>
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      delay: 0.1,
                      type: "spring",
                      stiffness: 200,
                    }}
                    className="text-2xl font-black tracking-widest text-[#00FF33] block"
                  >
                    {result.score}/100
                  </motion.span>
                </div>

                <div className="space-y-2 border border-[#232323]/20 p-3 text-[10px] font-black tracking-wider">
                  {[
                    {
                      label: "DOTS CAUGHT",
                      value: String(result.hits),
                      accent: true,
                    },
                    {
                      label: "MISSES",
                      value: String(result.misses),
                      accent: result.misses > 0,
                    },
                    ...(result.penaltyTaps > 0
                      ? [
                          {
                            label: "PENALTY TAPS",
                            value: `-${result.penaltyTaps * TAP_PENALTY} pts`,
                            accent: true,
                          },
                        ]
                      : []),
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

export default SteadyGazePage;

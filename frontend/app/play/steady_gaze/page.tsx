"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { checkAlreadyPlayed, saveUserGameStats } from "./actions";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { useRouter } from "next/navigation";
import { useDeviceId } from "@/hooks/useDeviceId";
import { GameShell } from "@/components/GameShell";

// ── Client-side game data (mirrors generate_game.ts logic, no server needed) ──

function getTodayIST(): string {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

// djb2 hash → deterministic uint32 from any string
function getDailySeed(dateStr: string): number {
  let hash = 5381;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (Math.imul(hash, 33) ^ dateStr.charCodeAt(i)) >>> 0;
  }
  return hash; // uint32 integer
}

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function computeGameData() {
  const today = getTodayIST();
  const seedInt = getDailySeed(today + "steady_gaze");
  // Normalize to [0, 1) for display-value computations
  const seed = seedInt / 0x100000000;
  const baseHue = Math.floor(seed * 360);
  const oppositeHue = (baseHue + 180) % 360;
  return {
    theme_title: `Pure Awareness Run #${baseHue}`,
    speed: parseFloat((0.8 + seed * 1.5).toFixed(2)),
    screen_color: hslToHex(baseHue, 60, 45),
    dot_color: hslToHex(oppositeHue, 85, 65),
    shimmer_frequency: parseFloat((2.0 + seed * 4.0).toFixed(1)),
    spawn_pattern_seed: seedInt, // pass raw uint32 to mulberry32
    base_shimmer_speed_multiplier: 1.25,
    miss_deceleration_factor: 0.8,
    max_expansion_cap_seconds: 4.5,
  };
}

// ── Seeded PRNG — spawn positions and delays are deterministic per day ──

function mulberry32(seed: number): () => number {
  let s = seed >>> 0; // ensure uint32
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (Math.imul(t ^ (t >>> 7), 61 | t) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// ── Types ──

type GamePhase = "WELCOME" | "PLAYING" | "SAVING" | "RESULTS";
type DotState = "hidden" | "catchable" | "missed";
type GameData = ReturnType<typeof computeGameData>;

const GAME_DURATION = 60;
const DOT_BASE_RADIUS = 10;
const DOT_MAX_RADIUS = 80;
const FADE_IN_DURATION = 1.4;
const HIT_POINTS = 25;
const MISS_PENALTY = 20;
const TAP_PENALTY = 5;
const MISCLICK_GROWTH = 25;

interface GameState {
  timeLeft: number;
  dotState: DotState;
  dotX: number;
  dotY: number;
  dotAge: number;
  dotRadius: number;
  spawnTimer: number;
  hits: number;
  misses: number;
  penaltyTaps: number;
  shimmerPhase: number;
  lastFrameTime: number;
  lastDisplayUpdate: number;
  areaWidth: number;
  areaHeight: number;
  active: boolean;
  rng: () => number;
}

// ── Component ──

export default function SteadyGazePage() {
  const router = useRouter();

  // Stable game data — computed once, safe to access during render
  const data = useMemo<GameData>(() => computeGameData(), []);

  const deviceIdRef = useDeviceId();

  const [isChecking, setIsChecking] = useState(true);
  const [phase, setPhase] = useState<GamePhase>("WELCOME");
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [displayMisses, setDisplayMisses] = useState(0);
  const [result, setResult] = useState({
    score: 0,
    hits: 0,
    misses: 0,
    penaltyTaps: 0,
  });
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);

  const gameAreaRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const gs = useRef<GameState | null>(null);

  // ── Stable game-loop helpers (useCallback so they can be deps) ──

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

  const stopGame = useCallback(() => {
    if (gs.current) gs.current.active = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (dotRef.current) dotRef.current.style.display = "none";
  }, []);

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

  const startGame = useCallback(() => {
    const area = gameAreaRef.current;
    if (!area) return;
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
      shimmerPhase: 0,
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
      const dt = Math.min((timestamp - state.lastFrameTime) / 1000, 0.05);
      state.lastFrameTime = timestamp;

      state.timeLeft -= dt;
      state.shimmerPhase +=
        dt *
        data.shimmer_frequency *
        data.base_shimmer_speed_multiplier *
        2 *
        Math.PI;

      if (state.timeLeft <= 0) {
        endGame();
        return;
      }

      if (state.dotState === "hidden") {
        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) spawnDot();
      } else {
        state.dotAge += dt;

        // Time expired or grew too large from misclicks — register miss
        if (
          state.dotState === "catchable" &&
          (state.dotAge >= data.max_expansion_cap_seconds ||
            state.dotRadius >= DOT_MAX_RADIUS)
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
          const fadeIn = Math.min(1, state.dotAge / FADE_IN_DURATION);
          const shimmerVal = 0.65 + 0.35 * Math.sin(state.shimmerPhase);
          const opacity = fadeIn * shimmerVal;
          const size = radius * 2;
          const glow = Math.round(4 + 8 * ((shimmerVal - 0.65) / 0.35));

          dotRef.current.style.width = `${size}px`;
          dotRef.current.style.height = `${size}px`;
          dotRef.current.style.transform = `translate(${(state.dotX - radius).toFixed(1)}px, ${(state.dotY - radius).toFixed(1)}px)`;
          dotRef.current.style.opacity = opacity.toFixed(2);
          dotRef.current.style.boxShadow = `0 0 ${glow}px ${Math.round(glow / 2)}px ${data.dot_color}55`;
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

  // Start/stop game when phase changes
  useEffect(() => {
    if (phase === "PLAYING") {
      startGame();
      return stopGame;
    }
  }, [phase, startGame, stopGame]);

  // Save score once phase reaches SAVING
  useEffect(() => {
    if (phase !== "SAVING") return;
    saveUserGameStats(result.score, deviceIdRef.current).then((res) => {
      if (res.error === "ALREADY_PLAYED") setAlreadyPlayed(true);
      setPhase("RESULTS");
    });
  }, [deviceIdRef, phase, result.score]);

  // Daily-lock check on mount — redirect if already played today
  useEffect(() => {
    checkAlreadyPlayed(deviceIdRef.current).then(({ alreadyPlayed }) => {
      if (alreadyPlayed) {
        router.push("/");
      } else {
        setIsChecking(false);
      }
    });
  }, [deviceIdRef, router]);

  // RAF cleanup on unmount
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ── Event handlers ──

  const handleDotTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    const state = gs.current;
    if (!state?.active) return;

    if (state.dotState !== "catchable") return;
    state.hits++;
    state.dotState = "hidden";
    if (dotRef.current) dotRef.current.style.display = "none";
    state.spawnTimer = 5 + state.rng() * 25; // 5–30 s until next dot
  };

  const handleBackgroundTap = () => {
    const state = gs.current;
    if (!state?.active) return;
    if (state.dotState === "catchable") {
      // Misclick while dot is visible — grow the dot toward its max
      state.dotRadius = Math.min(
        DOT_MAX_RADIUS,
        state.dotRadius + MISCLICK_GROWTH,
      );
    } else if (state.dotState === "hidden") {
      // Random tap with no dot — score penalty
      state.penaltyTaps++;
    }
  };

  const handleBackToHome = () => {
    stopGame();
    router.push("/");
  };

  const formatTime = (sec: number) => {
    const s = Math.max(0, sec);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  // ── Render ──

  if (isChecking) return <GameLoadingScreen />;

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
              <div className="bg-[#FAF6F0] border border-[#232323] p-5 shadow-[4px_4px_0px_#232323] outline-double outline-4 outline-[#FAF6F0]">
                <p className="text-xs leading-relaxed text-[#232323] font-medium mb-5">
                  A small dot will silently appear somewhere on the field. Tap
                  it before it grows too large. Two misses end the session
                  early. Patience — not speed — wins.
                </p>
                <div className="space-y-2 border-t border-dashed border-[#232323]/30 pt-4 text-[11px]">
                  {[
                    { label: "THEME", value: data.theme_title },
                    { label: "DURATION", value: "60 seconds" },
                    { label: "STRIKES", value: "2 misses allowed" },
                    {
                      label: "NOTE",
                      value: "Tapping with no dot incurs a score penalty",
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-1.5">
                      <span className="font-bold text-[#8B2626] uppercase w-20 inline-block shrink-0">
                        {label}:
                      </span>
                      <span className="text-[#232323] font-semibold">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Colour preview */}
              <div className="flex gap-3 items-center border border-[#232323]/20 p-3">
                <div
                  className="w-8 h-8 rounded-full shrink-0 shadow-[2px_2px_0px_#232323]"
                  style={{ backgroundColor: data.screen_color }}
                />
                <div
                  className="w-4 h-4 rounded-full shrink-0 shadow-[2px_2px_0px_#232323]"
                  style={{ backgroundColor: data.dot_color }}
                />
                <p className="text-[10px] text-[#232323]/60 font-bold tracking-wider uppercase">
                  Today&apos;s colour theme
                </p>
              </div>

              <button
                onClick={() => setPhase("PLAYING")}
                className="w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-black text-xs tracking-widest uppercase shadow-[4px_4px_0px_#232323] active:translate-x-0.5 active:translate-y-0.5 border border-[#232323]"
              >
                START STEADY GAZE
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
              onClick={handleBackgroundTap}
            >
              {/* Miss indicators */}
              <div className="absolute top-3 left-3 z-10 flex gap-2 pointer-events-none">
                {[0, 1].map((i) => (
                  <motion.div
                    key={i}
                    animate={
                      i < displayMisses
                        ? { scale: [1, 1.5, 1], backgroundColor: "#8B2626" }
                        : { scale: 1, backgroundColor: "transparent" }
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
                onClick={handleDotTap}
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
}

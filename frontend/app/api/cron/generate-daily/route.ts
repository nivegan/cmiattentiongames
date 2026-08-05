// app/api/cron/generate-daily/route.ts
// Daily content-generation cron. TypeScript port of the backend project's
// `backend/pages/api/cron/generate-daily.js`, adapted for this app:
//   - App Router GET handler instead of a pages-style (req, res) handler
//   - Prisma (utils/prismaInit singleton) instead of @supabase/supabase-js
//   - Gated by CRON_SECRET like /api/cron/generate-weekly (the original was
//     unauthenticated)
//   - Weekday schedule read from data/dailySchedule.json — so game ids here are
//     this project's SLUGS (gut_check, clear_air, read_designs, …) where the
//     original hardcoded SCREAMING_SNAKE names (GUT_CHECK, CLEAR_THE_AIR,
//     DARK_DESIGN, …). Slug ↔ GameMode goes through lib/gameCatalog.ts.
//   - Gemini over REST on gemini-3.1-flash-lite (this project's transport and
//     model everywhere), not the original's @google/genai + gemini-2.5-flash
//   - Generates TOMORROW's scenarios by default (the cron runs 00:00 UTC =
//     05:30 IST); `?date=YYYY-MM-DD` overrides, `?force=true` regenerates rows
//     that already exist
//
// Output goes to `daily_scenarios` — note the app's game pages do NOT read that
// table (they use `kalari_games` / client-side seeds); this preserves the
// backend pipeline's behavior as-is. The one frontend-only addition is the
// `kalari_games` mirror for the three non-LLM games (below).
//
// Pipeline: STEP 1&2 read `kalari_games` + `user_stats` telemetry to pick a
// per-game difficulty band and derive the Extract Facts character limit, the
// Gut Check anchor variance and the sensory speed multipliers; STEP 3 generates
// each scheduled game's content (Gemini for text games, seeded math for sensory
// games) and replaces tomorrow's rows.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/utils/prismaInit";
import scheduleData from "@/data/dailySchedule.json";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import { buildNonLlmContent } from "@/utils/nonLlmDailyContent";
import type { NonLlmSlug } from "@/utils/nonLlmDailyContent";
import type { GameMode } from "@/utils/gameMode";

// Gemini generation for up to two games can take a while.
export const maxDuration = 60;

// =========================================================================
// 1. LIGHTWEIGHT PREPROCESSING SCHEMAS
// =========================================================================
// Truncate before validating so an over-long LLM string trims instead of
// failing the whole run.
const LimitedString = z.preprocess(
  (val) => (typeof val === "string" ? val.substring(0, 150) : val),
  z.string().max(150, "Content exceeds strict 150-character limit"),
);

const ExplanationString = z.preprocess(
  (val) => (typeof val === "string" ? val.substring(0, 200) : val),
  z.string().max(200, "Explanation exceeds strict 200-character limit"),
);

// =========================================================================
// 2. DATA VALIDATION SCHEMAS
// =========================================================================
const ExtractFactsSchema = z.object({
  topic: z.string(),
  paragraph_a: z.string(),
  paragraph_b: z.string(),
  mcq_questions: z
    .array(
      z.object({
        question: LimitedString,
        options: z.array(LimitedString).length(4),
        correct_answer_index: z.preprocess(
          (val) => (typeof val === "string" ? parseInt(val, 10) : Number(val)),
          z.number().min(0).max(3),
        ),
      }),
    )
    .length(3),
  takeaway_criteria: z.array(z.string()).min(3).max(5),
});

// ⚠️ This mirrors the BACKEND's dark-design shape: manipulation_mcq.options is
// an OBJECT keyed a/b/c/d with `correct_vector`. The live game generator
// (utils/generate_dark_design.ts) deliberately uses an ARRAY of options with
// `correct_manipulation_index`, which app/play/read_designs/page.tsx depends on.
// This schema is local to the cron (which only writes daily_scenarios, a table
// no game page reads) — do NOT copy it into the live generator.
const DarkDesignSchema = z.object({
  vector_mcq: z.object({
    question: LimitedString,
    options: z.object({
      text: LimitedString,
      ui: LimitedString,
      ad: LimitedString,
      graph: LimitedString,
    }),
    correct_vector: z.enum(["text", "ui", "ad", "graph"]),
    correct_vector_index: z.preprocess(
      (val) => (typeof val === "string" ? parseInt(val, 10) : Number(val)),
      z.number().min(0).max(3),
    ),
  }),
  manipulation_mcq: z.object({
    question: LimitedString,
    options: z.object({
      a: LimitedString,
      b: LimitedString,
      c: LimitedString,
      d: LimitedString,
    }),
    correct_vector: z.enum(["a", "b", "c", "d"]),
    correct_vector_index: z.preprocess(
      (val) => (typeof val === "string" ? parseInt(val, 10) : Number(val)),
      z.number().min(0).max(3),
    ),
  }),
  short_explanation: ExplanationString,
});

const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z
    .array(
      z.object({
        anchor_statement: LimitedString,
        is_anchor_true: z.preprocess(
          (val) =>
            typeof val === "string"
              ? val.toLowerCase() === "true"
              : Boolean(val),
          z.boolean(),
        ),
        the_real_question: LimitedString,
        the_real_number: z.preprocess(
          (val) => (typeof val === "string" ? parseFloat(val) : Number(val)),
          z.number(),
        ),
        unit: z.string(),
        difficulty_level: z.string(),
      }),
    )
    .length(3),
});

const SteadyGazeSchema = z.object({
  theme_title: z.string(),
  speed: z.number(),
  screen_color: z.string().regex(/^#[0-9A-F]{6}$/i),
  dot_color: z.string().regex(/^#[0-9A-F]{6}$/i),
  shimmer_frequency: z.number(),
  spawn_pattern_seed: z.number(),
  base_shimmer_speed_multiplier: z.number(),
  miss_deceleration_factor: z.number(),
  max_expansion_cap_seconds: z.number(),
});

const ClearTheAirSchema = z.object({
  theme_title: z.string(),
  bubble_speed: z.number(),
  initial_distraction_ratio: z.number(),
  progression_intensity_multiplier: z.number(),
  max_bubble_density_cap: z.number(),
  bubble_acceleration_factor: z.number(),
  smudge_opacity_penalty: z.number(),
});

// Everything a scheduled game can store into daily_scenarios.scenario_data.
type ScenarioPayload =
  | z.infer<typeof ExtractFactsSchema>
  | z.infer<typeof DarkDesignSchema>
  | z.infer<typeof GutCheckSchema>
  | z.infer<typeof SteadyGazeSchema>
  | z.infer<typeof ClearTheAirSchema>
  | {
      theme_title: string;
      scheduled_timestamp: number;
      distractor_shapes_count: number;
    };

// =========================================================================
// 3. GENERATOR UTILITIES
// =========================================================================
const getDailySeed = (dateStr: string): number => {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(Math.sin(hash)) % 1;
};

const hslToHex = (h: number, s: number, l: number): string => {
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
};

const generateSteadyGazeParams = (
  today: string,
  difficultyBand: number,
  speedMultiplier = 1.0,
): z.infer<typeof SteadyGazeSchema> => {
  const seed = getDailySeed(today + "steady_gaze");
  const baseSpeed = 1.0 * (0.8 + (difficultyBand - 1) * 0.3);
  return {
    theme_title: `Pure Awareness Run #${Math.floor(seed * 360)}`,
    speed: parseFloat((baseSpeed * speedMultiplier).toFixed(2)),
    screen_color: hslToHex(Math.floor(seed * 360), 60, 45),
    dot_color: hslToHex((Math.floor(seed * 360) + 180) % 360, 85, 65),
    shimmer_frequency: parseFloat((2.0 + seed * 4.0).toFixed(1)),
    spawn_pattern_seed: parseFloat(seed.toFixed(4)),
    base_shimmer_speed_multiplier: 1.25,
    miss_deceleration_factor: 0.8,
    max_expansion_cap_seconds: 4.5,
  };
};

const generateClearTheAirParams = (
  today: string,
  difficultyBand: number,
  speedMultiplier = 1.0,
): z.infer<typeof ClearTheAirSchema> => {
  const seed = getDailySeed(today + "clear_the_air");
  const baseSpeed = 1.2 * (0.8 + (difficultyBand - 1) * 0.3);
  return {
    theme_title: `Dissolving Distractions Pattern v${Math.floor(seed * 1000)}`,
    bubble_speed: parseFloat((baseSpeed * speedMultiplier).toFixed(2)),
    initial_distraction_ratio: parseFloat((0.3 + seed * 0.2).toFixed(2)),
    progression_intensity_multiplier: parseFloat((1.5 + seed * 1.5).toFixed(2)),
    max_bubble_density_cap: Math.floor(20 + difficultyBand * 5),
    bubble_acceleration_factor: 0.05,
    smudge_opacity_penalty: 0.65,
  };
};

const clampBand = (band: number): number =>
  Math.max(1, Math.min(5, Math.round(band)));

const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// Schedule slugs of the seed-computed (non-Gemini) games, mirrored into
// kalari_games in addition to daily_scenarios.
const NON_LLM_SLUGS = ["steady_gaze", "clear_air", "mental_reflex"];

// kalari_games.mode → GameMode. Catalog slugs cover five of the six; the LLM
// generators write their own mode string for Read Between Designs
// ("dark_design"), so it gets an explicit alias. (The backend does this with
// `row.mode.toUpperCase()`, which silently drops clear_air and dark_design.)
const MODE_BY_KALARI_MODE: Record<string, GameMode> = {
  ...Object.fromEntries(
    Object.values(GAME_CATALOG).map((g) => [g.slug, g.mode]),
  ),
  dark_design: "READ_BETWEEN_DESIGNS",
};

// Every mode the telemetry engine tracks, at the neutral default band.
const DEFAULT_BANDS: Record<GameMode, number> = {
  STEADY_GAZE: 3,
  CLEAR_THE_AIR: 3,
  EXTRACT_THE_FACTS: 3,
  GUT_CHECK: 3,
  READ_BETWEEN_DESIGNS: 3,
  MENTAL_REFLEX: 3,
};

const DAYS_OF_WEEK = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

// Single Gemini call → parsed JSON. Same transport/model as the standalone
// generators in utils/generate_*.ts.
const callGemini = async (
  prompt: string,
  apiKey: string,
  gameType: string,
): Promise<unknown> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
  const aiResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 1.0,
      },
    }),
  });

  if (!aiResponse.ok) {
    throw new Error(
      `Downstream LLM channel service call failed with network response status code: ${aiResponse.status}`,
    );
  }

  const aiData = await aiResponse.json();
  const rawText: string | undefined =
    aiData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(
      `Empty execution profile tokens generated via LLM channel for module type target ${gameType}`,
    );
  }

  return JSON.parse(
    rawText
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim(),
  );
};

// =========================================================================
// 4. MAIN ENDPOINT HANDLER
// =========================================================================
export const GET = async (req: NextRequest) => {
  // Same fail-closed gate as /api/cron/generate-weekly: Vercel cron sends
  // Authorization: Bearer $CRON_SECRET automatically when the env var is set.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Checked here (not at module load) so a missing key can't break the build.
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing GOOGLE_GENERATIVE_AI_API_KEY" },
      { status: 500 },
    );
  }

  const executionTraces: string[] = [];

  const dateParam = req.nextUrl.searchParams.get("date");
  const forceRegenerate =
    req.nextUrl.searchParams.get("force") === "true" ||
    req.nextUrl.searchParams.get("forceRefresh") === "true";

  // Default target is TOMORROW (the cron runs at 00:00 UTC = 05:30 IST).
  const tomorrowDateObj = new Date();
  tomorrowDateObj.setDate(tomorrowDateObj.getDate() + 1);
  const targetDateStr =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : tomorrowDateObj.toISOString().split("T")[0];

  // play_date is @db.Date — pass UTC midnight so the stored calendar date is
  // targetDateStr on any host timezone (same pattern as weekly_summaries).
  const targetDate = new Date(`${targetDateStr}T00:00:00Z`);
  const dayName = DAYS_OF_WEEK[targetDate.getUTCDay()];

  // Weekday → scheduled game slugs, from the same JSON the home grid uses
  // (the original hardcoded an identical map).
  const scheduleMap = scheduleData.schedule as Record<string, string[]>;
  const activeGameTypes = scheduleMap[dayName] || [
    "extract_facts",
    "mental_reflex",
  ];

  try {
    // ---------------------------------------------------------------------
    // NON-LLM MIRROR (frontend-only; no backend equivalent)
    // ---------------------------------------------------------------------
    // Mirror the seed-computed games into kalari_games so every daily game has a
    // row there. Record-keeping only — the game pages stay seed-based and never
    // read these rows. Content is the REAL seed-derived params
    // (utils/nonLlmDailyContent.ts) — the same bytes the on-demand writer in
    // each game's checkAlreadyPlayed produces, so writer order is irrelevant.
    // `topic` stays null so the LLM generators' anti-repetition loop (which
    // reads topic across ALL modes) is not polluted. Runs before the
    // already-exists early return so a skip day still gets its mirror rows.
    for (const slug of activeGameTypes.filter((g) =>
      NON_LLM_SLUGS.includes(g),
    )) {
      const realParams = buildNonLlmContent(slug as NonLlmSlug, targetDateStr);
      await prisma.kalari_games.upsert({
        where: {
          mode_scheduled_for: { mode: slug, scheduled_for: targetDate },
        },
        update: { content: realParams },
        create: { mode: slug, content: realParams, scheduled_for: targetDate },
      });
    }

    // ---------------------------------------------------------------------
    // SELF-HEALING CHECK: VERIFY IF THE TARGET DAY'S GAMES ALREADY EXIST
    // ---------------------------------------------------------------------
    const existingRows = await prisma.daily_scenarios.findMany({
      where: { play_date: targetDate },
      select: { game_type_id: true },
    });
    const existingGameIds = new Set(existingRows.map((r) => r.game_type_id));
    const missingGames = activeGameTypes.filter(
      (gameId) => forceRegenerate || !existingGameIds.has(gameId),
    );

    if (missingGames.length === 0) {
      return NextResponse.json({
        status: "Success",
        message: `Games for ${targetDateStr} already exist in daily_scenarios. No generation required.`,
        play_date: targetDateStr,
        active_games: Array.from(existingGameIds),
      });
    }

    executionTraces.push(
      `[Check]: Missing games detected for ${targetDateStr}: [${missingGames.join(", ")}]. Proceeding with generation...`,
    );

    // ---------------------------------------------------------------------
    // STEP 1 & 2: TELEMETRY REFINEMENT LOOP (BI-DIRECTIONAL SWINGS)
    // ---------------------------------------------------------------------
    const targetDifficultyBands: Record<GameMode, number> = {
      ...DEFAULT_BANDS,
    };
    const extractFactsCharLimitMap: Partial<Record<GameMode, number>> = {};
    const sensorySpeedMultipliers: Record<string, number> = {
      STEADY_GAZE: 1.0,
      CLEAR_THE_AIR: 1.0,
    };
    const gutCheckVarianceMap: Partial<Record<GameMode, number>> = {};

    const kalariData = await prisma.kalari_games.findMany({
      select: { mode: true, difficulty_band: true },
    });
    kalariData.forEach((row) => {
      const mode = MODE_BY_KALARI_MODE[row.mode];
      if (mode && row.difficulty_band) {
        targetDifficultyBands[mode] = clampBand(row.difficulty_band);
      }
    });

    const parsedStats = await prisma.user_stats.findMany({
      select: {
        game_type_id: true,
        difficulty_band: true,
        is_success: true,
        score: true,
      },
    });

    for (const gameId of Object.keys(targetDifficultyBands) as GameMode[]) {
      const gameEntries = parsedStats.filter((s) => s.game_type_id === gameId);
      let currentBand = targetDifficultyBands[gameId];
      if (gameEntries.length > 0 && gameEntries[0].difficulty_band) {
        currentBand = clampBand(gameEntries[0].difficulty_band);
      }

      // Base character limit enforcing the hard 400-character ceiling max
      let baseCharLimit = Math.min(
        400,
        Math.floor(280 * (1 + (currentBand - 3) * 0.1)),
      );
      let baseVariance = 10.0 + currentBand * 5.0;

      if (gameEntries.length >= 5) {
        const winRate =
          gameEntries.filter((e) => e.is_success === true).length /
          gameEntries.length;
        const abandonRate =
          gameEntries.filter((e) => e.is_success === false).length /
          gameEntries.length;
        const scores = gameEntries
          .map((e) => e.score)
          .filter((s) => s !== null);
        const isLowScore =
          (scores.length > 0
            ? scores.reduce((a, b) => a + b, 0) / scores.length
            : 70) < 50;
        let newBand = currentBand;

        // 1. EXTRACT FACTS: Reduce on high abandon, cap rigidly at 400 chars
        if (gameId === "EXTRACT_THE_FACTS") {
          if (abandonRate > 0.2) {
            baseCharLimit = Math.floor(baseCharLimit * 0.9);
            executionTraces.push(
              `[Telemetry Adjustment]: Extract Facts Abandon Rate > 20%. Char limit reduced to ${baseCharLimit}`,
            );
          } else if (winRate > 0.8) {
            baseCharLimit = Math.min(400, Math.floor(baseCharLimit * 1.1));
          }

          if (abandonRate > 0.2 || winRate < 0.5 || isLowScore) newBand -= 1;
          else if (winRate > 0.8) newBand += 1;
        }

        // 2. SENSORY (GAZE / AIR): Increase on Win > 85%, decrease on Win < 15%
        else if (gameId === "STEADY_GAZE" || gameId === "CLEAR_THE_AIR") {
          if (winRate > 0.85) {
            sensorySpeedMultipliers[gameId] = 1.15;
            executionTraces.push(
              `[Telemetry Adjustment]: ${gameId} Win Rate > 85%. Speed multiplier increased to 1.15`,
            );
            newBand += 1;
          } else if (winRate < 0.15 || isLowScore) {
            sensorySpeedMultipliers[gameId] = 0.85;
            executionTraces.push(
              `[Telemetry Adjustment]: ${gameId} Win Rate < 15%. Speed multiplier decreased to 0.85`,
            );
            newBand -= 1;
          }
        }

        // 3. GUT CHECK: Widen variance on high win rate, tighten on low win rate
        else if (gameId === "GUT_CHECK") {
          if (winRate > 0.85) {
            baseVariance += 10.0;
            executionTraces.push(
              `[Telemetry Adjustment]: Gut Check Win Rate > 85%. Anchor variance widened to ${baseVariance}%`,
            );
            newBand += 1;
          } else if (winRate < 0.15 || isLowScore) {
            baseVariance = Math.max(5.0, baseVariance - 5.0);
            executionTraces.push(
              `[Telemetry Adjustment]: Gut Check Win Rate < 15%. Anchor variance narrowed to ${baseVariance}%`,
            );
            newBand -= 1;
          }
        } else if (gameId === "READ_BETWEEN_DESIGNS") {
          if (abandonRate > 0.2 || winRate < 0.5 || isLowScore) newBand -= 1;
          else if (winRate > 0.8) newBand += 1;
        } else if (gameId === "MENTAL_REFLEX") {
          if (winRate < 0.3 || isLowScore) newBand -= 1;
          else if (winRate > 0.7) newBand += 1;
        }

        targetDifficultyBands[gameId] = clampBand(newBand);
      } else {
        targetDifficultyBands[gameId] = currentBand;
      }

      extractFactsCharLimitMap[gameId] = Math.min(400, baseCharLimit);
      gutCheckVarianceMap[gameId] = baseVariance;
    }

    // ---------------------------------------------------------------------
    // STEP 3: CONTENT GENERATION & LOGGING
    // ---------------------------------------------------------------------
    for (const gameType of missingGames) {
      const band = targetDifficultyBands[GAME_CATALOG[gameType].mode];
      let finalPayload: ScenarioPayload | null = null;

      if (gameType === "steady_gaze") {
        finalPayload = SteadyGazeSchema.parse(
          generateSteadyGazeParams(
            targetDateStr,
            band,
            sensorySpeedMultipliers["STEADY_GAZE"],
          ),
        );
      } else if (gameType === "clear_air") {
        finalPayload = ClearTheAirSchema.parse(
          generateClearTheAirParams(
            targetDateStr,
            band,
            sensorySpeedMultipliers["CLEAR_THE_AIR"],
          ),
        );
      } else if (
        gameType === "extract_facts" ||
        gameType === "gut_check" ||
        gameType === "read_designs"
      ) {
        let generationPrompt = "";
        // Re-read per game (not hoisted) so a game generated earlier in this
        // same run is part of the next game's anti-repetition list, exactly as
        // in the backend original.
        let recentTopics: string[] = [];
        try {
          const history = await prisma.daily_scenarios.findMany({
            orderBy: { play_date: "desc" },
            take: 10,
            select: { scenario_data: true },
          });
          recentTopics = history
            .map((h) => {
              const data = h.scenario_data as {
                topic?: string;
                industry_theme?: string;
              } | null;
              return data?.topic || data?.industry_theme;
            })
            .filter((t): t is string => Boolean(t));
        } catch {}

        const today = targetDateStr;
        const targetDifficulty = band;

        if (gameType === "gut_check") {
          const targetVariance = (
            gutCheckVarianceMap.GUT_CHECK ?? 10.0 + band * 5.0
          ).toFixed(1);

          generationPrompt = `Return ONLY a raw JSON object for 'Gut Check'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.
Target Difficulty Tier: ${targetDifficulty} out of 5 (1 = Obvious and straightforward trivia benchmarks; 5 = Obscure, highly counter-intuitive metrics requiring precise approximation skills).

THEME VARIETY INSTRUCTIONS:
Select a fun, high-level, broad general knowledge domain that appeals to a mainstream audience. The theme must be widely recognizable and culturally accessible.
Mandatory broad categories to pick from (rotate or select one dynamically):
- Global Landmarks & Travel Geography (e.g., world capitals, flight distances, mountain ranges, famous rivers)
- Everyday Culinary Arts & Food Culture (e.g., standard baking temperatures, regional crop production scales, restaurant milestones)
- Consumer Tech & Modern Internet History (e.g., launch years of popular apps, standard battery life capacities, pixel counts)
- Major Sports & Athletic Milestones (e.g., marathon lengths, Olympic records, historic stadium seating capacities)
- Everyday Urban Economics & Lifestyle (e.g., average commute times, common household sizes, historical currency shifts)
- Science & Natural Phenomena (e.g., average rainfall, standard atmospheric pressures, common chemical concentrations)
- Science & Discovery (e.g., average lifespan of common species, standard measurements in physics, historical scientific milestones)
- History & Cultural Landmarks (e.g., founding years of major cities, historical population counts, landmark construction dates)
- Fun Facts & Trivia (e.g., world record statistics, quirky historical facts, unusual natural occurrences)
- Geography & Environmental Science (e.g., average river lengths, standard ocean depths, common climate statistics)
- Biology & Life Sciences (e.g., average gestation periods, standard lifespans of species, common biological measurements)
- Astronomy & Space Exploration (e.g., average distances to celestial bodies, standard orbital periods, historical space mission dates)
- Modern discoveries & Innovations (e.g., launch years of major tech products, standard measurements in engineering, recent scientific breakthroughs)

CRITICAL BAN LIST (NEVER GENERATE THESE):
Do NOT focus on hyper-niche academic disciplines, marine biology, deep-sea exploration, oceanography, astrophysics, space metrics, 'Mycology', 'Mushroom networks', 'Burj Khalifa', architectural building heights, or specialized scientific lab values.

ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map((t) => `'${t}'`).join(", ")}]

CRITICAL LENGTH CONSTRAINTS:
1. Every 'anchor_statement' MUST be under a strict maximum length of 150 characters.
2. Every 'the_real_question' MUST be under a strict maximum length of 150 characters.

MANDATORY QUESTION STYLE & ANCHOR VARIANCE RULE:
Every question segment pairs an 'anchor_statement' with a 'the_real_question':
1. An 'anchor_statement': MUST be a strictly binary Yes/No question — a closed interrogative whose ONLY valid answers are "Yes" or "No".
   STRICT YES/NO RULES (all mandatory):
   - MUST begin with one of: Is, Are, Was, Were, Does, Do, Did, Has, Have, Can, Could, Will, Would.
   - MUST end with a question mark.
   - MUST NOT begin with or contain an interrogative word: how, how many, how much, what, which, when, where, who, why.
   - MUST NOT offer a choice ("A or B?"), MUST NOT be compound (no "and"/"or" joining two separate questions), MUST NOT be open-ended or ask the user to supply a value.
   - MUST contain exactly ONE numeric benchmark, expressed as a comparison boundary using "more than", "less than", "at least", "over", "under", or "exactly".
   - MUST be phrased as a declarative claim in question form, never as a statement with a trailing question mark.
   VALID: "Does a standard marathon cover more than 30 miles?" / "Was Instagram launched before 2010?"
   INVALID: "How many miles is a marathon?" (wh-word) / "A marathon is 26.2 miles, correct?" (statement) / "Is a marathon 26.2 or 42 km?" (choice)
   - NUMERICAL VARIANCE ADJUSTMENT: When 'is_anchor_true' is false, the incorrect baseline number placed inside the 'anchor_statement' string MUST mathematically deviate away from the actual true value ('the_real_number') by approximately ${targetVariance}%. Use this factor to control how far away the anchor trick is from reality.

Field Mapping Specifications:
1. 'industry_theme': A friendly, accessible theme title representing the specific general knowledge sector chosen.
2. 'anchor_statement': The literal "Yes/No" baseline statement text under 150 characters.
3. 'is_anchor_true': Boolean (true/false) indicating whether the initial 'anchor_statement' benchmark is factually accurate. Maintain a mix of true and false flags across the 3 questions.
4. 'the_real_question': The follow-up question string specifically asking for the exact parameter/measurement under 150 characters.
5. 'the_real_number': The absolute, precise, factually accurate raw numerical answer to 'the_real_question'.
6. Do not wrap the JSON output in markdown backticks or code blocks.

Expected JSON Structure:
{
  "industry_theme": "<A Broad, Accessible, and General Interest Theme>",
  "questions": [
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary under 150 chars>", "is_anchor_true": false, "the_real_question": "<Follow-up question requesting the actual target metric under 150 chars>", "the_real_number": 26.2, "unit": "miles", "difficulty_level": "Easy" },
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary under 150 chars>", "is_anchor_true": true, "the_real_question": "<Follow-up question requesting the actual target metric under 150 chars>", "the_real_number": 1997, "unit": "year", "difficulty_level": "Medium" },
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary under 150 chars>", "is_anchor_true": false, "the_real_question": "<Follow-up question requesting the actual target metric under 150 chars>", "the_real_number": 120, "unit": "minutes", "difficulty_level": "Hard" }
  ]
}`;
        } else if (gameType === "extract_facts") {
          const targetCharLimit = Math.min(
            400,
            extractFactsCharLimitMap.EXTRACT_THE_FACTS ??
              Math.floor(280 * (1 + (band - 3) * 0.1)),
          );

          generationPrompt = `Return ONLY a raw JSON object for 'Extract the Facts'.
Date: ${today}.
Entropy Factor: ${Math.random().toString(36).substring(7)}.
Target Difficulty Tier: ${targetDifficulty} out of 5 (1 = Simple and literal phrasing, 5 = Highly complex, academic phrasing with subtle, interwoven logic traps).

ANTI-REPETITION FILTER:
You must select a radically different topic than these recent entries: [${recentTopics.map((t) => `'${t}'`).join(", ")}].
Vary between: global industry shifts, ethical dilemmas in technology, sensitive societal controversies, corporate policy changes, or complex human behaviors.

THEME AND VOICE INSTRUCTIONS:
1. Topic Choice: Select high-impact, potentially polarizing themes (e.g., automated workforce monitoring, algorithmic market allocation, synthetic asset deployment).
2. ANONYMITY RULE: ABSOLUTELY NO PROPER NOUNS. Use generic placeholders like: Company X, City Y, Country Z, The Organization, The Platform, The New Tech, The Industry, or The Group. Do not name specific brands, actual people, or real geographic locations.
3. Sentiment Variance:
   - Paragraph A: Pro-perspective (e.g., efficiency, progress, innovation, necessary sacrifice).
   - Paragraph B: Critical-perspective (e.g., human cost, moral danger, loss of privacy, long-term instability).
4. Strict Variable Length: Both paragraphs MUST individually remain strictly under an absolute cap of ${targetCharLimit} characters.
5. NO QUOTES: Do not use " or ' anywhere in the paragraph text.
6. Tone: Sharp, observational, and provocative.

Expected JSON Structure:
{
  "topic": "<Broad, Non-Specific, Polarizing Title>",
  "paragraph_a": "<Pro/Optimistic perspective, under ${targetCharLimit} chars, no quotes>",
  "paragraph_b": "<Critical/Cynical perspective, under ${targetCharLimit} chars, no quotes>",
  "mcq_questions": [
    { "question": "<Analytical question comparing the perspectives>", "options": ["A", "B", "C", "D"], "correct_answer_index": 0 },
    { "question": "<Analytical question regarding the core dilemma>", "options": ["A", "B", "C", "D"], "correct_answer_index": 2 },
    { "question": "<Analytical question testing deeper implications>", "options": ["A", "B", "C", "D"], "correct_answer_index": 1 }
  ],
  "takeaway_criteria": [
    "Provide 3 to 5 objective, short fact criteria points present in the paragraphs to automatically grade player takeaways later"
  ]
}`;
        } else {
          generationPrompt = `Return ONLY a raw JSON object for 'Dark Design'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.
Target Difficulty Tier: ${targetDifficulty} out of 5 (1 = Simple and obvious design patterns; 5 = Highly subtle, legalistic gray-area traps with deceptive micro-copy).

ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map((t) => `'${t}'`).join(", ")}]

CRITICAL CHARACTER & LANGUAGE CONSTRAINTS:
1. Questions and individual options (text, ui, ad, graph, a, b, c, d) MUST be under a strict maximum length of 150 characters.
2. The 'short_explanation' string MUST be under an absolute target limit of 170 characters to ensure safe compliance bounds.
3. Use clear, plain, everyday language. Avoid complex, academic, or niche industry buzzwords.

CORE GAME MECHANICAL RULES:
1. 'vector_mcq' structural requirement:
   - Provide an easy-to-read question asking the user to find which option uses a trick or deceptive setup.
   - Generate exactly 4 dynamic options under keys "text", "ui", "ad", and "graph".
   - Each individual option value MUST be a highly realistic micro-scenario description under 150 characters.
   - TEXT FOCUS: For the "text" key option, format it explicitly as a headline, tweet, notification banner, or email subject line.
   - To make it challenging, 2 or 3 of the wrong options should display slightly pushy marketing, high-pressure sale words, or slightly uneven chart setups. Exactly ONE option must cross the line completely into an objective, deceptive trick pattern.
   - Set 'correct_vector' to the key name holding that true deceptive trick, and 'correct_vector_index' to its 0-based array position (0-3).

2. 'manipulation_mcq' structural requirement:
   - Provide a plain question asking which specific trick name is being used in the answer chosen above.
   - Provide exactly 4 clear trick names inside an object layout mapped to the keys "a", "b", "c", and "d".
   - Set 'correct_vector' to the alphabetical key letter holding the true trick, and 'correct_vector_index' to its corresponding 0-based index position.

3. 'short_explanation' structural requirement:
   - Provide a single, plain text string under 170 characters.
   - COMPOSITION RULE: You must tightly combine two elements into this single string. First, clearly state WHAT the technique means (definition). Second, explain WHY it fits this option over the other grey-area choices.

Do not wrap the JSON output in markdown backticks or code blocks.

Expected JSON Structure:
{
  "vector_mcq": {
    "question": "Which of these everyday scenarios uses a deceptive trick?",
    "options": {
      "text": "<Dynamic short headline, tweet, or notification alert under 150 chars>",
      "ui": "<Dynamic short button trick description under 150 chars>",
      "ad": "<Dynamic short online deal blurb under 150 chars>",
      "graph": "<Dynamic short factual chart description under 150 chars>"
    },
    "correct_vector": "ui",
    "correct_vector_index": 1
  },
  "manipulation_mcq": {
    "question": "What is the name of the trick used in the setup above?",
    "options": {
      "a": "Confirmshaming",
      "b": "Visual Interference",
      "c": "Sneak into Basket",
      "d": "Roach Motel"
    },
    "correct_vector": "b",
    "correct_vector_index": 1
  },
  "short_explanation": "Visual Interference hides choices using design. It applies here because the giant accept button completely hides the tiny decline link text."
}`;
        }

        const parsed = await callGemini(generationPrompt, apiKey, gameType);

        if (gameType === "gut_check")
          finalPayload = GutCheckSchema.parse(parsed);
        else if (gameType === "extract_facts")
          finalPayload = ExtractFactsSchema.parse(parsed);
        else finalPayload = DarkDesignSchema.parse(parsed);
      } else {
        // Fallback for 'mental_reflex'
        finalPayload = {
          theme_title: `Automatic Generation Run ${gameType} for ${targetDateStr}`,
          scheduled_timestamp: Date.now(),
          distractor_shapes_count: Math.max(2, Math.min(10, 2 + band * 2)),
        };
      }

      if (!finalPayload) {
        throw new Error(`No payload produced for game type ${gameType}`);
      }

      // Delete pre-existing scenarios matching the target signature, then
      // commit the validated JSON payload (replaces the original's
      // Supabase upsert onConflict play_date,game_type_id).
      await prisma.daily_scenarios.deleteMany({
        where: { play_date: targetDate, game_type_id: gameType },
      });
      await prisma.daily_scenarios.create({
        data: {
          play_date: targetDate,
          game_type_id: gameType,
          difficulty_band: band,
          scenario_data: finalPayload,
        },
      });

      executionTraces.push(
        `[Success]: Generated and seeded [${gameType}] (Band ${band}) into daily_scenarios for [${targetDateStr}]`,
      );
    }

    return NextResponse.json({
      status: "Success",
      processed_date: targetDateStr,
      traces: executionTraces,
    });
  } catch (contentSeedingException: unknown) {
    return NextResponse.json(
      {
        error: "Self-Healing Seeding Exception",
        diagnostic_context: errMessage(contentSeedingException),
      },
      { status: 500 },
    );
  }
};

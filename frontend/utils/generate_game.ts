// generate_game.ts
// The single entry point for all game content generation.
//
// HOW IT WORKS (for each call to generate()):
//   1. Check the kalari_games DB table for a cached row matching (mode, today).
//      If valid cached content exists, return it immediately — Gemini is not called.
//   2. For STEADY_GAZE and CLEAR_THE_AIR, generate parameters algorithmically.
//   3. For GUT_CHECK and EXTRACT_THE_FACTS, call the Gemini API with a structured
//      prompt, then validate the returned JSON with Zod schemas.
//   4. Upsert the generated content into kalari_games for future cache hits.
//
// This file also works as a CLI script (for manual/cron generation):
//   npx ts-node utils/generate_game.ts --mode GUT_CHECK
// That's why yargs (CLI argument parser) and dotenv are imported here.

import { z } from "zod";
import yargs from "yargs"; // CLI argument parser — used only when run as a script
import { hideBin } from "yargs/helpers"; // strips "node script.ts" from process.argv
import dotenv from "dotenv";
import { prisma } from "./prismaInit";
import { getTodayIST } from "./seedRng";

// No-op in the Next.js runtime (the framework loads .env.local automatically),
// but required when this file is executed directly as a CLI script.
dotenv.config();

const { GOOGLE_GENERATIVE_AI_API_KEY } = process.env;

// ── Types ──────────────────────────────────────────────────────────────────

// The canonical identifier for every game mode. Must exactly match the Prisma
// GameType enum in prisma/schema.prisma. Use SCREAMING_SNAKE_CASE.
type GameMode =
  | "GUT_CHECK"
  | "EXTRACT_THE_FACTS"
  | "STEADY_GAZE"
  | "CLEAR_THE_AIR"
  | "READ_BETWEEN_DESIGNS"
  | "MENTAL_REFLEX";

// z.infer<typeof Schema> extracts the TypeScript type that the Zod schema
// describes. This way the type and the validation logic can't get out of sync —
// the type IS the schema, automatically.
type GutCheckGame = z.infer<typeof GutCheckSchema>;
type ExtractFactsGame = z.infer<typeof ExtractFactsSchema>;
type SteadyGazeGame = z.infer<typeof SteadyGazeSchema>;
type ClearAirGame = z.infer<typeof ClearAirSchema>;
// Union type: generate() can return any of the four game content shapes
type GameResult =
  | GutCheckGame
  | ExtractFactsGame
  | SteadyGazeGame
  | ClearAirGame;

// ── Schemas ────────────────────────────────────────────────────────────────
// Zod schemas serve two purposes:
//   1. Runtime validation — throw a descriptive error if Gemini returns wrong data
//   2. Type inference — the TypeScript types above are derived from these schemas

const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z
    .array(
      z.object({
        anchor_statement: z.string(),
        // GEMINI STRING COERCION: Gemini returns boolean fields as the string
        // literals "true" or "false" even when the response MIME type is
        // application/json. z.preprocess() transforms the raw value BEFORE Zod
        // validates it, converting "true"/"false" strings to actual booleans.
        is_anchor_true: z.preprocess((val) => {
          if (typeof val === "string") return val.toLowerCase() === "true";
          return Boolean(val);
        }, z.boolean()),
        the_real_question: z.string(),
        // Same coercion as is_anchor_true — numeric fields also arrive as strings.
        the_real_number: z.preprocess(
          (val) => parseFloat(val as string),
          z.number(),
        ),
        unit: z.string(),
        difficulty_level: z.string(),
      }),
    )
    .length(3), // exactly 3 questions per game
});

const ExtractFactsSchema = z.object({
  topic: z.string(),
  paragraph_a: z.string(), // factual narrative
  paragraph_b: z.string(), // spin/speculative narrative
  mcq_questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).length(4), // exactly 4 answer options
        // correct_answer_index arrives as a string like "2" from Gemini — coerce to int
        correct_answer_index: z.preprocess(
          (val) => parseInt(val as string, 10),
          z.number().min(0).max(3), // must be a valid 0–3 index
        ),
      }),
    )
    .length(3), // exactly 3 MCQ questions
});

// These schemas are used to validate algorithmically-generated parameters
// (not Gemini output). They ensure the generation functions produce well-formed data.
const SteadyGazeSchema = z.object({
  theme_title: z.string(),
  speed: z.number(),
  screen_color: z.string().regex(/^#[0-9A-F]{6}$/i), // must be a valid 6-digit hex colour
  dot_color: z.string().regex(/^#[0-9A-F]{6}$/i),
  shimmer_frequency: z.number(),
  spawn_pattern_seed: z.number(),
  base_shimmer_speed_multiplier: z.number(),
  miss_deceleration_factor: z.number(),
  max_expansion_cap_seconds: z.number(),
});

const ClearAirSchema = z.object({
  theme_title: z.string(),
  bubble_speed: z.number(),
  initial_distraction_ratio: z.number(),
  progression_intensity_multiplier: z.number(),
  max_bubble_density_cap: z.number(),
  bubble_acceleration_factor: z.number(),
  smudge_opacity_penalty: z.number(),
});

// ── Math Core & Algorithmic Helper Functions ───────────────────────────────

// Returns a stable float in [0, 1) derived from a date string.
// This is a simpler hash than the djb2 in seedRng.ts — it produces a float
// (not a uint32) which is sufficient for scalar parameters like colors and speeds
// (where entropy requirements are low), but NOT suitable as a mulberry32 seed.
const getDailySeed = (dateStr: string): number => {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    // << 5 shifts hash left by 5 bits (equivalent to × 32); − hash = × 31 total.
    // This is a simple integer hash function often called "Java's String.hashCode".
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Math.sin introduces non-linearity to spread the values; % 1 takes the fractional part.
  return Math.abs(Math.sin(hash)) % 1;
};

// Converts HSL colour values to a CSS hex string like "#FF0033".
// Standard colour-math algorithm; the same function exists in seedRng.ts for
// client-side use — the server-side version here is separate by design.
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

// Generates Steady Gaze parameters from today's date. These are stored in
// kalari_games for caching but the client-side page.tsx recomputes them itself
// (since Steady Gaze requires no server round-trip). The DB row is kept for
// consistency and historical auditing.
const generateSteadyGazeParams = (today: string) => {
  const seed = getDailySeed(today + "steady_gaze");
  const baseHue = Math.floor(seed * 360);
  const oppositeHue = (baseHue + 180) % 360; // complementary hue (not used by the page)

  return {
    theme_title: `Pure Awareness Run #${baseHue}`,
    speed: parseFloat((0.8 + seed * 1.5).toFixed(2)),
    screen_color: hslToHex(baseHue, 60, 45),
    dot_color: hslToHex(oppositeHue, 85, 65),
    shimmer_frequency: parseFloat((2.0 + seed * 4.0).toFixed(1)),
    spawn_pattern_seed: parseFloat(seed.toFixed(4)),
    base_shimmer_speed_multiplier: 1.25,
    miss_deceleration_factor: 0.8,
    max_expansion_cap_seconds: 4.5,
  };
};

// Same purpose as generateSteadyGazeParams but for Clear the Air.
const generateClearAirParams = (today: string) => {
  const seed = getDailySeed(today + "clear_air");
  const variantId = Math.floor(seed * 1000);

  return {
    theme_title: `Dissolving Distractions Pattern v${variantId}`,
    bubble_speed: parseFloat((1.2 + seed * 2.3).toFixed(2)),
    initial_distraction_ratio: parseFloat((0.3 + seed * 0.2).toFixed(2)),
    progression_intensity_multiplier: parseFloat((1.5 + seed * 1.5).toFixed(2)),
    max_bubble_density_cap: Math.floor(25 + seed * 15),
    bubble_acceleration_factor: 0.05,
    smudge_opacity_penalty: 0.65,
  };
};

// ── Main generate() function ───────────────────────────────────────────────

const generate = async (
  customMode: GameMode | null = null, // which game to generate (null = use CLI arg)
  forceRefresh: boolean = false, // bypass the DB cache and regenerate fresh content
): Promise<GameResult> => {
  // yargs parses --mode and --forceRefresh from process.argv. In the web
  // runtime, server actions always pass customMode directly, so this is only
  // consulted when the file is run as a CLI script.
  const argv = yargs(hideBin(process.argv)).argv as {
    mode?: string;
    forceRefresh?: boolean | string;
  };
  // Priority: function argument > CLI flag > default to EXTRACT_THE_FACTS
  const mode: GameMode = (customMode ||
    argv.mode ||
    "EXTRACT_THE_FACTS") as GameMode;

  // The platform's "day" rolls over at IST midnight — the same boundary the
  // daily play lock uses (utils/getCurrentDayRange.ts). getTodayIST() returns
  // today's date string in IST (e.g. "2026-06-10"). Deriving this from the
  // server's own timezone instead would desync content from the lock: on a UTC
  // server, players between IST midnight and UTC midnight (00:00–05:30 IST)
  // would be served the previous day's content under a fresh daily lock.
  const today = getTodayIST();
  // Store the IST date at UTC midnight as the scheduled_for value so the unique
  // key (mode, scheduled_for) is consistent regardless of server timezone.
  const todayDate = new Date(`${today}T00:00:00.000Z`);

  try {
    // ── Step 1: Check the DB cache ────────────────────────────────────────
    // kalari_games has a unique constraint on (mode, scheduled_for).
    // If a row exists for today, return it directly — no Gemini call needed.
    //
    // We do a lightweight structural validation on the cached content rather
    // than trusting it blindly, because early Gemini runs stored malformed data
    // (the "mycology bug": Gemini ignored the anti-repetition filter and kept
    // generating mushroom-themed Gut Check content despite being told not to).
    if (!forceRefresh) {
      const existing = await prisma.kalari_games.findUnique({
        where: {
          mode_scheduled_for: {
            mode,
            scheduled_for: todayDate,
          },
        },
        select: { content: true }, // only fetch the content column, not the whole row
      });

      if (existing?.content) {
        // Cast to a partial type so we can probe for expected fields
        const content = existing.content as {
          industry_theme?: string;
          questions?: Array<{ the_real_question?: unknown }>;
          mcq_questions?: unknown[];
          screen_color?: string;
          progression_intensity_multiplier?: number;
        };

        // Check that the cached content has at least one key field that
        // indicates it is structurally complete.
        const hasFacts = mode === "EXTRACT_THE_FACTS" && content.mcq_questions;
        const hasGaze = mode === "STEADY_GAZE" && content.screen_color;
        const hasAir =
          mode === "CLEAR_THE_AIR" && content.progression_intensity_multiplier;

        // Reject cached GUT_CHECK rows that are about mycology. Gemini repeatedly
        // generated mushroom-themed content early in the project despite the
        // explicit anti-repetition filter. Those rows were left in the DB (not
        // deleted) but we skip them here so a fresh non-mycology row is generated.
        const isStuckMushroom = content?.industry_theme
          ?.toLowerCase()
          .includes("mycology");
        const hasGut =
          mode === "GUT_CHECK" &&
          content?.questions?.[0]?.hasOwnProperty("the_real_question") &&
          !isStuckMushroom;

        if (hasGaze || hasAir || hasFacts || hasGut) {
          return content as GameResult; // cache hit — return early, skip Gemini
        }
      }
    }

    // ── Step 2: Generate fresh content ───────────────────────────────────
    let validated: GameResult;

    if (mode === "STEADY_GAZE") {
      // Algorithmic: no API call needed
      const rawParams = generateSteadyGazeParams(today);
      validated = SteadyGazeSchema.parse(rawParams); // validate before storing
    } else if (mode === "CLEAR_THE_AIR") {
      // Algorithmic: no API call needed
      const rawParams = generateClearAirParams(today);
      validated = ClearAirSchema.parse(rawParams);
    } else {
      // AI-generated (GUT_CHECK or EXTRACT_THE_FACTS): call Gemini
      if (!GOOGLE_GENERATIVE_AI_API_KEY) {
        throw new Error(
          "Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
        );
      }
      const apiKey: string = GOOGLE_GENERATIVE_AI_API_KEY;
      let prompt = "";
      if (mode === "GUT_CHECK") {
        prompt = `Return ONLY a raw JSON object for 'Gut Check'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

THEME VARIETY INSTRUCTIONS:
Select an entirely random, creative, unique industry domain, scientific discovery sector, marine biology metric, astrophysics trend, historical era, or micro-economic dataset.
CRITICAL ANTI-REPETITION FILTER: Do NOT focus on 'Mycology', 'Mushroom networks', 'Burj Khalifa', architectural building heights, or any previously generated configurations.

MANDATORY QUESTION STYLE:
Every single question segment must consist of two steps:
1. An 'anchor_statement': Phrased as a clear binary "Yes/No" baseline check containing a numeric benchmark (e.g., "Is the speed of sound faster than 1200 kilometers per hour?").
2. A 'the_real_question': A direct numerical question fallback styled to ask the user for the actual metrics if they guess incorrectly or encounter a false anchor (e.g., "What is the exact speed of sound in dry air at 20 degrees Celsius?").

Field Mapping Specifications:
1. 'industry_theme': A descriptive theme title representing the specific knowledge sector chosen.
2. 'anchor_statement': The literal "Yes/No" baseline statement text.
3. 'is_anchor_true': Boolean (true/false) indicating whether the initial 'anchor_statement' benchmark is factually accurate. Maintain a mix of true and false flags across the 3 questions.
4. 'the_real_question': The follow-up question string specifically asking for the exact parameter/measurement.
5. 'the_real_number': The absolute, precise, factually accurate raw numerical answer to 'the_real_question'.
6. Do not wrap the JSON output in markdown backticks or code blocks.

Expected JSON Structure:
{
  "industry_theme": "<A Creative, Specific Industry or Scientific Theme>",
  "questions": [
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", "is_anchor_true": true, "the_real_question": "<Follow-up question requesting the actual target metric>", "the_real_number": 1234.5, "unit": "<unit>", "difficulty_level": "Easy" },
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", "is_anchor_true": false, "the_real_question": "<Follow-up question requesting the actual target metric>", "the_real_number": 567, "unit": "<unit>", "difficulty_level": "Medium" },
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", "is_anchor_true": false, "the_real_question": "<Follow-up question requesting the actual target metric>", "the_real_number": 0.12, "unit": "<unit>", "difficulty_level": "Hard" }
  ]
}`;
      } else {
        prompt = `Return ONLY a raw JSON object for 'Extract the Facts'.
Date: ${today}.
THEME AND VOICE INSTRUCTIONS:
1. Topic Choice: Select a creative, specific, completely non-political and non-controversial real-world scene, trend, or human interest event. 
   CRITICAL: Avoid using the literal words 'city infrastructure', 'library hours', 'community sports', or 'public space re-routing' as the primary topic. Innovate a fresh focus each run.
2. ABSOLUTE FILTER: Do NOT include any political parties, politician names, government election disputes, polarizing social debates, or sensitive geopolitical events.
3. Style, Tone & Sentiment Variance: Write paragraphs formatted to simulate a concise local news blurb, a high-engagement social media post, or a fast tabloid snippet.
4. THE CORE DIFFERENCE: The differences between the two paragraphs do NOT need to be numbers. Instead, focus heavily on structural sentiment swaps and perspective spins.
5. Strict Length Constraint: Both 'paragraph_a' and 'paragraph_b' must be kept crisp and short, fitting within a standard 280-character Twitter length limit.
6. Formatting Rule: Do NOT include any quotation marks (" or ') anywhere inside the paragraphs. 
7. Do not accidentally take a direct quote from any tabloid, news source, or social media post.

Expected JSON Structure:
{
  "topic": "<General Non-Controversial Real-World Trend or Event>",
  "paragraph_a": "<Crisp text under 280 characters with a distinct emotional perspective, no quotes>",
  "paragraph_b": "<Crisp text under 280 characters describing the same scene with a contrasting sentiment/vocabulary spin, no quotes>",
  "mcq_questions": [
    { "question": "<Analytical question testing differences in sentiment, wording, or facts between the texts>", "options": ["Option A", "Option B", "Option C", "Option D"], "correct_answer_index": 0 },
    { "question": "<Analytical question testing differences in sentiment, wording, or facts between the texts>", "options": ["Option A", "Option B", "Option C", "Option D"], "correct_answer_index": 2 },
    { "question": "<Analytical question testing differences in sentiment, wording, or facts between the texts>", "options": ["Option A", "Option B", "Option C", "Option D"], "correct_answer_index": 1 }
  ]
}`;
      }

      // Direct REST call to the Gemini API. responseMimeType: "application/json"
      // tells Gemini to return JSON, but in practice it still encodes booleans
      // and numbers as strings — hence the Zod preprocess() coercions above.
      // temperature: 1.0 maximises variety so each day's content is different.
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
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

      const data = await response.json();
      // Navigate the Gemini response structure to extract the generated text.
      // ?. is optional chaining — returns undefined instead of throwing if any
      // intermediate field is missing (e.g. if Gemini returns an error response).
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text as
        | string
        | undefined;
      if (!rawText) throw new Error("API returned empty candidates.");

      // Parse the JSON string into an object, then validate it with the Zod schema.
      // If the shape doesn't match (missing fields, wrong types), Zod throws a
      // ZodError with a detailed message — caught below.
      const parsed: unknown = JSON.parse(rawText);
      validated =
        mode === "GUT_CHECK"
          ? GutCheckSchema.parse(parsed)
          : ExtractFactsSchema.parse(parsed);
    }

    // ── Step 3: Upsert into the DB cache ─────────────────────────────────
    // upsert = insert if not exists, update if exists. Using upsert (not insert)
    // means a forceRefresh run or a race between two simultaneous cold requests
    // won't create duplicate rows (which would violate the unique constraint).
    let dbTopic = mode as string; // default topic label = the mode name
    if (mode === "GUT_CHECK")
      dbTopic = (validated as GutCheckGame).industry_theme;
    if (mode === "EXTRACT_THE_FACTS")
      dbTopic = (validated as ExtractFactsGame).topic;
    if (mode === "STEADY_GAZE" || mode === "CLEAR_THE_AIR") {
      dbTopic = (validated as SteadyGazeGame | ClearAirGame).theme_title;
    }

    await prisma.kalari_games.upsert({
      where: {
        mode_scheduled_for: {
          mode,
          scheduled_for: todayDate,
        },
      },
      update: {
        topic: dbTopic,
        content: validated,
      },
      create: {
        mode,
        topic: dbTopic,
        content: validated,
        scheduled_for: todayDate,
      },
    });

    return validated;
  } catch (err) {
    console.error("🛑 SCRIPT ERROR:", (err as Error).message);
    // ZodError has a detailed `issues` array describing exactly which fields
    // failed validation and why — very useful for debugging Gemini output changes.
    if (err instanceof z.ZodError) {
      console.error("Validation Details:", JSON.stringify(err.issues, null, 2));
    }
    throw err; // re-throw so the calling server action can return an error response
  }
  // Deliberately NO prisma.$disconnect() here. `prisma` is the app-wide
  // singleton (utils/prismaInit.ts) shared by every server action. With the
  // pg driver adapter, $disconnect() actually ends the underlying connection
  // pool — so disconnecting after each content fetch (including cache hits)
  // would yank the pool out from under any concurrent request mid-query and
  // force a full reconnect on the next one. If a CLI wrapper ever invokes
  // generate() directly, that wrapper must call prisma.$disconnect() itself
  // when done so the Node process can exit cleanly.
};

export { generate };
export type {
  GameMode,
  GutCheckGame,
  ExtractFactsGame,
  SteadyGazeGame,
  ClearAirGame,
  GameResult,
};

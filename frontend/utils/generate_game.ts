import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";
import { prisma } from "./prismaInit";

// No-op in the Next.js runtime (env vars are loaded by the framework), but
// required when this file is invoked directly as a CLI script.
dotenv.config();

const { GOOGLE_GENERATIVE_AI_API_KEY } = process.env;

// ── Types ──────────────────────────────────────────────────────────────────

export type GameMode =
  | "GUT_CHECK"
  | "EXTRACT_THE_FACTS"
  | "STEADY_GAZE"
  | "CLEAR_THE_AIR"
  | "READ_BETWEEN_DESIGNS"
  | "MENTAL_REFLEX";
export type GutCheckGame = z.infer<typeof GutCheckSchema>;
export type ExtractFactsGame = z.infer<typeof ExtractFactsSchema>;
export type SteadyGazeGame = z.infer<typeof SteadyGazeSchema>;
export type ClearAirGame = z.infer<typeof ClearAirSchema>;
export type GameResult =
  | GutCheckGame
  | ExtractFactsGame
  | SteadyGazeGame
  | ClearAirGame;

// ── Schemas ────────────────────────────────────────────────────────────────

const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z
    .array(
      z.object({
        anchor_statement: z.string(),
        // Gemini returns booleans as string literals ("true"/"false") even when
        // the response MIME type is application/json — preprocess coerces them.
        is_anchor_true: z.preprocess((val) => {
          if (typeof val === "string") return val.toLowerCase() === "true";
          return Boolean(val);
        }, z.boolean()),
        the_real_question: z.string(),
        // Same reason as is_anchor_true — numbers arrive as strings.
        the_real_number: z.preprocess(
          (val) => parseFloat(val as string),
          z.number(),
        ),
        unit: z.string(),
        difficulty_level: z.string(),
      }),
    )
    .length(3),
});

const ExtractFactsSchema = z.object({
  topic: z.string(),
  paragraph_a: z.string(),
  paragraph_b: z.string(),
  mcq_questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).length(4),
        correct_answer_index: z.preprocess(
          (val) => parseInt(val as string, 10),
          z.number().min(0).max(3),
        ),
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

// Returns a stable [0, 1) float for use as a scalar seed (colors, speeds, etc.).
const getDailySeed = (dateStr: string): number => {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(Math.sin(hash)) % 1;
}

// Returns a stable uint32 integer for use as a PRNG seed (mulberry32 requires
// an integer — passing a float like 0.7341 would truncate to 0 via >>> 0,
// making every day's spawn sequence identical). Matches the client-side
// getDailySeed in steady_gaze/page.tsx exactly.
const getDailySeedInt = (dateStr: string): number => {
  let hash = 5381;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (Math.imul(hash, 33) ^ dateStr.charCodeAt(i)) >>> 0;
  }
  return hash; // uint32
}

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
}

const generateSteadyGazeParams = (today: string) => {
  // Use the djb2 uint32 seed (same algorithm as the client) normalised to [0,1)
  // so the stored visual params match what the client actually renders.
  const seed = getDailySeedInt(today + "steady_gaze") / 0x100000000;
  const baseHue = Math.floor(seed * 360);
  // Complementary colour (opposite on the colour wheel) ensures strong contrast
  // between background and dot without manual colour curation.
  const oppositeHue = (baseHue + 180) % 360;

  return {
    theme_title: `Pure Awareness Run #${baseHue}`,
    speed: parseFloat((0.8 + seed * 1.5).toFixed(2)),
    screen_color: hslToHex(baseHue, 60, 45),
    dot_color: hslToHex(oppositeHue, 85, 65),
    shimmer_frequency: parseFloat((2.0 + seed * 4.0).toFixed(1)),
    spawn_pattern_seed: getDailySeedInt(today + "steady_gaze"),
    base_shimmer_speed_multiplier: 1.25,
    miss_deceleration_factor: 0.8,
    max_expansion_cap_seconds: 4.5,
  };
}

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
}

// ── Main Runtime Execution Export ──────────────────────────────────────────

const generate = async (
  customMode: GameMode | null = null,
  forceRefresh: boolean = false,
): Promise<GameResult> => {
  // argv is parsed for CLI compatibility only. Server actions always supply
  // customMode, so argv.mode is never consulted in the web runtime.
  const argv = yargs(hideBin(process.argv)).argv as {
    mode?: string;
    forceRefresh?: boolean | string;
  };
  const mode: GameMode = (customMode ||
    argv.mode ||
    "EXTRACT_THE_FACTS") as GameMode;

  const now = new Date();
  // Hard-code IST offset (+5:30) so the cache key always matches the IST
  // day boundary used by checkHasPlayedToday / getCurrentDayRange.ts.
  // getTimezoneOffset() would return 0 on a UTC server, giving the wrong date
  // for 5.5 hours after each IST midnight.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const today = new Date(now.getTime() + IST_OFFSET_MS)
    .toISOString()
    .split("T")[0];
  const todayDate = new Date(`${today}T00:00:00.000Z`);

  try {
    // Check kalari_games for a cached row before calling Gemini.
    // We validate the cached content structurally rather than trusting it
    // blindly — previous runs may have stored malformed data (e.g. the
    // mycology bug where Gemini ignored the anti-repetition filter).
    if (!forceRefresh) {
      const existing = await prisma.kalari_games.findUnique({
        where: {
          mode_scheduled_for: {
            mode,
            scheduled_for: todayDate,
          },
        },
        select: { content: true },
      });

      if (existing?.content) {
        const content = existing.content as {
          industry_theme?: string;
          questions?: Array<{ the_real_question?: unknown }>;
          mcq_questions?: unknown[];
          screen_color?: string;
          progression_intensity_multiplier?: number;
        };

        const hasFacts = mode === "EXTRACT_THE_FACTS" && content.mcq_questions;
        const hasGaze = mode === "STEADY_GAZE" && content.screen_color;
        const hasAir =
          mode === "CLEAR_THE_AIR" && content.progression_intensity_multiplier;

        // Reject any cached GUT_CHECK that is about mycology — Gemini repeatedly
        // generated mushroom-themed content early on despite the anti-repetition
        // filter, so those rows were manually invalidated but left in the DB.
        const isStuckMushroom = content?.industry_theme
          ?.toLowerCase()
          .includes("mycology");
        const hasGut =
          mode === "GUT_CHECK" &&
          content?.questions?.[0]?.hasOwnProperty("the_real_question") &&
          !isStuckMushroom;

        if (hasGaze || hasAir || hasFacts || hasGut) {
          return content as GameResult;
        }
      }
    }

    let validated: GameResult;

    if (mode === "STEADY_GAZE") {
      const rawParams = generateSteadyGazeParams(today);
      validated = SteadyGazeSchema.parse(rawParams);
    } else if (mode === "CLEAR_THE_AIR") {
      const rawParams = generateClearAirParams(today);
      validated = ClearAirSchema.parse(rawParams);
    } else {
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
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text as
        | string
        | undefined;
      if (!rawText) throw new Error("API returned empty candidates.");

      const parsed: unknown = JSON.parse(rawText);
      validated =
        mode === "GUT_CHECK"
          ? GutCheckSchema.parse(parsed)
          : ExtractFactsSchema.parse(parsed);
    }

    // Upsert rather than insert so that forceRefresh runs (or a race between
    // two simultaneous cold requests) don't create duplicate rows for the same
    // (mode, scheduled_for) pair.
    let dbTopic = mode as string;
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
    if (err instanceof z.ZodError) {
      console.error("Validation Details:", JSON.stringify(err.issues, null, 2));
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
};

export { generate };

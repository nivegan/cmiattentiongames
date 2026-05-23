import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";
import { prisma } from "./prismaInit";

dotenv.config({ path: ".env.local" });

const { GOOGLE_GENERATIVE_AI_API_KEY, DATABASE_URL } = process.env;

if (!GOOGLE_GENERATIVE_AI_API_KEY || !DATABASE_URL) {
  throw new Error("Missing required environment variables.");
}

// ── Types ──────────────────────────────────────────────────────────────────

export type GameMode =
  | "gut_check"
  | "extract_facts"
  | "steady_gaze"
  | "clear_air";
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
        is_anchor_true: z.preprocess((val) => {
          if (typeof val === "string") return val.toLowerCase() === "true";
          return Boolean(val);
        }, z.boolean()),
        the_real_question: z.string(),
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
});

const ClearAirSchema = z.object({
  theme_title: z.string(),
  bubble_speed: z.number(),
  initial_distraction_ratio: z.number(),
  progression_intensity_multiplier: z.number(),
  max_bubble_density_cap: z.number(),
});

// ── Math Core & Algorithmic Helper Functions ───────────────────────────────

function getDailySeed(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(Math.sin(hash)) % 1;
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

function generateSteadyGazeParams(today: string) {
  const seed = getDailySeed(today + "steady_gaze");
  const baseHue = Math.floor(seed * 360);
  const oppositeHue = (baseHue + 180) % 360;

  return {
    theme_title: `Pure Awareness Run #${baseHue}`,
    speed: parseFloat((0.8 + seed * 1.5).toFixed(2)),
    screen_color: hslToHex(baseHue, 75, 50),
    dot_color: hslToHex(oppositeHue, 75, 50),
    shimmer_frequency: parseFloat((2.0 + seed * 4.0).toFixed(1)),
    spawn_pattern_seed: parseFloat(seed.toFixed(4)),
  };
}

function generateClearAirParams(today: string) {
  const seed = getDailySeed(today + "clear_air");
  const variantId = Math.floor(seed * 1000);

  return {
    theme_title: `Dissolving Distractions Pattern v${variantId}`,
    bubble_speed: parseFloat((1.2 + seed * 2.3).toFixed(2)),
    initial_distraction_ratio: parseFloat((0.3 + seed * 0.2).toFixed(2)),
    progression_intensity_multiplier: parseFloat((1.5 + seed * 1.5).toFixed(2)),
    max_bubble_density_cap: Math.floor(25 + seed * 15),
  };
}

// ── Main Runtime Execution Export ──────────────────────────────────────────

const generate = async (
  customMode: GameMode | null = null,
  forceRefresh: boolean = false,
): Promise<GameResult> => {
  const argv = yargs(hideBin(process.argv)).argv as { mode?: string };
  const mode: GameMode = (customMode ||
    argv.mode ||
    "extract_facts") as GameMode;

  // Chennai Local Date
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now.getTime() - offset).toISOString().split("T")[0];
  const todayDate = new Date(`${today}T00:00:00.000Z`);

  try {
    // 2. RESUBMIT LOCK: Checks cache lock so games stay stable for 24 hours
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
          questions?: Array<{ the_real_question?: unknown }>;
          mcq_questions?: unknown[];
          screen_color?: string;
          progression_intensity_multiplier?: number;
        };

        const hasGut = mode === "gut_check" && content.questions;
        const hasFacts = mode === "extract_facts" && content.mcq_questions;
        const hasGaze = mode === "steady_gaze" && content.screen_color;
        const hasAir =
          mode === "clear_air" && content.progression_intensity_multiplier;

        if (
          hasGaze ||
          hasAir ||
          hasFacts ||
          (hasGut &&
            content.questions?.[0]?.hasOwnProperty("the_real_question"))
        ) {
          // const out = JSON.stringify(content, null, 2);
          // process.stdout.write(out + "\n");
          return content as GameResult;
        }
      }
    }

    let validated: GameResult;

    // SEPARATION OF CONCERNS ROUTING ENGINE
    if (mode === "steady_gaze") {
      const rawParams = generateSteadyGazeParams(today);
      validated = SteadyGazeSchema.parse(rawParams);
    } else if (mode === "clear_air") {
      const rawParams = generateClearAirParams(today);
      validated = ClearAirSchema.parse(rawParams);
    } else {
      // LLM GENERATION PIPELINE LAYER
      let prompt = "";
      if (mode === "gut_check") {
        prompt = `Return ONLY a raw JSON object for 'Gut Check'.
            Date: ${today}.
            
            THEME VARIETY INSTRUCTIONS:
            Select a highly unique industry, historical era, scientific sector, or macro trend domain each time.
            CRITICAL ANTI-REPETITION FILTER: Do NOT focus on the Burj Khalifa, architectural building heights, or any examples mentioned in this guide structure. Choose something completely fresh.

            MANDATORY QUESTION STYLE:
            Every single question segment must consist of two steps:
            1. An 'anchor_statement': Phrased as a clear binary "Yes/No" baseline check containing a numeric benchmark (e.g., "Is the speed of sound faster than 1200 kilometers per hour?").
            2. A 'the_real_question': A direct numerical question fallback styled to ask the user for the actual metrics if they guess incorrectly or encounter a false anchor (e.g., "What is the exact speed of sound in dry air at 20 degrees Celsius?").
            
            Field Mapping Specifications:
            1. 'anchor_statement': The literal "Yes/No" baseline statement text.
            2. 'is_anchor_true': Boolean (true/false) indicating whether the initial 'anchor_statement' benchmark is factually accurate. Maintain a mix of true and false flags across the 3 questions.
            3. 'the_real_question': The follow-up question string specifically asking for the exact parameter/measurement.
            4. 'the_real_number': The absolute, precise, factually accurate raw numerical answer to 'the_real_question'.
            5. Do not wrap the JSON output in markdown backticks or code blocks.

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

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GOOGLE_GENERATIVE_AI_API_KEY}`;
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
        mode === "gut_check"
          ? GutCheckSchema.parse(parsed)
          : ExtractFactsSchema.parse(parsed);
    }

    // ==========================================
    // 4. UNIFIED DATABASE SYNC UPSERT LAYER
    // ==========================================
    let dbTopic = mode as string;
    if (mode === "gut_check")
      dbTopic = (validated as GutCheckGame).industry_theme;
    if (mode === "extract_facts")
      dbTopic = (validated as ExtractFactsGame).topic;
    if (mode === "steady_gaze" || mode === "clear_air") {
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

    // const finalOutput = JSON.stringify(validated, null, 2);
    // process.stdout.write(finalOutput + "\n");

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

// FIX: Default execution changed to false to prevent accidental infinite generation cycles!
// if (
//   process.argv[1] &&
//   (process.argv[1].endsWith("generate_game.js") ||
//     process.argv[1].endsWith("generate_game.ts"))
// ) {
//   generate(null, false);
// }

export { generate };

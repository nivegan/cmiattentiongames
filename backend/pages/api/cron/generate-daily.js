import { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("[System Setup Error] Missing required environment variables (SUPABASE_URL, SUPABASE_KEY, or GOOGLE_GENERATIVE_AI_API_KEY).");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// =========================================================================
// 1. LIGHTWEIGHT TYPES TO BYPASS "NEXT" MODULE DEPENDENCY ERRORS
// =========================================================================
interface CustomRequest extends IncomingMessage {
  query: Partial<{ [key: string]: string | string[] }>;
  cookies: { [key: string]: string };
  body: any;
}

interface CustomResponse extends ServerResponse {
  status: (statusCode: number) => CustomResponse;
  json: (body: any) => void;
  send: (body: any) => void;
}

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

const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z
    .array(
      z.object({
        anchor_statement: z.string(),
        is_anchor_true: z.preprocess(
          (val) =>
            typeof val === "string"
              ? val.toLowerCase() === "true"
              : Boolean(val),
          z.boolean(),
        ),
        the_real_question: z.string(),
        the_real_number: z.preprocess((val) => parseFloat(val as string), z.number()),
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

const ClearAirSchema = z.object({
  theme_title: z.string(),
  bubble_speed: z.number(),
  initial_distraction_ratio: z.number(),
  progression_intensity_multiplier: z.number(),
  max_bubble_density_cap: z.number(),
  bubble_acceleration_factor: z.number(),
  smudge_opacity_penalty: z.number(),
});

// =========================================================================
// 3. MATHEMATICAL GENERATOR UTILITIES
// =========================================================================
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

function generateSteadyGazeParams(today: string, speedMultiplier: number): z.infer<typeof SteadyGazeSchema> {
  const seed = getDailySeed(today + "steady_gaze");
  const baseHue = Math.floor(seed * 360);
  const oppositeHue = (baseHue + 180) % 360;
  const calculatedSpeed = parseFloat((0.8 + seed * 1.5).toFixed(2));
  
  return {
    theme_title: `Pure Awareness Run #${baseHue}`,
    speed: parseFloat((calculatedSpeed * speedMultiplier).toFixed(2)),
    screen_color: hslToHex(baseHue, 60, 45),
    dot_color: hslToHex(oppositeHue, 85, 65),
    shimmer_frequency: parseFloat((2.0 + seed * 4.0).toFixed(1)),
    spawn_pattern_seed: parseFloat(seed.toFixed(4)),
    base_shimmer_speed_multiplier: 1.25,
    miss_deceleration_factor: 0.8,
    max_expansion_cap_seconds: 4.5,
  };
}

function generateClearAirParams(today: string, speedMultiplier: number): z.infer<typeof ClearAirSchema> {
  const seed = getDailySeed(today + "clear_air");
  const variantId = Math.floor(seed * 1000);
  const calculatedSpeed = parseFloat((1.2 + seed * 2.3).toFixed(2));
  
  return {
    theme_title: `Dissolving Distractions Pattern v${variantId}`,
    bubble_speed: parseFloat((calculatedSpeed * speedMultiplier).toFixed(2)),
    initial_distraction_ratio: parseFloat((0.3 + seed * 0.2).toFixed(2)),
    progression_intensity_multiplier: parseFloat((1.5 + seed * 1.5).toFixed(2)),
    max_bubble_density_cap: Math.floor(25 + seed * 15),
    bubble_acceleration_factor: 0.05,
    smudge_opacity_penalty: 0.65,
  };
}

// =========================================================================
// 4. TYPES & STORAGE FOR REFLECTION ENGINE
// =========================================================================
interface LogRow {
  game_type_id: string;
  status: "COMPLETED" | "ABANDONED" | "TIMED_OUT";
  final_score: number | null;
}

interface DifficultyParams {
  max_word_count: number;
  speed_multiplier: number;
  variance_multiplier: number;
  distractor_count: number;
}

// =========================================================================
// 5. MAIN ENDPOINT HANDLER
// =========================================================================
export default async function handler(req: CustomRequest, res: CustomResponse) {
  const now = new Date();
  const tomorrowDateObj = new Date(now);
  tomorrowDateObj.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrowDateObj.toISOString().split("T")[0];

  const daysOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayName = daysOfWeek[tomorrowDateObj.getDay()];

  // Standardized Schedule mapping
  const scheduleMap: Record<string, string[]> = {
    monday: ["extract_facts", "mental_reflex"],
    tuesday: ["gut_check", "steady_gaze"],
    wednesday: ["read_designs", "clear_air"],
    thursday: ["extract_facts", "steady_gaze"],
    friday: ["gut_check", "mental_reflex"],
    saturday: ["read_designs", "clear_air"],
    sunday: ["gut_check", "mental_reflex"]
  };

  const activeGameTypes = scheduleMap[dayName] || ["extract_facts", "mental_reflex"];
  const executionTraces: string[] = [];

  // Default baseline parameter configurations
  const adjustments: Record<string, DifficultyParams> = {
    extract_facts: { max_word_count: 150, speed_multiplier: 1.0, variance_multiplier: 1.0, distractor_count: 5 },
    read_designs: { max_word_count: 200, speed_multiplier: 1.0, variance_multiplier: 1.0, distractor_count: 5 },
    steady_gaze: { max_word_count: 150, speed_multiplier: 1.0, variance_multiplier: 1.0, distractor_count: 5 },
    clear_air: { max_word_count: 150, speed_multiplier: 1.0, variance_multiplier: 1.0, distractor_count: 5 },
    gut_check: { max_word_count: 150, speed_multiplier: 1.0, variance_multiplier: 1.0, distractor_count: 5 },
    mental_reflex: { max_word_count: 150, speed_multiplier: 1.0, variance_multiplier: 1.0, distractor_count: 5 }
  };

  // -----------------------------------------------------------------------
  // PIPELINE PHASE 1: TELEMETRY ANALYSIS ENGINE
  // -----------------------------------------------------------------------
  try {
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const { data: recentLogs, error: logError } = await supabase
      .from("game_logs")
      .select("game_type_id, status, final_score")
      .gte("created_at", sevenDaysAgo.toISOString());

    if (logError) throw logError;
    const parsedLogs = (recentLogs || []) as LogRow[];

    if (parsedLogs.length >= 5) {
      Object.keys(adjustments).forEach((gameId) => {
        const gameSubset = parsedLogs.filter(l => l.game_type_id === gameId);
        
        if (gameSubset.length >= 5) {
          const abandoned = gameSubset.filter(l => l.status === "ABANDONED").length;
          const completed = gameSubset.filter(l => l.status === "COMPLETED");
          const wins = completed.filter(l => (l.final_score ?? 0) >= 75).length;

          const abandonRate = abandoned / gameSubset.length;
          const winRate = completed.length > 0 ? wins / completed.length : 0;

          // Rule 1: Text Games (Extract / Designs) Word Count Calibrator
          if (gameId === "extract_facts" || gameId === "read_designs") {
            if (abandonRate > 0.20) {
              adjustments[gameId].max_word_count = Math.max(80, Math.floor(adjustments[gameId].max_word_count * 0.90));
            } else if (winRate > 0.85) {
              adjustments[gameId].max_word_count = Math.min(350, Math.floor(adjustments[gameId].max_word_count * 1.10));
            }
          }
          // Rule 2: Sensory (Gaze / Air) Speed Calibrator
          else if (["steady_gaze", "clear_air"].includes(gameId)) {
            if (winRate > 0.85) {
              adjustments[gameId].speed_multiplier = 1.05; // 5% Speed boost
            } else if (winRate < 0.50) {
              adjustments[gameId].speed_multiplier = 0.95; // 5% Speed reduction
            }
          }
          // Rule 3: Logic (Gut Check) Anchor Statement Variance Calibrator
          else if (gameId === "gut_check") {
            if (winRate > 0.85) {
              adjustments.gut_check.variance_multiplier = 1.10; // 10% wider variance limit
            } else if (winRate < 0.40) {
              adjustments.gut_check.variance_multiplier = 0.90; // 10% tighter variance limit
            }
          }
          // Rule 4: Mental Reflex Layout Clutter Calibrator
          else if (gameId === "mental_reflex") {
            if (winRate < 0.30) {
              adjustments.mental_reflex.distractor_count = Math.max(2, adjustments.mental_reflex.distractor_count - 1);
            } else if (winRate > 0.80) {
              adjustments.mental_reflex.distractor_count = Math.min(10, adjustments.mental_reflex.distractor_count + 1);
            }
          }
        }
      });
      executionTraces.push("[Pipeline Phase 1]: Telemetry rules evaluated. Parameters adjusted successfully.");
    } else {
      executionTraces.push("[Pipeline Phase 1]: Telemetry skipped. Insufficient historical lookup rows.");
    }
  } catch (telemetryException: any) {
    return res.status(500).json({
      error: "Critical exception caught during Telemetry Refinement Phase",
      context: telemetryException.message,
    });
  }

  // -----------------------------------------------------------------------
  // PIPELINE PHASE 2: GENERATION & SEED TRANSACTION ENGINE
  // -----------------------------------------------------------------------
  try {
    for (const gameType of activeGameTypes) {
      let finalPayload: any = null;

      if (gameType === "steady_gaze") {
        const raw = generateSteadyGazeParams(tomorrowStr, adjustments.steady_gaze.speed_multiplier);
        finalPayload = SteadyGazeSchema.parse(raw);
      } 
      else if (gameType === "clear_air") {
        const raw = generateClearAirParams(tomorrowStr, adjustments.clear_air.speed_multiplier);
        finalPayload = ClearAirSchema.parse(raw);
      } 
      else if (gameType === "extract_facts" || gameType === "gut_check" || gameType === "read_designs") {
        let generationPrompt = "";

        if (gameType === "gut_check") {
          const customVariance = (20.0 * adjustments.gut_check.variance_multiplier).toFixed(1);
          generationPrompt = `Return ONLY a raw JSON object for 'Gut Check'. Date: ${tomorrowStr}. Entropy: ${Math.random()}.\nEnsure your anchoring numerical statements use an expanded variance adjustment of ${customVariance} to optimize target challenge metrics.\nExpected JSON Structure:\n{\n  "industry_theme": "<Theme>",\n  "questions": [\n    { "anchor_statement": "<Statement>", "is_anchor_true": true, "the_real_question": "<Question>", "the_real_number": 100, "unit": "units", "difficulty_level": "Adaptive" }\n  ]\n}`;
        } 
        else if (gameType === "extract_facts") {
          const wordLimit = adjustments.extract_facts.max_word_count;
          generationPrompt = `Return ONLY a raw JSON object for 'Extract the Facts'. Date: ${tomorrowStr}. Entropy: ${Math.random()}.\nCRITICAL: paragraph_a and paragraph_b combined MUST STRICTLY adhere to a maximum reading limit of ${wordLimit} words based on recent user performance bounds.\nExpected JSON Structure:\n{\n  "topic": "<Topic>",\n  "paragraph_a": "<Text>",\n  "paragraph_b": "<Text>",\n  "mcq_questions": [\n    { "question": "<Question>", "options": ["A","B","C","D"], "correct_answer_index": 0 }\n  ]\n}`;
        } 
        else {
          const wordLimit = adjustments.read_designs.max_word_count;
          generationPrompt = `Return ONLY a raw JSON object for 'Read the Designs'. Date: ${tomorrowStr}. Entropy: ${Math.random()}.\nCRITICAL: Ensure the copy block stays compact under an absolute cap of ${wordLimit} words. Include a tailored confirmation bias option trap tracking parameter inside the options matrix.\nExpected JSON Structure:\n{\n  "theme_title": "<Theme>",\n  "copy_block": "<Text>",\n  "mcq_questions": [\n    { "question": "<Question>", "options": ["A","B","C","D"], "correct_answer_index": 0, "is_confirmation_bias_trap": true }\n  ]\n}`;
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GOOGLE_GENERATIVE_AI_API_KEY}`;
        const aiResponse = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: generationPrompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 1.0,
            },
          }),
        });

        if (!aiResponse.ok) {
          throw new Error(`Downstream LLM channel service call failed with network response status code: ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        let rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) throw new Error(`Empty execution profile tokens generated via LLM channel for module type target ${gameType}`);

        rawText = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(rawText);
        
        if (gameType === "gut_check") finalPayload = GutCheckSchema.parse(parsed);
        else if (gameType === "extract_facts") finalPayload = ExtractFactsSchema.parse(parsed);
        else finalPayload = parsed; 
      } 
      else {
        // Fallback for 'mental_reflex'
        finalPayload = {
          theme_title: `Automatic Generation Run ${gameType} for Tomorrow`,
          scheduled_timestamp: Date.now(),
          distractor_shapes_count: adjustments.mental_reflex.distractor_count
        };
      }

      // Delete pre-existing scenarios mapping matching tomorrow's signature
      await supabase
        .from("daily_scenarios")
        .delete()
        .eq("play_date", tomorrowStr)
        .eq("game_type_id", gameType);

      // Commit the validated JSON payload straight to Supabase
      const { error: insertError } = await supabase
        .from("daily_scenarios")
        .insert({
          play_date: tomorrowStr,
          game_type_id: gameType,
          difficulty_band: 1.0,
          scenario_data: finalPayload,
        });

      if (insertError) throw insertError;
      executionTraces.push(`[Pipeline Phase 2]: Seeded dynamically adjusted daily scenario for [${gameType}]`);
    }

    return res.status(200).json({ status: "Success", processed_date: tomorrowStr, traces: executionTraces });
  } catch (contentSeedingException: any) {
    return res.status(500).json({
      error: "Critical exception caught during Content Generation & Seeding Phase",
      diagnostic_context: contentSeedingException.message,
    });
  }
}

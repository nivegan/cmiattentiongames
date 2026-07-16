import { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!supabaseUrl || !supabaseKey || !geminiApiKey) {
  throw new Error("[System Setup Error] Missing required environment variables (SUPABASE_URL, SUPABASE_KEY, or GOOGLE_GENERATIVE_AI_API_KEY).");
}

// Use non-null assertion (!) to guarantee type-safety
const supabase = createClient(supabaseUrl!, supabaseKey!);
const ai = new GoogleGenAI({ apiKey: geminiApiKey! });

// =========================================================================
// 1. LIGHTWEIGHT TYPES TO BYPASS "NEXT" MODULE DEPENDENCY ERRORS
// =========================================================================
interface CustomRequest extends IncomingMessage {
  query: Partial<{ [key: string]: string | string[] }>;
  cookies: { [key: string]: string };
  body: any;
  method?: string;
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
          (val: unknown) => {
            if (typeof val === "string") return parseInt(val, 10);
            if (typeof val === "number") return val;
            return NaN;
          },
          z.number().min(0).max(3),
        ),
      }),
    )
    .length(3),
  takeaway_criteria: z.array(z.string()).min(3).max(5),
});

const ReadBetweenDesignsSchema = z.object({
  theme_title: z.string(),
  copy_block: z.string(),
  mcq_questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).length(4),
        correct_answer_index: z.preprocess(
          (val: unknown) => {
            if (typeof val === "string") return parseInt(val, 10);
            if (typeof val === "number") return val;
            return NaN;
          },
          z.number().min(0).max(3),
        ),
        is_confirmation_bias_trap: z.boolean().optional(),
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
          (val: unknown) => {
            if (typeof val === "string") return val.toLowerCase() === "true";
            return Boolean(val);
          },
          z.boolean(),
        ),
        the_real_question: z.string(),
        the_real_number: z.preprocess(
          (val: unknown) => {
            if (typeof val === "string") return parseFloat(val);
            if (typeof val === "number") return val;
            return NaN;
          },
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

interface LogRow {
  game_type_id: string;
  status: "COMPLETED" | "ABANDONED" | "TIMED_OUT";
  final_score: number | null;
  difficulty: number | null;
  created_at: string;
}

interface DifficultyParams {
  max_word_count: number;
  speed_multiplier: number;
  variance_multiplier: number;
  distractor_count: number;
}

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

function generateClearTheAirParams(today: string, speedMultiplier: number): z.infer<typeof ClearTheAirSchema> {
  const seed = getDailySeed(today + "clear_the_air");
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
// 4. MAIN ENDPOINT HANDLER
// =========================================================================
export default async function handler(req: CustomRequest, res: CustomResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const now = new Date();
  const tomorrowDateObj = new Date(now);
  tomorrowDateObj.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrowDateObj.toISOString().split("T")[0];

  const daysOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayName = daysOfWeek[tomorrowDateObj.getDay()];

  const scheduleMap: Record<string, string[]> = {
    monday: ["EXTRACT_THE_FACTS", "MENTAL_REFLEX"],
    tuesday: ["GUT_CHECK", "STEADY_GAZE"],
    wednesday: ["READ_BETWEEN_DESIGNS", "CLEAR_THE_AIR"],
    thursday: ["EXTRACT_THE_FACTS", "STEADY_GAZE"],
    friday: ["GUT_CHECK", "MENTAL_REFLEX"],
    saturday: ["READ_BETWEEN_DESIGNS", "CLEAR_THE_AIR"],
    sunday: ["GUT_CHECK", "MENTAL_REFLEX"]
  };

  const activeGameTypes = scheduleMap[dayName] || ["EXTRACT_THE_FACTS", "MENTAL_REFLEX"];
  const executionTraces: string[] = [];

  const calculatedDifficulties: Record<string, number> = {
    EXTRACT_THE_FACTS: 1.0,
    READ_BETWEEN_DESIGNS: 1.0,
    STEADY_GAZE: 1.0,
    CLEAR_THE_AIR: 1.0,
    GUT_CHECK: 1.0,
    MENTAL_REFLEX: 1.0
  };

  try {
    const currentDayIndex = now.getDay(); 
    const daysSinceMonday = currentDayIndex === 0 ? 6 : currentDayIndex - 1;
    
    const startMonday = new Date(now);
    startMonday.setDate(now.getDate() - (daysSinceMonday + 7));
    startMonday.setHours(0, 0, 0, 0);

    const endSunday = new Date(startMonday);
    endSunday.setDate(startMonday.getDate() + 6);
    endSunday.setHours(23, 59, 59, 999);

    const weekStartISO = startMonday.toISOString();
    const weekEndISO = endSunday.toISOString();

    const { data: recentLogs, error: logError } = await supabase
      .from("game_logs")
      .select("game_type_id, status, final_score, difficulty, created_at")
      .gte("created_at", weekStartISO)
      .lte("created_at", weekEndISO);

    if (logError) throw logError;
    const parsedLogs = (recentLogs || []) as LogRow[];

    for (const gameId of Object.keys(calculatedDifficulties)) {
      const gameSubset = parsedLogs.filter(l => l.game_type_id === gameId);

      let currentDifficulty = 1.0;
      if (gameSubset.length > 0) {
        const sortedLogs = [...gameSubset].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        currentDifficulty = sortedLogs[0].difficulty ?? 1.0;
      }

      if (gameSubset.length >= 5) {
        const abandoned = gameSubset.filter(l => l.status === "ABANDONED").length;
        const completed = gameSubset.filter(l => l.status === "COMPLETED");
        const wins = completed.filter(l => (l.final_score ?? 0) >= 75).length;

        const abandonRate = abandoned / gameSubset.length;
        const winRate = completed.length > 0 ? wins / completed.length : 0;

        let adjustedDifficulty = currentDifficulty;

        if (gameId === "EXTRACT_THE_FACTS" || gameId === "READ_BETWEEN_DESIGNS") {
          if (abandonRate > 0.20 || winRate < 0.50) {
            adjustedDifficulty = currentDifficulty * 0.90;
          } else if (winRate > 0.85) {
            adjustedDifficulty = currentDifficulty * 1.10;
          }
        }
        else if (["STEADY_GAZE", "CLEAR_THE_AIR"].includes(gameId)) {
          if (winRate > 0.85) {
            adjustedDifficulty = currentDifficulty * 1.05;
          } else if (winRate < 0.50) {
            adjustedDifficulty = currentDifficulty * 0.95;
          }
        }
        else if (gameId === "GUT_CHECK") {
          if (winRate > 0.85) {
            adjustedDifficulty = currentDifficulty * 1.10;
          } else if (winRate < 0.40) {
            adjustedDifficulty = currentDifficulty * 0.90;
          }
        }
        else if (gameId === "MENTAL_REFLEX") {
          if (winRate < 0.30) {
            adjustedDifficulty = currentDifficulty * 0.90;
          } else if (winRate > 0.80) {
            adjustedDifficulty = currentDifficulty * 1.10;
          }
        }

        calculatedDifficulties[gameId] = parseFloat(Math.max(0.5, Math.min(2.0, adjustedDifficulty)).toFixed(2));
      } else {
        calculatedDifficulties[gameId] = currentDifficulty;
      }
    }
    executionTraces.push("[Pipeline Phase 1]: Telemetry compiled. Difficulty factors calibrated statefully.");

  } catch (telemetryException: unknown) {
    const errorMsg = telemetryException instanceof Error ? telemetryException.message : String(telemetryException);
    return res.status(500).json({
      error: "Critical exception caught during Telemetry Refinement Phase",
      context: errorMsg,
    });
  }

  // -----------------------------------------------------------------------
  // PIPELINE PHASE 2: GENERATION & SEED TRANSACTION ENGINE
  // -----------------------------------------------------------------------
  try {
    for (const gameType of activeGameTypes) {
      const targetDifficulty = calculatedDifficulties[gameType];
      let finalPayload: any = null;

      if (gameType === "STEADY_GAZE") {
        const raw = generateSteadyGazeParams(tomorrowStr, targetDifficulty);
        finalPayload = SteadyGazeSchema.parse(raw);
      } 
      else if (gameType === "CLEAR_THE_AIR") {
        const raw = generateClearTheAirParams(tomorrowStr, targetDifficulty);
        finalPayload = ClearTheAirSchema.parse(raw);
      } 
      else if (gameType === "EXTRACT_THE_FACTS" || gameType === "GUT_CHECK" || gameType === "READ_BETWEEN_DESIGNS") {
        let generationPrompt = "";

        if (gameType === "GUT_CHECK") {
          const customVariance = (20.0 * targetDifficulty).toFixed(1);
          generationPrompt = `
            You are a system prompt engine for the 'generate_gut_check' module.
            Return ONLY a raw JSON object for 'Gut Check'. Date: ${tomorrowStr}. Entropy: ${Math.random()}.
            Ensure your anchoring numerical statements use an expanded variance adjustment of ${customVariance} to optimize target challenge metrics.

            Expected JSON Structure:
            {
              "industry_theme": "<Theme>",
              "questions": [
                { 
                  "anchor_statement": "<Statement>", 
                  "is_anchor_true": true, 
                  "the_real_question": "<Question>", 
                  "the_real_number": 100, 
                  "unit": "units", 
                  "difficulty_level": "Adaptive" 
                }
              ]
            }
          `;
        } 
        else if (gameType === "EXTRACT_THE_FACTS") {
          const wordLimit = Math.max(80, Math.min(350, Math.floor(150 * targetDifficulty)));
          generationPrompt = `
            You are a system prompt engine for the 'generate_extract_facts' module.
            Return ONLY a raw JSON object for 'Extract the Facts'. Date: ${tomorrowStr}. Entropy: ${Math.random()}.
            
            CRITICAL CONSTRAINTS:
            - paragraph_a and paragraph_b combined MUST STRICTLY adhere to a maximum reading limit of ${wordLimit} words based on recent user performance bounds.
            - Provide a 'takeaway_criteria' field consisting of 3 to 5 clear, objective, and neutral facts from the paragraphs. This list serves as the reference ground-truth for grading the player's takeaway depth later.

            Expected JSON Structure:
            {
              "topic": "<Topic>",
              "paragraph_a": "<Text>",
              "paragraph_b": "<Text>",
              "mcq_questions": [
                { 
                  "question": "<Question>", 
                  "options": ["A","B","C","D"], 
                  "correct_answer_index": 0 
                }
              ],
              "takeaway_criteria": [
                "neutral fact criteria 1",
                "neutral fact criteria 2",
                "neutral fact criteria 3"
              ]
            }
          `;
        } 
        else {
          const wordLimit = Math.max(100, Math.min(350, Math.floor(200 * targetDifficulty)));
          generationPrompt = `
            You are a system prompt engine for the 'generate_dark_designs' module.
            Return ONLY a raw JSON object for 'Read Between the Designs'. Date: ${tomorrowStr}. Entropy: ${Math.random()}.
            
            CRITICAL CONSTRAINTS:
            - Ensure the copy block stays compact under an absolute cap of ${wordLimit} words.
            - Include a tailored confirmation bias option trap tracking parameter inside the options matrix.

            Expected JSON Structure:
            {
              "theme_title": "<Theme>",
              "copy_block": "<Text>",
              "mcq_questions": [
                { 
                  "question": "<Question>", 
                  "options": ["A","B","C","D"], 
                  "correct_answer_index": 0, 
                  "is_confirmation_bias_trap": true 
                }
              ]
            }
          `;
        }

        const aiResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: generationPrompt,
          config: {
            responseMimeType: "application/json",
            temperature: 1.0,
          },
        });

        const rawText = aiResponse.text?.trim();
        if (!rawText) throw new Error(`Empty execution profile tokens generated via LLM channel for module type target ${gameType}`);

        const parsed = JSON.parse(rawText);
        
        if (gameType === "GUT_CHECK") finalPayload = GutCheckSchema.parse(parsed);
        else if (gameType === "EXTRACT_THE_FACTS") finalPayload = ExtractFactsSchema.parse(parsed);
        else if (gameType === "READ_BETWEEN_DESIGNS") finalPayload = ReadBetweenDesignsSchema.parse(parsed);
        else finalPayload = parsed; 
      } 
      else {
        const calculatedDistractors = Math.max(2, Math.min(10, Math.floor(5 * targetDifficulty)));
        finalPayload = {
          theme_title: `Automatic Generation Run ${gameType} for Tomorrow`,
          scheduled_timestamp: Date.now(),
          distractor_shapes_count: calculatedDistractors
        };
      }

      await supabase
        .from("daily_scenarios")
        .delete()
        .eq("play_date", tomorrowStr)
        .eq("game_type_id", gameType);

      const { error: insertError } = await supabase
        .from("daily_scenarios")
        .insert({
          play_date: tomorrowStr,
          game_type_id: gameType,
          difficulty_band: targetDifficulty,
          scenario_data: finalPayload,
        });

      if (insertError) throw insertError;
      executionTraces.push(`[Pipeline Phase 2]: Seeded dynamically adjusted daily scenario for [${gameType}] at difficulty [${targetDifficulty}]`);
    }

    return res.status(200).json({ status: "Success", processed_date: tomorrowStr, traces: executionTraces });
  } catch (contentSeedingException: unknown) {
    const errorMsg = contentSeedingException instanceof Error ? contentSeedingException.message : String(contentSeedingException);
    return res.status(500).json({
      error: "Critical exception caught during Content Generation & Seeding Phase",
      diagnostic_context: errorMsg,
    });
  }
}

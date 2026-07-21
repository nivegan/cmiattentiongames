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

const supabase = createClient(supabaseUrl!, supabaseKey!);
const ai = new GoogleGenAI({ apiKey: geminiApiKey! });

// =========================================================================
// 1. LIGHTWEIGHT TYPES & PREPROCESSING SCHEMAS
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

const LimitedString = z.preprocess(
  (val) => (typeof val === "string" ? val.substring(0, 150) : val),
  z.string().max(150, "Content exceeds strict 150-character limit")
);

const ExplanationString = z.preprocess(
  (val) => (typeof val === "string" ? val.substring(0, 200) : val),
  z.string().max(200, "Explanation exceeds strict 200-character limit")
);

// =========================================================================
// 2. DATA VALIDATION SCHEMAS
// =========================================================================
const ExtractFactsSchema = z.object({
  topic: z.string(),
  paragraph_a: z.string(),
  paragraph_b: z.string(),
  mcq_questions: z.array(
    z.object({
      question: LimitedString,
      options: z.array(LimitedString).length(4),
      correct_answer_index: z.preprocess((val) => typeof val === "string" ? parseInt(val, 10) : Number(val), z.number().min(0).max(3)),
    })
  ).length(3),
  takeaway_criteria: z.array(z.string()).min(3).max(5),
});

const DarkDesignSchema = z.object({
  vector_mcq: z.object({
    question: LimitedString,
    options: z.object({
      text: LimitedString,
      ui: LimitedString,
      ad: LimitedString,
      graph: LimitedString
    }),
    correct_vector: z.enum(["text", "ui", "ad", "graph"]),
    correct_vector_index: z.preprocess((val) => typeof val === "string" ? parseInt(val, 10) : Number(val), z.number().min(0).max(3))
  }),
  manipulation_mcq: z.object({
    question: LimitedString,
    options: z.object({
      a: LimitedString,
      b: LimitedString,
      c: LimitedString,
      d: LimitedString
    }),
    correct_vector: z.enum(["a", "b", "c", "d"]),
    correct_vector_index: z.preprocess((val) => typeof val === "string" ? parseInt(val, 10) : Number(val), z.number().min(0).max(3))
  }),
  short_explanation: ExplanationString 
});

const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z.array(
    z.object({
      anchor_statement: LimitedString,
      is_anchor_true: z.preprocess((val) => typeof val === "string" ? val.toLowerCase() === "true" : Boolean(val), z.boolean()),
      the_real_question: LimitedString,
      the_real_number: z.preprocess((val) => typeof val === "string" ? parseFloat(val) : Number(val), z.number()),
      unit: z.string(),
      difficulty_level: z.string(),
    })
  ).length(3),
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

interface KalariGameRecord { mode: string; difficulty_band: number | null; }
interface UserStatRecord { game_type_id: string; difficulty_band?: number | null; is_success: boolean | null; score: number | null; completion_time: number | null; }

// =========================================================================
// 3. GENERATOR UTILITIES
// =========================================================================
function getDailySeed(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(Math.sin(hash)) % 1;
}

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generateSteadyGazeParams(today: string, difficultyBand: number): z.infer<typeof SteadyGazeSchema> {
  const seed = getDailySeed(today + "steady_gaze");
  return {
    theme_title: `Pure Awareness Run #${Math.floor(seed * 360)}`,
    speed: parseFloat((1.0 * (0.8 + (difficultyBand - 1) * 0.3)).toFixed(2)),
    screen_color: hslToHex(Math.floor(seed * 360), 60, 45),
    dot_color: hslToHex((Math.floor(seed * 360) + 180) % 360, 85, 65),
    shimmer_frequency: parseFloat((2.0 + seed * 4.0).toFixed(1)),
    spawn_pattern_seed: parseFloat(seed.toFixed(4)),
    base_shimmer_speed_multiplier: 1.25,
    miss_deceleration_factor: 0.8,
    max_expansion_cap_seconds: 4.5,
  };
}

function generateClearTheAirParams(today: string, difficultyBand: number): z.infer<typeof ClearTheAirSchema> {
  const seed = getDailySeed(today + "clear_the_air");
  return {
    theme_title: `Dissolving Distractions Pattern v${Math.floor(seed * 1000)}`,
    bubble_speed: parseFloat((1.2 * (0.8 + (difficultyBand - 1) * 0.3)).toFixed(2)),
    initial_distraction_ratio: parseFloat((0.3 + seed * 0.2).toFixed(2)),
    progression_intensity_multiplier: parseFloat((1.5 + seed * 1.5).toFixed(2)),
    max_bubble_density_cap: Math.floor(20 + difficultyBand * 5),
    bubble_acceleration_factor: 0.05,
    smudge_opacity_penalty: 0.65,
  };
}

function clampBand(band: number): number {
  return Math.max(1, Math.min(5, Math.round(band)));
}

// =========================================================================
// 4. MAIN ENDPOINT HANDLER
// =========================================================================
export default async function handler(req: CustomRequest, res: CustomResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const tomorrowDateObj = new Date();
  tomorrowDateObj.setDate(tomorrowDateObj.getDate() + 1);
  const tomorrowStr = tomorrowDateObj.toISOString().split("T")[0];
  const dayName = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][tomorrowDateObj.getDay()];

  const scheduleMap: Record<string, string[]> = {
    monday: ["EXTRACT_THE_FACTS", "MENTAL_REFLEX"],
    tuesday: ["GUT_CHECK", "STEADY_GAZE"],
    wednesday: ["DARK_DESIGN", "CLEAR_THE_AIR"],
    thursday: ["EXTRACT_THE_FACTS", "STEADY_GAZE"],
    friday: ["GUT_CHECK", "MENTAL_REFLEX"],
    saturday: ["DARK_DESIGN", "CLEAR_THE_AIR"],
    sunday: ["GUT_CHECK", "MENTAL_REFLEX"]
  };

  const activeGameTypes = scheduleMap[dayName] || ["EXTRACT_THE_FACTS", "MENTAL_REFLEX"];
  const executionTraces: string[] = [];
  const targetDifficultyBands: Record<string, number> = { STEADY_GAZE: 3, CLEAR_THE_AIR: 3, EXTRACT_THE_FACTS: 3, GUT_CHECK: 3, DARK_DESIGN: 3, MENTAL_REFLEX: 3 };

  // -----------------------------------------------------------------------
  // STEP 1 & 2: TELEMETRY REFINEMENT LOOP
  // -----------------------------------------------------------------------
  try {
    const { data: kalariData } = await supabase.from("kalari_games").select("mode, difficulty_band");
    if (kalariData) kalariData.forEach(row => { if (targetDifficultyBands[row.mode.toUpperCase()] && row.difficulty_band) targetDifficultyBands[row.mode.toUpperCase()] = clampBand(row.difficulty_band); });

    const { data: userStats } = await supabase.from("user_stats").select("game_type_id, difficulty_band, is_success, score, completion_time");
    const parsedStats = (userStats || []) as UserStatRecord[];

    for (const gameId of Object.keys(targetDifficultyBands)) {
      const gameEntries = parsedStats.filter(s => s.game_type_id === gameId);
      let currentBand = targetDifficultyBands[gameId];
      if (gameEntries.length > 0 && gameEntries[0].difficulty_band) currentBand = clampBand(gameEntries[0].difficulty_band);

      if (gameEntries.length >= 5) {
        const winRate = gameEntries.filter(e => e.is_success === true).length / gameEntries.length;
        const abandonRate = gameEntries.filter(e => e.is_success === false).length / gameEntries.length;
        const scores = gameEntries.map(e => e.score).filter((s): s is number => s !== null);
        const isLowScore = (scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 70) < 50;
        let newBand = currentBand;

        if (gameId === "EXTRACT_THE_FACTS" || gameId === "DARK_DESIGN") {
          if (abandonRate > 0.20 || winRate < 0.50 || isLowScore) newBand -= 1; // Drives 10% Char limit reduction downstream
          else if (winRate > 0.80) newBand += 1;                                // Drives 10% Char limit increase downstream
        } else if (gameId === "STEADY_GAZE" || gameId === "CLEAR_THE_AIR" || gameId === "GUT_CHECK") {
          if (winRate > 0.85) newBand += 1;
          else if (winRate < 0.15 || isLowScore) newBand -= 1;
        } else if (gameId === "MENTAL_REFLEX") {
          if (winRate < 0.30 || isLowScore) newBand -= 1;
          else if (winRate > 0.70) newBand += 1;
        }
        targetDifficultyBands[gameId] = clampBand(newBand);
      } else targetDifficultyBands[gameId] = currentBand;
    }
  } catch (err: any) { return res.status(500).json({ error: "Telemetry Refinement Exception", context: err.message }); }

  // -----------------------------------------------------------------------
  // STEP 3: CONTENT GENERATION & SEEDING (MAINTAINING EXACT PROMPTS)
  // -----------------------------------------------------------------------
  try {
    for (const gameType of activeGameTypes) {
      const band = targetDifficultyBands[gameType];
      let finalPayload: any = null;

      if (gameType === "STEADY_GAZE") finalPayload = SteadyGazeSchema.parse(generateSteadyGazeParams(tomorrowStr, band));
      else if (gameType === "CLEAR_THE_AIR") finalPayload = ClearTheAirSchema.parse(generateClearTheAirParams(tomorrowStr, band));
      else if (["EXTRACT_THE_FACTS", "GUT_CHECK", "DARK_DESIGN"].includes(gameType)) {
        let generationPrompt = "";
        let recentTopics: string[] = [];
        try {
          const { data: history } = await supabase.from("daily_scenarios").select("scenario_data").order("play_date", { ascending: false }).limit(10);
          if (history) recentTopics = history.map(h => h.scenario_data?.topic || h.scenario_data?.industry_theme).filter(Boolean);
        } catch (e) {}

        if (gameType === "GUT_CHECK") {
          const targetVariance = (10.0 + band * 5.0).toFixed(1);
          generationPrompt = `Return ONLY a raw JSON object for 'Gut Check'.
Date: ${tomorrowStr}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.
Target Difficulty Tier: ${band} out of 5 (1 = Obvious and straightforward trivia benchmarks; 5 = Obscure, highly counter-intuitive metrics requiring precise approximation skills).

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
[${recentTopics.map(t => `'${t}'`).join(', ')}]

CRITICAL LENGTH CONSTRAINTS:
1. Every 'anchor_statement' MUST be under a strict maximum length of 150 characters.
2. Every 'the_real_question' MUST be under a strict maximum length of 150 characters.

MANDATORY QUESTION STYLE & ANCHOR VARIANCE RULE:
Every single question segment must consist of two steps:
1. An 'anchor_statement': Phrased as a clear binary "Yes/No" baseline check containing an everyday numeric benchmark (e.g., "Does a standard marathon cover more than 30 miles?").
   - NUMERICAL VARIANCE ADJUSTMENT: When 'is_anchor_true' is false, the incorrect baseline number placed inside the 'anchor_statement' string MUST mathematically deviate away from the actual true value ('the_real_number') by approximately ${targetVariance}%. Use this factor to control how far away the anchor trick is from reality.
2. A 'the_real_question': A direct numerical question fallback styled to ask the user for the actual count or value if they guess incorrectly or encounter a false anchor (e.g., "What is the official length of a standard marathon in miles?").

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
        } 
        else if (gameType === "EXTRACT_THE_FACTS") {
          // EXPLICIT 10% CHARACTER LIMIT SCALING BASED ON DIFFICULTY BAND
          // Base Band 3 = 280 chars. Band 2 (Abandon > 20%) = 252 chars. Band 4 (Win > 80%) = 308 chars.
          const targetCharLimit = Math.floor(280 * (1 + (band - 3) * 0.1));

          generationPrompt = `Return ONLY a raw JSON object for 'Extract the Facts'.
Date: ${tomorrowStr}.
Entropy Factor: ${Math.random().toString(36).substring(7)}.
Target Difficulty Tier: ${band} out of 5 (1 = Simple and literal phrasing, 5 = Highly complex, academic phrasing with subtle, interwoven logic traps).

ANTI-REPETITION FILTER:
You must select a radically different topic than these recent entries: [${recentTopics.map(t => `'${t}'`).join(', ')}].
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
        } 
        else if (gameType === "DARK_DESIGN") {
          generationPrompt = `Return ONLY a raw JSON object for 'Dark Design'.
Date: ${tomorrowStr}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.
Target Difficulty Tier: ${band} out of 5 (1 = Simple and obvious design patterns; 5 = Highly subtle, legalistic gray-area traps with deceptive micro-copy).

ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map(t => `'${t}'`).join(', ')}]

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

        const aiResponse = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: generationPrompt, config: { responseMimeType: "application/json", temperature: 1.0 } });
        const parsed = JSON.parse(aiResponse.text?.trim() || "{}");
        
        if (gameType === "GUT_CHECK") finalPayload = GutCheckSchema.parse(parsed);
        else if (gameType === "EXTRACT_THE_FACTS") finalPayload = ExtractFactsSchema.parse(parsed);
        else if (gameType === "DARK_DESIGN") finalPayload = DarkDesignSchema.parse(parsed);
      } 
      else {
        finalPayload = { theme_title: `Automatic Generation Run ${gameType} for Tomorrow`, scheduled_timestamp: Date.now(), distractor_shapes_count: Math.max(2, Math.min(10, 2 + band * 2)) };
      }

      await supabase.from("daily_scenarios").delete().eq("play_date", tomorrowStr).eq("game_type_id", gameType);
      await supabase.from("daily_scenarios").insert({ play_date: tomorrowStr, game_type_id: gameType, difficulty_band: band, scenario_data: finalPayload });
      executionTraces.push(`[Success]: Seeded [${gameType}] (Band ${band}) for [${tomorrowStr}]`);
    }
    return res.status(200).json({ status: "Success", processed_date: tomorrowStr, traces: executionTraces });
  } catch (err: any) { return res.status(500).json({ error: "Content Seeding Exception", context: err.message }); }
}

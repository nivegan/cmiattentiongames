import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY, CRON_SECRET } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// =========================================================================
// 1. ORIGINAL SCHEMAS REUSED FOR THE CRON DATA VALIDATION BOUNDARY
// =========================================================================
const ExtractFactsSchema = z.object({
  topic: z.string(),
  paragraph_a: z.string(),
  paragraph_b: z.string(),
  mcq_questions: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()).length(4),
    correct_answer_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3)),
  })).length(3),
});

const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z.array(z.object({
    anchor_statement: z.string(),
    is_anchor_true: z.preprocess((val) => typeof val === 'string' ? val.toLowerCase() === 'true' : Boolean(val), z.boolean()),
    the_real_question: z.string(),
    the_real_number: z.preprocess((val) => parseFloat(val), z.number()),
    unit: z.string(),
    difficulty_level: z.string(),
  })).length(3),
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
  max_expansion_cap_seconds: z.number()
});

const ClearAirSchema = z.object({
  theme_title: z.string(),
  bubble_speed: z.number(),
  initial_distraction_ratio: z.number(),
  progression_intensity_multiplier: z.number(),
  max_bubble_density_cap: z.number(),
  bubble_acceleration_factor: z.number(),
  smudge_opacity_penalty: z.number()
});

// =========================================================================
// 2. REFLEXIVE MATHEMATICAL UTILITIES FROM THE CORE GENERATOR
// =========================================================================
function getDailySeed(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(Math.sin(hash)) % 1;
}

function hslToHex(h, s, l) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generateSteadyGazeParams(today) {
  const seed = getDailySeed(today + "steady_gaze");
  const baseHue = Math.floor(seed * 360);
  const oppositeHue = (baseHue + 180) % 360;
  return {
    theme_title: `Pure Awareness Run #${baseHue}`,
    speed: parseFloat((0.8 + seed * 1.5).toFixed(2)),
    screen_color: hslToHex(baseHue, 60, 45),
    dot_color: hslToHex(oppositeHue, 85, 65),
    shimmer_frequency: parseFloat((2.0 + seed * 4.0).toFixed(1)),
    spawn_pattern_seed: parseFloat(seed.toFixed(4)),
    base_shimmer_speed_multiplier: 1.25,
    miss_deceleration_factor: 0.80,
    max_expansion_cap_seconds: 4.5
  };
}

function generateClearAirParams(today) {
  const seed = getDailySeed(today + "clear_air");
  const variantId = Math.floor(seed * 1000);
  return {
    theme_title: `Dissolving Distractions Pattern v${variantId}`,
    bubble_speed: parseFloat((1.2 + seed * 2.3).toFixed(2)),
    initial_distraction_ratio: parseFloat((0.3 + seed * 0.2).toFixed(2)),
    progression_intensity_multiplier: parseFloat((1.5 + seed * 1.5).toFixed(2)),
    max_bubble_density_cap: Math.floor(25 + seed * 15),
    bubble_acceleration_factor: 0.05,
    smudge_opacity_penalty: 0.65
  };
}

// =========================================================================
// 3. MASTER CHRONOLOGICAL EXECUTION HOOK
// =========================================================================
export default async function handler(req, res) {
  // COMMENT: Verification gateway blocking illegal external HTTP requests outside Vercel's Engine infrastructure
  const authHeader = req.headers.get('authorization');
  if (req.method !== 'POST' && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized endpoint invocation context" });
  }

  // COMMENT: Pinpoint exact string generation targets for 'Tomorrow' relative to the system running context
  const now = new Date();
  const tomorrowDateObj = new Date(now);
  tomorrowDateObj.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrowDateObj.toISOString().split('T')[0];
  
  // COMMENT: Determine scheduling matrices using day-of-week parsing strategies
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = daysOfWeek[tomorrowDateObj.getDay()];

  // COMMENT: Core scheduling lookups defined explicitly from your active beta matrix mapping rules
  const scheduleMap = {
    'Monday': ['extract_facts', 'mental_reflex'],
    'Tuesday': ['gut_check', 'steady_gaze'],
    'Wednesday': ['read_between_designs', 'clear_air'],
    'Thursday': ['extract_facts', 'steady_gaze'],
    'Friday': ['gut_check', 'mental_reflex'],
    'Saturday': ['read_between_designs', 'clear_air', 'gut_check'], // Serves array of 3 games on weekends
    'Sunday': ['gut_check', 'mental_reflex', 'extract_facts']       // Serves array of 3 games on weekends
  };

  const activeGameTypes = scheduleMap[dayName] || ['extract_facts', 'mental_reflex'];
  const logs = [];

  try {
    for (const gameType of activeGameTypes) {
      let finalPayload = null;

      // COMMENT: Algorithmic routing maps logic checks to structural generation tracks
      if (gameType === 'steady_gaze') {
        const raw = generateSteadyGazeParams(tomorrowStr);
        finalPayload = SteadyGazeSchema.parse(raw);

      } else if (gameType === 'clear_air') {
        const raw = generateClearAirParams(tomorrowStr);
        finalPayload = ClearAirSchema.parse(raw);

      } else if (gameType === 'extract_facts' || gameType === 'gut_check') {
        // COMMENT: Build the LLM routing instructions passing dynamic contextual parameters
        let prompt = "";
        if (gameType === 'gut_check') {
          prompt = `Return ONLY a raw JSON object for 'Gut Check'. Date: ${tomorrowStr}. Entropy: ${Math.random()}.\nExpected JSON Structure:\n{\n  "industry_theme": "<Theme>",\n  "questions": [\n    { "anchor_statement": "<Statement>", "is_anchor_true": true, "the_real_question": "<Question>", "the_real_number": 100, "unit": "units", "difficulty_level": "Easy" }\n  ]\n}`;
        } else {
          prompt = `Return ONLY a raw JSON object for 'Extract the Facts'. Date: ${tomorrowStr}. Entropy: ${Math.random()}.\nExpected JSON Structure:\n{\n  "topic": "<Topic>",\n  "paragraph_a": "<Text>",\n  "paragraph_b": "<Text>",\n  "mcq_questions": [\n    { "question": "<Question>", "options": ["A","B","C","D"], "correct_answer_index": 0 }\n  ]\n}`;
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GOOGLE_GENERATIVE_AI_API_KEY}`;
        const aiResponse = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 1.0 },
          }),
        });

        const aiData = await aiResponse.json();
        let rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) throw new Error(`Empty execution profile generated via LLM channel for ${gameType}`);

        // COMMENT: Defensive structural cleanup parsing layer explicitly handling markdown blocks
        rawText = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(rawText);
        finalPayload = gameType === 'gut_check' ? GutCheckSchema.parse(parsed) : ExtractFactsSchema.parse(parsed);
      } else {
        // COMMENT: Default fallback schema generator stub for 'mental_reflex' or 'read_between_designs' configurations
        finalPayload = { theme_title: `Automatic Generation Run ${gameType}`, scheduled_timestamp: Date.now() };
      }

      // COMMENT: Clear legacy rows matching tomorrow's timeline signature before committing transactions
      await supabase
        .from("daily_scenarios")
        .delete()
        .eq("play_date", tomorrowStr)
        .eq("game_type_id", gameType);

      // COMMENT: Commit the validated JSON data shapes directly to the target Supabase transaction layout rows
      const { error: insertError } = await supabase
        .from("daily_scenarios")
        .insert({
          play_date: tomorrowStr,
          game_type_id: gameType,
          difficulty_band: 1.0,
          scenario_data: finalPayload
        });

      if (insertError) throw insertError;
      logs.push(`Successfully committed execution configuration rows for game logic type: [${gameType}]`);
    }

    return res.status(200).json({ status: "Success", processed_date: tomorrowStr, traces: logs });
  } catch (globalError) {
    return res.status(500).json({ error: "Transaction workflow execution fault", context: globalError.message });
  }
}
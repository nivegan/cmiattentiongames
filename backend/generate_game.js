import fs from 'fs';
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 1. UNIFIED VALIDATION SCHEMAS
// ==========================================
const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z
    .array(
      z.object({
        anchor_statement: z.string(),
        is_anchor_true: z.preprocess((val) => {
          if (typeof val === 'string') return val.toLowerCase() === 'true';
          return Boolean(val);
        }, z.boolean()),
        the_real_question: z.string(),
        the_real_number: z.preprocess((val) => parseFloat(val), z.number()),
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
          (val) => parseInt(val, 10),
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

const DarkDesignSchema = z.object({
  scenario_description: z.string(),
  vector_mcq: z.object({
    options: z.array(z.string()).length(4),
    correct_vector_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3)),
  }),
  manipulation_mcq: z.object({
    options: z.array(z.string()).length(4),
    correct_manipulation_name: z.string(),
    correct_manipulation_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3)),
  }),
  explanation: z.string(),
});

// ==========================================
// 2. MATH CORE & ALGORITHMIC HELPER FUNCTIONS
// ==========================================
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

// ==========================================
// 3. MAIN RUNTIME EXECUTION EXPORT
// ==========================================
export async function generate(customMode = null, forceRefresh = false) {
  const argv = yargs(hideBin(process.argv)).argv;
  
  let resolvedMode = customMode;
  if (!resolvedMode && argv.mode && typeof argv.mode === "string") resolvedMode = argv.mode;
  if (!resolvedMode && argv._ && argv._[0]) resolvedMode = argv._[0];
  
  const mode = resolvedMode || "extract_facts";

  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now - offset).toISOString().split('T')[0];

  try {
    // NATURAL 24-HOUR DAILY LOCK CHECK
    if (!forceRefresh) {
      const { data: existing } = await supabase
        .from("kalari_games")
        .select("content")
        .eq("mode", mode)
        .eq("scheduled_for", today)
        .maybeSingle();

      if (existing && existing.content) {
        const hasFacts = mode === "extract_facts" && existing.content.mcq_questions;
        const hasGaze = mode === "steady_gaze" && existing.content.screen_color;
        const hasAir = mode === "clear_air" && existing.content.progression_intensity_multiplier;
        const hasDark = mode === "dark_design" && existing.content.scenario_description;
        
        const isStuckMushroom = existing.content?.industry_theme?.toLowerCase().includes("mycology");
        const hasGut = mode === "gut_check" && existing.content?.questions?.[0]?.the_real_question && !isStuckMushroom;

        if (hasGaze || hasAir || hasFacts || hasGut || hasDark) {
          const finalOutput = JSON.stringify(existing.content, null, 2);
          fs.writeFileSync(`${mode}.json`, finalOutput);
          process.stdout.write(finalOutput);
          return existing.content;
        }
      }
    }

    let validated;

    if (mode === "steady_gaze") {
      const rawParams = generateSteadyGazeParams(today);
      validated = SteadyGazeSchema.parse(rawParams);

    } else if (mode === "clear_air") {
      const rawParams = generateClearAirParams(today);
      validated = ClearAirSchema.parse(rawParams);

    } else {
      // MEMORY LOOP LAYER: FETCH PAST 10 TOPICS FROM GAME LOGS
      let recentTopics = [];
      try {
        const { data: logs } = await supabase
          .from("Game_Logs")
          .select("topic")
          .order("created_at", { ascending: false })
          .limit(10);
        
        if (logs && logs.length > 0) {
          recentTopics = logs.map(l => l.topic).filter(Boolean);
        }
      } catch (logErr) {
        console.warn("⚠️ Memory Loop history fetch bypassed:", logErr.message);
      }

      let prompt = "";
      if (mode === "gut_check") {
        prompt = `Return ONLY a raw JSON object for 'Gut Check'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

THEME VARIETY INSTRUCTIONS:
Select a fun, high-level, broad general knowledge domain that appeals to a mainstream audience. The theme must be widely recognizable and culturally accessible.
Mandatory broad categories to pick from (rotate or select one dynamically):
- Global Landmarks & Travel Geography (e.g., world capitals, flight distances, mountain ranges, famous rivers)
- Pop Culture, Entertainment & Media History (e.g., box office records, long-running TV series, music chart durations)
- Everyday Culinary Arts & Food Culture (e.g., standard baking temperatures, regional crop production scales, restaurant milestones)
- Consumer Tech & Modern Internet History (e.g., launch years of popular apps, standard battery life capacities, pixel counts)
- Major Sports & Athletic Milestones (e.g., marathon lengths, Olympic records, historic stadium seating capacities)
- Everyday Urban Economics & Lifestyle (e.g., average commute times, common household sizes, historical currency shifts)

CRITICAL BAN LIST (NEVER GENERATE THESE):
Do NOT focus on hyper-niche academic disciplines, marine biology, deep-sea exploration, oceanography, astrophysics, space metrics, 'Mycology', 'Mushroom networks', 'Burj Khalifa', architectural building heights, or specialized scientific lab values.

ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map(t => `'${t}'`).join(', ')}]

MANDATORY QUESTION STYLE:
Every single question segment must consist of two steps:
1. An 'anchor_statement': Phrased as a clear binary "Yes/No" baseline check containing an everyday numeric benchmark (e.g., "Does a standard marathon cover more than 30 miles?").
2. A 'the_real_question': A direct numerical question fallback styled to ask the user for the actual count or value if they guess incorrectly or encounter a false anchor (e.g., "What is the official length of a standard marathon in miles?").

Field Mapping Specifications:
1. 'industry_theme': A friendly, accessible theme title representing the specific general knowledge sector chosen.
2. 'anchor_statement': The literal "Yes/No" baseline statement text.
3. 'is_anchor_true': Boolean (true/false) indicating whether the initial 'anchor_statement' benchmark is factually accurate. Maintain a mix of true and false flags across the 3 questions.
4. 'the_real_question': The follow-up question string specifically asking for the exact parameter/measurement.
5. 'the_real_number': The absolute, precise, factually accurate raw numerical answer to 'the_real_question'.
6. Do not wrap the JSON output in markdown backticks or code blocks.

Expected JSON Structure:
{
  "industry_theme": "<A Broad, Accessible, and General Interest Theme>",
  "questions": [
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", "is_anchor_true": false, "the_real_question": "<Follow-up question requesting the actual target metric>", "the_real_number": 26.2, "unit": "miles", "difficulty_level": "Easy" },
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", "is_anchor_true": true, "the_real_question": "<Follow-up question requesting the actual target metric>", "the_real_number": 1997, "unit": "year", "difficulty_level": "Medium" },
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", "is_anchor_true": false, "the_real_question": "<Follow-up question requesting the actual target metric>", "the_real_number": 120, "unit": "minutes", "difficulty_level": "Hard" }
  ]
}`;
      } else if (mode === "dark_design") {
        prompt = `Return ONLY a raw JSON object for 'Dark Design'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

INSTRUCTIONS:
Generate a single daily deceptive digital design challenge based on a real-world scenario. 
The scenario must present a single specific instance of digital manipulation occurring within exactly ONE of the following four communication mediums: 'text', 'ui', 'ad', or 'graph'.

Provide two distinct multiple-choice evaluations based on this single scenario:
1. A vector check where the options are always exactly ["text", "ui", "ad", "graph"]. Identify which index holds the target vector displaying the dark design trick.
2. A classification check providing exactly 4 distinct design manipulation techniques (e.g., "Confirmshaming", "Roach Motel", "Bait and Switch", "Hidden Costs"). Identify which technique is active.

Do not wrap the JSON output in markdown backticks or code blocks.

Expected JSON Structure:
{
  "scenario_description": "<A clear description of today's deceptive interface scenario>",
  "vector_mcq": {
    "options": ["text", "ui", "ad", "graph"],
    "correct_vector_index": 0
  },
  "manipulation_mcq": {
    "options": ["Confirmshaming", "Roach Motel", "Bait and Switch", "Hidden Costs"],
    "correct_manipulation_name": "Confirmshaming",
    "correct_manipulation_index": 0
  },
  "explanation": "<Context breakdown details explaining the manipulation mechanism>"
}`;
      } else {
        prompt = `Return ONLY a raw JSON object for 'Extract the Facts'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

ANTI-REPETITION FILTER (MEMORY LOOP):
Select a completely fresh topic. Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map(t => `'${t}'`).join(', ')}]

THEME AND VOICE INSTRUCTIONS:
1. Topic Choice: Select a creative, specific, completely non-political and non-controversial real-world scene, trend, or human interest event. 
2. ABSOLUTE FILTER: Do NOT include any political parties, politician names, government election disputes, polarizing social debates, or sensitive geopolitical events by name.
3. Style, Tone & Sentiment Variance: Write paragraphs formatted to simulate a concise local news blurb, a high-engagement social media post, or a fast tabloid snippet.
4. THE CORE DIFFERENCE: The differences between the two paragraphs do NOT need to be numbers. Instead, focus heavily on structural sentiment swaps and perspective spins.
5. Strict Length Constraint: Both 'paragraph_a' and 'paragraph_b' must be kept crisp and short, fitting within a standard 280-character Twitter length limit.
6. Formatting Rule: Do NOT include any quotation marks (" or ') anywhere inside the paragraphs. 
7. Do not accidentally take a direct quote from any tabloid, news source, or social media post.
8. Use real work things but change names example: "company xyz hopes their new AI will make thinks easier" vs "workers are concerned about xyz's new AI policy"

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
            temperature: 1.0 
          },
        }),
      });

      const data = await response.json();
      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("API returned empty candidates.");

      const parsed = JSON.parse(rawText);
      
      if (mode === "gut_check") {
        validated = GutCheckSchema.parse(parsed);
      } else if (mode === "dark_design") {
        validated = DarkDesignSchema.parse(parsed);
      } else {
        validated = ExtractFactsSchema.parse(parsed);
      }
    }

    // ==========================================
    // 4. TRANSACTION OVERWRITE SNAPSHOT LAYER
    // ==========================================
    await supabase
      .from("kalari_games")
      .delete()
      .eq("mode", mode)
      .eq("scheduled_for", today);

    let dbTopic = mode;
    if (mode === "gut_check") dbTopic = validated.industry_theme;
    if (mode === "extract_facts") dbTopic = validated.topic;
    if (mode === "dark_design") dbTopic = "Daily Dark Design Challenge";
    if (mode === "steady_gaze" || mode === "clear_air") dbTopic = validated.theme_title;

    await supabase.from("kalari_games").insert({
      mode,
      topic: dbTopic, 
      content: validated,
      scheduled_for: today,
    });

    const finalOutput = JSON.stringify(validated, null, 2);
    fs.writeFileSync(`${mode}.json`, finalOutput);
    process.stdout.write(finalOutput);

    return validated;
  } catch (err) {
    console.error("🛑 SCRIPT ERROR:", err.message);
    if (err instanceof z.ZodError) {
      console.error("Validation Details:", JSON.stringify(err.errors, null, 2));
    }
    throw err;
  }
}

// ==========================================
// 5. TERMINAL EXECUTION HOOK
// ==========================================
if (process.argv[1] && (process.argv[1].endsWith("generate_game.js") || process.argv[1].endsWith("generate_game.ts"))) {
  const argv = yargs(hideBin(process.argv)).argv;
  const force = argv.forceRefresh === true || argv.forceRefresh === 'true';
  
  const targetMode = argv.mode || argv._[0] || null;

  generate(targetMode, force); 
}

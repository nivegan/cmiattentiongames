import fs from 'fs';
import path from 'path';
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("Missing required environment variables in .env.local");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const RESOLVED_OUTPUT_PATH = path.join(process.cwd(), 'gut_check.json');

const LimitedString = z.string().max(150, "Content exceeds the strict 150-character limit");

// ==========================================
// 1. DYNAMIC VALIDATION SCHEMA
// ==========================================
const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z.array(z.object({
    anchor_statement: LimitedString,
    is_anchor_true: z.preprocess((val) => typeof val === 'string' ? val.toLowerCase() === 'true' : Boolean(val), z.boolean()),
    the_real_question: LimitedString,
    the_real_number: z.preprocess((val) => parseFloat(val), z.number()),
    unit: z.string(),
    difficulty_level: z.string(),
  })).length(3)
});

// ==========================================
// 2. EXCLUSIVE GUT CHECK RUNTIME
// ==========================================
export async function generate(customMode = null, forceRefresh = false) {
  const mode = "gut_check";

  const argv = yargs(hideBin(process.argv)).argv;
  const shouldForce = forceRefresh || argv.forceRefresh === true || argv.forceRefresh === 'true' || argv.force === true;

  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now.getTime() - offset).toISOString().split('T')[0];
  
  // FIX: Create 24-hour boundary ranges to handle Timestamp / Timezone variations safely
  const todayStart = `${today}T00:00:00.000Z`;
  const todayEnd = `${today}T23:59:59.999Z`;

  // STRICT ORDER FILTER FOR SERIALIZATION ENGINE
  const strictJsonReplacerOrder = [
    "industry_theme", "questions", "anchor_statement", "is_anchor_true", 
    "the_real_question", "the_real_number", "unit", "difficulty_level"
  ];

  try {
    // NATURAL 24-HOUR DAILY LOCK CHECK
    if (!shouldForce) {
      const { data: existing } = await supabase
        .from("kalari_games")
        .select("content")
        .eq("mode", mode)
        .gte("scheduled_for", todayStart)
        .lte("scheduled_for", todayEnd)
        .maybeSingle();

      if (existing && existing.content && existing.content.industry_theme) {
        process.stderr.write(`[CACHE HIT] Found active game in Supabase for ${today}. Bypassing API.\n`);
        const finalOutput = JSON.stringify(existing.content, strictJsonReplacerOrder, 2);
        fs.writeFileSync(RESOLVED_OUTPUT_PATH, finalOutput);
        process.stdout.write(finalOutput);
        return existing.content;
      }
    }

    process.stderr.write(`[API INIT] Cache empty or forced. Reaching out to Gemini API for ${today}...\n`);

    // MEMORY LOOP LAYER: FETCH PAST 10 TOPICS DIRECTLY FROM KALARI_GAMES
    let recentTopics = [];
    try {
      const { data: history } = await supabase
        .from("kalari_games")
        .select("topic")
        .order("scheduled_for", { ascending: false })
        .limit(10);
      
      if (history && history.length > 0) {
        recentTopics = history
          .map(h => h.topic)
          .filter(t => Boolean(t));
      }
    } catch (histErr) {
      // Fallback
    }

    const prompt = `Return ONLY a raw JSON object for 'Gut Check'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

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
Also, absolutely avoid 'Pop Culture', 'Entertainment' or 'Media History' for this run.

ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map(t => `'${t}'`).join(', ')}]

CRITICAL LENGTH CONSTRAINTS:
1. Every 'anchor_statement' MUST be under a strict maximum length of 150 characters.
2. Every 'the_real_question' MUST be under a strict maximum length of 150 characters.

MANDATORY QUESTION STYLE:
Every single question segment must consist of two steps:
1. An 'anchor_statement': Phrased as a clear binary "Yes/No" baseline check containing an everyday numeric benchmark (e.g., "Does a standard marathon cover more than 30 miles?").
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
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("API returned empty candidates.");

    const parsed = JSON.parse(rawText);
    const validated = GutCheckSchema.parse(parsed);

    // ==========================================
    // 3. TRANSACTION OVERWRITE SNAPSHOT LAYER
    // ==========================================
    // FIX: Clear out entries inside the 24-hour range to prevent exact-match mismatch drops
    await supabase
      .from("kalari_games")
      .delete()
      .eq("mode", mode)
      .gte("scheduled_for", todayStart)
      .lte("scheduled_for", todayEnd);

    // Forces exact key serialization layout alignment prior to database entry
    const orderedPayload = JSON.parse(JSON.stringify(validated, strictJsonReplacerOrder));

    await supabase.from("kalari_games").insert({
      mode,
      topic: validated.industry_theme, 
      content: orderedPayload,
      scheduled_for: today,
    });

    const finalOutput = JSON.stringify(validated, strictJsonReplacerOrder, 2);
    fs.writeFileSync(RESOLVED_OUTPUT_PATH, finalOutput);
    process.stdout.write(finalOutput);

    return validated;
  } catch (err) {
    if (err instanceof z.ZodError) {
      process.stderr.write(JSON.stringify(err.errors, null, 2));
    } else if (err instanceof Error) {
      process.stderr.write(err.message + "\n");
    } else {
      process.stderr.write(String(err) + "\n");
    }
    throw err;
  }
}

// ==========================================
// 4. TERMINAL EXECUTION HOOK
// ==========================================
const currentScript = process.argv[1];
if (currentScript) {
  const baseName = path.basename(currentScript);
  const matchesName = 
    baseName === "generate_gut_check.js" || 
    baseName === "generate_gut_check.ts" ||
    baseName === "generate_gut_checks.js" || 
    baseName === "generate_gut_checks.ts";

  if (matchesName) {
    const argv = yargs(hideBin(process.argv)).argv;
    const force = argv.forceRefresh === true || argv.forceRefresh === 'true' || argv.force === true;
    const targetMode = argv.mode || (argv._ && argv._[0] ? argv._[0] : null);

    generate(targetMode, force); 
  }
}

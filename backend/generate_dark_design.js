import fs from 'fs';
import path from 'path';
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Absolute fallback file writer path
const EXPLICIT_OUTPUT_PATH = '/Users/urjaswichakraborty/cmiattentiongames/dark_design.json';

// Reusable schema helper to enforce the strict 150-character limit
const LimitedString = z.string().max(150, "Content exceeds the strict 150-character limit");

// ==========================================
// 1. DYNAMIC VALIDATION SCHEMA
// ==========================================
const DarkDesignSchema = z.object({
  vector_mcq: z.object({
    question: LimitedString,
    options: z.object({
      text: LimitedString,   // Strictly limited to 150 characters
      ui: LimitedString,     // Strictly limited to 150 characters
      ad: LimitedString,     // Strictly limited to 150 characters
      graph: LimitedString   // Strictly limited to 150 characters
    }),
    correct_vector: z.enum(["text", "ui", "ad", "graph"]),
    correct_vector_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3))
  }),
  manipulation_mcq: z.object({
    question: LimitedString,
    options: z.array(LimitedString).length(4),
    correct_manipulation_name: LimitedString,
    correct_manipulation_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3))
  }),
  short_explanation: LimitedString
});

// ==========================================
// 2. EXCLUSIVE DARK DESIGN RUNTIME
// ==========================================
export async function generate(customMode = null, forceRefresh = false) {
  const mode = "dark_design";

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

      if (existing && existing.content && existing.content.vector_mcq) {
        const finalOutput = JSON.stringify(existing.content, null, 2);
        fs.writeFileSync(EXPLICIT_OUTPUT_PATH, finalOutput);
        process.stdout.write(finalOutput);
        return existing.content;
      }
    }

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

    const prompt = `Return ONLY a raw JSON object for 'Dark Design'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map(t => `'${t}'`).join(', ')}]

CRITICAL CHARACTER & LANGUAGE CONSTRAINTS:
1. Every single text value you generate—including the values for text, ui, ad, and graph—MUST be under a strict maximum length of 150 characters. Be exceptionally short and punchy.
2. Use clear, plain, everyday language. Avoid complex, academic, or niche industry buzzwords (do not use terms like "vector", "multimodal", "asymmetric layout", or technical UX jargon) in the questions and options so it is easy for anyone to read.

CORE GAME MECHANICAL RULES:
1. 'vector_mcq' structural requirement:
   - Provide an easy-to-read question asking the user to find which option uses a trick or deceptive setup.
   - Generate exactly 4 dynamic options under keys "text", "ui", "ad", and "graph". Do not reuse example strings. 
   - Each individual option value MUST be a highly realistic micro-scenario description under 150 characters.
   - TEXT FOCUS TWEAK: For the "text" key option, format it explicitly as a text-only communication medium such as a headline, tweet, notification banner text, or email subject line.
   - To make it challenging, 2 or 3 of the wrong options should display slightly pushy marketing, high-pressure sale words, or slightly uneven chart setups. However, exactly ONE option must cross the line completely into an objective, deceptive trick pattern.
   - Set 'correct_vector' to the key name ("text", "ui", "ad", or "graph") holding that true deceptive trick, and 'correct_vector_index' to its 0-based array position (0-3).

2. 'manipulation_mcq' structural requirement:
   - Provide a plain question asking which specific trick name is being used in the answer chosen above.
   - Provide exactly 4 clear trick names as strings inside a plain array layout for 'options'. 
   - The names must be related to each other in context so the choice isn't obvious, but keep the language straightforward.
   - Set 'correct_manipulation_name' to the exact string matching the correct trick from the array, and 'correct_manipulation_index' to its 0-based index position (0, 1, 2, or 3).

3. 'short_explanation' requirement:
   - Provide a plain string under 150 characters explaining why this trick fits the chosen option over the other pushy marketing choices.

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
    "options": ["Confirmshaming", "Visual Interference", "Sneak into Basket", "Roach Motel"],
    "correct_manipulation_name": "Visual Interference",
    "correct_manipulation_index": 1
  },
  "short_explanation": "The website layout uses a trick by making the 'Accept All' option huge while hiding the decline choice inside regular text."
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
    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("API returned empty candidates.");

    const parsed = JSON.parse(rawText);
    const validated = DarkDesignSchema.parse(parsed);

    // ==========================================
    // 3. TRANSACTION OVERWRITE SNAPSHOT LAYER
    // ==========================================
    await supabase
      .from("kalari_games")
      .delete()
      .eq("mode", mode)
      .eq("scheduled_for", today);

    await supabase.from("kalari_games").insert({
      mode,
      topic: "Daily Dark Design Challenge", 
      content: validated,
      scheduled_for: today,
    });

    const finalOutput = JSON.stringify(validated, null, 2);
    fs.writeFileSync(EXPLICIT_OUTPUT_PATH, finalOutput);
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
// 4. TERMINAL EXECUTION HOOK
// ==========================================
if (process.argv[1] && (process.argv[1].endsWith("generate_dark_design.js") || process.argv[1].endsWith("generate_dark_design.ts"))) {
  const argv = yargs(hideBin(process.argv)).argv;
  const force = argv.forceRefresh === true || argv.forceRefresh === 'true' || argv.force === true;
  const targetMode = argv.mode || argv._[0] || null;

  generate(targetMode, force); 
}

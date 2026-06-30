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
const RESOLVED_OUTPUT_PATH = path.join(process.cwd(), 'dark_design.json');

const LimitedString = z.string().max(150, "Content exceeds the strict 150-character limit");
const ExplanationString = z.string().max(200, "Explanation exceeds the strict 200-character limit");

// ==========================================
// 1. DYNAMIC VALIDATION SCHEMA
// ==========================================
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
    correct_vector_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3))
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
    correct_vector_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3))
  }),
  short_explanation: ExplanationString 
});

// ==========================================
// 2. EXCLUSIVE DARK DESIGN RUNTIME
// ==========================================
export async function generate(customMode = null, forceRefresh = false) {
  const mode = "dark_design";

  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now.getTime() - offset).toISOString().split('T')[0];

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
        fs.writeFileSync(RESOLVED_OUTPUT_PATH, finalOutput);
        process.stdout.write(finalOutput);
        return existing.content;
      }
    }

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
      // Silent fallback if table query defaults
    }

    const prompt = `Return ONLY a raw JSON object for 'Dark Design'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map(t => `'${t}'`).join(', ')}]

CRITICAL CHARACTER & LANGUAGE CONSTRAINTS:
1. Questions and individual options (text, ui, ad, graph, a, b, c, d) MUST be under a strict maximum length of 150 characters.
2. The 'short_explanation' string MUST be under a strict maximum length of 200 characters. 
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
   - Provide a single, plain text string under 200 characters.
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
    fs.writeFileSync(RESOLVED_OUTPUT_PATH, finalOutput);
    process.stdout.write(finalOutput);

    return validated;
  } catch (err) {
    if (err instanceof z.ZodError) {
      process.stderr.write(JSON.stringify(err.errors, null, 2));
    } else if (err instanceof Error) {
      process.stderr.write(err.message);
    } else {
      process.stderr.write(String(err));
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
    baseName === "generate_dark_design.js" || 
    baseName === "generate_dark_design.ts" ||
    baseName === "generate_dark_designs.js" || 
    baseName === "generate_dark_designs.ts";

  if (matchesName) {
    const argv = yargs(hideBin(process.argv)).argv;
    const force = argv.forceRefresh === true || argv.forceRefresh === 'true' || argv.force === true;
    const targetMode = argv.mode || (argv._ && argv._[0] ? argv._[0] : null);

    generate(targetMode, force); 
  }
}

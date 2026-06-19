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

// ==========================================
// 1. UPDATED VALIDATION SCHEMA
// ==========================================
const DarkDesignSchema = z.object({
  vector_mcq: z.object({
    question: z.string(),
    options: z.object({
      text: z.string(),
      ui: z.string(),
      ad: z.string(),
      graph: z.string()
    }),
    correct_vector: z.enum(["text", "ui", "ad", "graph"]),
    correct_vector_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3))
  }),
  manipulation_mcq: z.object({
    question: z.string(),
    options: z.array(z.string()).length(4),
    correct_manipulation_name: z.string(),
    correct_manipulation_index: z.preprocess((val) => parseInt(val, 10), z.number().min(0).max(3))
  }),
  short_explanation: z.string()
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

CORE GAME MECHANICAL RULES:
1. 'vector_mcq' structural requirement:
   - Provide a question asking the user to pinpoint which element contains a definitive dark design pattern or deceptive manipulation technique.
   - You must generate exactly 4 options under the keys "text", "ui", "ad", and "graph".
   - Each option must contain a very short, realistic scenario text description of what that medium displays.
   - CRITICAL DIFFICULTY TWEAK: To maximize difficulty, 2 or 3 of the wrong options SHOULD look borderline deceptive, shady, or include intense marketing/persuasion "grey-area" techniques (e.g., strong urgency wording, slightly biased but technically true charts, intense promotional copywriting). They do not have to be transparent or honest. However, exactly ONE option must cross the line completely into an objective, established dark design pattern.
   - Set 'correct_vector' to the key name ("text", "ui", "ad", or "graph") that contains this true dark pattern, and 'correct_vector_index' to its 0-based array position matching how your frontend reads objects.

2. 'manipulation_mcq' structural requirement:
   - Provide a question asking which specific dark design/deceptive technique is being used in that correct option.
   - Provide 4 manipulation technique names as options (e.g., "Confirmshaming", "Visual Interference", "Truncated Y-Axis", "Roach Motel").
   - CRITICAL DISTRACTOR CONSTRAINT: The options must be closely related to the context of the answer to make detection challenging. If the deceptive option is a cookie banner using Visual Interference, the other options should be related design terms (like "Confirmshaming" or "Trick Questions"). Do not use highly disconnected terms (like "Sunk Cost Fallacy" or "Bait and Switch" for a graph scenario).

3. 'short_explanation' requirement:
   - A short, concise string explaining exactly what the correct technique name is for the second MCQ, and precisely why it fits the deceptive option in the first MCQ over the other "grey-area" distractions.

Do not wrap the JSON output in markdown backticks or code blocks.

Expected JSON Structure:
{
  "vector_mcq": {
    "question": "Which of these elements utilizes a deceptive dark design pattern?",
    "options": {
      "text": "<Short description of a borderline aggressive text announcement>",
      "ui": "<Short description of a manipulative UI layout using true visual trickery>",
      "ad": "<Short description of a pushy advertisement>",
      "graph": "<Short description of a slightly biased but technically legal data graph>"
    },
    "correct_vector": "ui",
    "correct_vector_index": 1
  },
  "manipulation_mcq": {
    "question": "Which deceptive technique is being leveraged in the interface example above?",
    "options": ["Confirmshaming", "Visual Interference", "Sneak into Basket", "Roach Motel"],
    "correct_manipulation_name": "Visual Interference",
    "correct_manipulation_index": 1
  },
  "short_explanation": "While the other options use aggressive marketing or persuasion tactics, the UI block explicitly crosses the line into Visual Interference by hiding the choice to opt-out behind stylized text formatting to break user intent."
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

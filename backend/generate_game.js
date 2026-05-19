import fs from 'fs';
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. SCHEMAS WITH ROBUST PRE-PROCESSING
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
        the_real_question: z.string(), // New field added for the numerical follow-up question
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

export async function generate(customMode = null, forceRefresh = false) {
  const argv = yargs(hideBin(process.argv)).argv;
  const mode = customMode || argv.mode || "extract_facts";

  // Chennai Local Date
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now - offset).toISOString().split('T')[0];

  try {
    // 2. CHECK LOCK (Skipped if forceRefresh is true)
    if (!forceRefresh) {
      const { data: existing } = await supabase
        .from("kalari_games")
        .select("content")
        .eq("mode", mode)
        .eq("scheduled_for", today)
        .maybeSingle();

      if (existing && existing.content) {
        const hasGut = mode === "gut_check" && existing.content.questions;
        const hasFacts = mode === "extract_facts" && existing.content.mcq_questions;

        // Verify cached entries match the latest updated properties
        if ((hasGut && existing.content.questions[0].hasOwnProperty('the_real_question')) || hasFacts) {
          const out = JSON.stringify(existing.content, null, 2);
          process.stdout.write(out);
          return existing.content;
        }
      }
    }

    // 3. HARD-CODED PROMPT TEMPLATES (Ensures structure and format)
    let prompt = "";
    if (mode === "gut_check") {
      prompt = `Return ONLY a raw JSON object for 'Gut Check'.
            Date: ${today}.
            
            MANDATORY QUESTION STYLE:
            Every single question segment must consist of two steps:
            1. An 'anchor_statement': Phrased as a clear binary "Yes/No" baseline check containing a numeric benchmark (e.g., "Is the Burj Khalifa taller than 800 meters?").
            2. A 'the_real_question': A direct numerical question fallback styled to ask the user for the actual metrics if they guess incorrectly or encounter a false anchor (e.g., "What is the exact maximum height of the Burj Khalifa?").
            
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
                    { 
                        "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", 
                        "is_anchor_true": true,
                        "the_real_question": "<Follow-up question requesting the actual target metric>",
                        "the_real_number": 125.4, 
                        "unit": "<unit>", 
                        "difficulty_level": "Easy" 
                    },
                    { 
                        "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", 
                        "is_anchor_true": false,
                        "the_real_question": "<Follow-up question requesting the actual target metric>",
                        "the_real_number": 450, 
                        "unit": "<unit>", 
                        "difficulty_level": "Medium" 
                    },
                    { 
                        "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary>", 
                        "is_anchor_true": false,
                        "the_real_question": "<Follow-up question requesting the actual target metric>",
                        "the_real_number": 0.08, 
                        "unit": "<unit>", 
                        "difficulty_level": "Hard" 
                    }
                ]
            }`;
    } else {
      prompt = `Return ONLY a raw JSON object for 'Extract the Facts'.
            Date: ${today}. Level: Complex logic.
            {
                "topic": "Future Technology",
                "paragraph_a": "Detailed factual paragraph.",
                "paragraph_b": "Detailed but slightly inaccurate paragraph.",
                "mcq_questions": [
                    { "question": "string", "options": ["A", "B", "C", "D"], "correct_answer_index": 1 }
                ]
            } (Provide exactly 3 questions in mcq_questions array)`;
    }
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GOOGLE_GENERATIVE_AI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("API returned empty candidates.");

    const parsed = JSON.parse(rawText);

    // 4. VALIDATE AGAINST MODE-SPECIFIC SCHEMA
    const validated =
      mode === "gut_check"
        ? GutCheckSchema.parse(parsed)
        : ExtractFactsSchema.parse(parsed);

    // 5. UPSERT (Overwrites database entry with the newly added text fields)
    await supabase.from("kalari_games").upsert(
      {
        mode,
        topic: mode === "gut_check" ? validated.industry_theme : validated.topic,
        content: validated,
        scheduled_for: today,
      },
      { onConflict: "mode,scheduled_for" },
    );

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

// Check execution argument
if (process.argv[1] && (process.argv[1].endsWith("generate_game.js") || process.argv[1].endsWith("generate_game.ts"))) {
  // Keeping cache-bypass on for this run to build out the new key structure live
  generate(null, true); 
}

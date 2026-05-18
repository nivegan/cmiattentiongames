import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY } =
  process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. SCHEMAS WITH ROBUST PRE-PROCESSING
const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z
    .array(
      z.object({
        anchor_statement: z.string(),
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

// Made the function exportable and allowed an optional customMode parameter for the front-end call
export async function generate(customMode = null) {
  // If called via function argument, use that; otherwise fall back to terminal flags/default
  const argv = yargs(hideBin(process.argv)).argv;
  const mode = customMode || argv.mode || "extract_facts";

  // Chennai Local Date
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now - offset).toISOString().split("T")[0];

  try {
    // 2. CHECK LOCK (Ignore malformed DB entries)
    const { data: existing } = await supabase
      .from("kalari_games")
      .select("content")
      .eq("mode", mode)
      .eq("scheduled_for", today)
      .maybeSingle();

    // console.log("\n\n\n\n\n\n\nCheckpoint\n\n\n\n\n\n\n");
    // Validating structure before returning existing
    if (existing && existing.content) {
      const hasGut = mode === "gut_check" && existing.content.questions;
      const hasFacts =
        mode === "extract_facts" && existing.content.mcq_questions;

      if (hasGut || hasFacts) {
        const out = JSON.stringify(existing.content, null, 2);
        process.stdout.write(out);

        // Return the cached JSON object directly to the function caller
        return existing.content;
      }
    }
    // console.log("\n\n\n\n\n\n\nCheckpoint2\n\n\n\n\n\n\n");

    // 3. HARD-CODED PROMPT TEMPLATES (Ensures no hallucinations)
    let prompt = "";
    if (mode === "gut_check") {
      prompt = `Return ONLY a raw JSON object for 'Gut Check'.
            Date: ${today}. Level: Increasing difficulty.
            {
                "industry_theme": "Industrial",
                "questions": [
                    { "anchor_statement": "string", "the_real_number": 12.5, "unit": "unit", "difficulty_level": "Easy" },
                    { "anchor_statement": "string", "the_real_number": 450, "unit": "unit", "difficulty_level": "Medium" },
                    { "anchor_statement": "string", "the_real_number": 0.8, "unit": "unit", "difficulty_level": "Hard" }
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
    console.log("\n\n\n\n\n\n\n\n\n\nData = ", data, "\n\n\n\n\n\n\n\n\n");
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("API returned empty candidates.");

    const parsed = JSON.parse(rawText);

    // 4. VALIDATE AGAINST MODE-SPECIFIC SCHEMA
    const validated =
      mode === "gut_check"
        ? GutCheckSchema.parse(parsed)
        : ExtractFactsSchema.parse(parsed);

    // 5. UPSERT (Force overwrite of any "undefined" or broken entries for today)
    await supabase.from("kalari_games").upsert(
      {
        mode,
        topic:
          mode === "gut_check" ? validated.industry_theme : validated.topic,
        content: validated,
        scheduled_for: today,
      },
      { onConflict: "mode,scheduled_for" },
    );

    const finalOutput = JSON.stringify(validated, null, 2);
    process.stdout.write(finalOutput);

    // Return the freshly validated JSON object directly to the function caller
    return validated;
  } catch (err) {
    console.error("🛑 SCRIPT ERROR:", err.message);
    if (err instanceof z.ZodError) {
      console.error("Validation Details:", JSON.stringify(err.errors, null, 2));
    }
    throw err; // Forward error to the front-end wrapper handling the request
  }
}

// Keep this check so it still runs if executed directly via terminal ("node generate_game.js")
if (process.argv[1] && process.argv[1].endsWith("generate_game.js")) {
  generate();
}

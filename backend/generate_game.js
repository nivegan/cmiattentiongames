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

        if ((hasGut && existing.content.questions[0].hasOwnProperty('the_real_question')) || hasFacts) {
          const out = JSON.stringify(existing.content, null, 2);
          process.stdout.write(out);
          return existing.content;
        }
      }
    }

    // 3. HARD-CODED PROMPT TEMPLATES
    let prompt = "";
    if (mode === "gut_check") {
      // ==========================================
      // START OF GUT CHECK PROMPT
      // ==========================================
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
      // ==========================================
      // END OF GUT CHECK PROMPT
      // ==========================================
    } else {
      // ==========================================
      // START OF EXTRACT FACTS PROMPT
      // ==========================================
      prompt = `Return ONLY a raw JSON object for 'Extract the Facts'.
            Date: ${today}.
            
            THEME AND VOICE INSTRUCTIONS:
            1. Topic Choice: Pick a generalized, completely non-political and non-controversial real-world scene, trend, or human interest event (e.g., city infrastructure updates, neighborhood library hours, community sports, historical updates, or public space re-routing).
            2. ABSOLUTE FILTER: Do NOT include any political parties, politician names, government election disputes, or sensitive geopolitical events. Keep topics entirely safe, constructive, and generalized.
            3. Style, Tone & Sentiment Variance: Write paragraphs formatted to simulate a concise local news blurb, a high-engagement social media post, or a fast tabloid snippet. Infuse the text with different emotional nuances, tones, or vocabulary framing.
            4. THE CORE DIFFERENCE: The differences between the two paragraphs do NOT need to be numbers. Instead, focus heavily on structural sentiment swaps and perspective spins. For example, Paragraph A might say "traffic was smoothly diverted for a passionate, peaceful community demonstration" while Paragraph B says "commuters faced major gridlock and blocked roads due to an disruptive public protest."
            5. Strict Length Constraint: Both 'paragraph_a' and 'paragraph_b' must be kept crisp and short, fitting within a standard 280-character Twitter length limit.
            6. Formatting Rule: Do NOT include any quotation marks (" or ') anywhere inside the paragraphs. 
            7. Do not accidently take a direct quote from any tabloid, news source, or social media post. The text should be freshly generated and not lifted verbatim from any existing source.
            
            
            GAME DATA LOGIC:
            - Provide a unified, generalized 'topic'.
            - 'paragraph_a' and 'paragraph_b' must describe the exact same real-world scene but spin the underlying sentiment details, vocabulary framing, or qualitative facts between them.
            - Generate exactly 3 multiple-choice questions ('mcq_questions') that specifically test the user's sharp attention to detail regarding these altered sentiment-driven perspectives, phrasing disparities, or facts.
            - Each question must have exactly 4 strings in the 'options' array, and a 'correct_answer_index' (0 to 3).
            - Do not wrap the output in markdown code blocks.

            Expected JSON Structure:
            {
                "topic": "<General Non-Controversial Real-World Trend or Event>",
                "paragraph_a": "<Crisp text under 280 characters with a distinct emotional perspective, no quotes>",
                "paragraph_b": "<Crisp text under 280 characters describing the same scene with a contrasting sentiment/vocabulary spin, no quotes>",
                "mcq_questions": [
                    {
                        "question": "<Analytical question testing differences in sentiment, wording, or facts between the texts>",
                        "options": ["Option A", "Option B", "Option C", "Option D"],
                        "correct_answer_index": 0
                    },
                    {
                        "question": "<Analytical question testing differences in sentiment, wording, or facts between the texts>",
                        "options": ["Option A", "Option B", "Option C", "Option D"],
                        "correct_answer_index": 2
                    },
                    {
                        "question": "<Analytical question testing differences in sentiment, wording, or facts between the texts>",
                        "options": ["Option A", "Option B", "Option C", "Option D"],
                        "correct_answer_index": 1
                    }
                ]
            }`;
      // ==========================================
      // END OF EXTRACT FACTS PROMPT
      // ==========================================
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

    // 5. UPSERT
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
  generate(null, true); 
}

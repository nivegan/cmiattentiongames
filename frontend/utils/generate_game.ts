import { z } from "zod";
import { PrismaClient } from "../lib/generated/prisma/client";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

dotenv.config({ path: ".env.local" });

const { GOOGLE_GENERATIVE_AI_API_KEY, DATABASE_URL } = process.env;

if (!GOOGLE_GENERATIVE_AI_API_KEY || !DATABASE_URL) {
  throw new Error("Missing required environment variables.");
}

const adapter = new PrismaPg({
  connectionString: DATABASE_URL,
});
export const prisma = new PrismaClient({ adapter });

// ── Types ──────────────────────────────────────────────────────────────────

export type GameMode = "gut_check" | "extract_facts";
export type GutCheckGame = z.infer<typeof GutCheckSchema>;
export type ExtractFactsGame = z.infer<typeof ExtractFactsSchema>;
export type GameResult = GutCheckGame | ExtractFactsGame;

// ── Schemas ────────────────────────────────────────────────────────────────

const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z
    .array(
      z.object({
        anchor_statement: z.string(),
        is_anchor_true: z.preprocess((val) => {
          if (typeof val === "string") return val.toLowerCase() === "true";
          return Boolean(val);
        }, z.boolean()),
        the_real_question: z.string(), // New field added for the numerical follow-up question
        the_real_number: z.preprocess(
          (val) => parseFloat(val as string),
          z.number(),
        ),
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
          (val) => parseInt(val as string, 10),
          z.number().min(0).max(3),
        ),
      }),
    )
    .length(3),
});

// ── Exported function ──────────────────────────────────────────────────────

export async function generate(
  customMode: GameMode | null = null,
  forceRefresh: boolean = false,
): Promise<GameResult> {
  const argv = yargs(hideBin(process.argv)).argv as { mode?: string };
  const mode: GameMode = (customMode ||
    argv.mode ||
    "extract_facts") as GameMode;

  // Chennai Local Date
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now.getTime() - offset).toISOString().split("T")[0];
  const todayDate = new Date(`${today}T00:00:00.000Z`);

  try {
    // 1. CHECK LOCK (Skipped if forceRefresh is true)
    if (!forceRefresh) {
      const existing = await prisma.kalari_games.findUnique({
        where: {
          mode_scheduled_for: {
            mode,
            scheduled_for: todayDate,
          },
        },
        select: { content: true },
      });

      if (existing?.content) {
        const content = existing.content as {
          questions?: Array<{ the_real_question?: unknown }>;
          mcq_questions?: unknown[];
        };
        const hasGut = mode === "gut_check" && content.questions;
        const hasFacts = mode === "extract_facts" && content.mcq_questions;

        // Verify cached entries match the latest updated properties
        if (
          (hasGut &&
            content.questions?.[0]?.hasOwnProperty("the_real_question")) ||
          hasFacts
        ) {
          // const out = JSON.stringify(content, null, 2);
          // process.stdout.write(out + "\n");
          return content as GameResult;
        }
      }
    }

    // 2. HARD-CODED PROMPT TEMPLATES (Ensures structure and format)
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
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text as
      | string
      | undefined;

    if (!rawText) throw new Error("API returned empty candidates.");

    const parsed: unknown = JSON.parse(rawText);

    // 3. VALIDATE AGAINST MODE-SPECIFIC SCHEMA
    const validated: GameResult =
      mode === "gut_check"
        ? GutCheckSchema.parse(parsed)
        : ExtractFactsSchema.parse(parsed);

    // 4. UPSERT TO PRISMA
    await prisma.kalari_games.upsert({
      where: {
        mode_scheduled_for: {
          mode,
          scheduled_for: todayDate,
        },
      },
      update: {
        topic:
          mode === "gut_check"
            ? (validated as GutCheckGame).industry_theme
            : (validated as ExtractFactsGame).topic,
        content: validated,
      },
      create: {
        mode,
        topic:
          mode === "gut_check"
            ? (validated as GutCheckGame).industry_theme
            : (validated as ExtractFactsGame).topic,
        content: validated,
        scheduled_for: todayDate,
      },
    });

    // 5. WRITE OUT FOR DEBUGGING/LOGGING
    // const finalOutput = JSON.stringify(validated, null, 2);
    // process.stdout.write(finalOutput);

    return validated;
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error("Validation Details:", JSON.stringify(err.issues, null, 2));
    }
    console.error("🛑 SCRIPT ERROR:", (err as Error).message);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

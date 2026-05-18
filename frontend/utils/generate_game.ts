// generate_game.ts
import { z } from "zod";
import { PrismaClient } from "../lib/generated/prisma/client";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config();

const { GOOGLE_GENERATIVE_AI_API_KEY, DATABASE_URL } = process.env;

if (!GOOGLE_GENERATIVE_AI_API_KEY || !DATABASE_URL) {
  throw new Error("Missing required environment variables.");
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
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
  customMode: GameMode = "extract_facts",
): Promise<GameResult> {
  const mode: GameMode = customMode;

  // Chennai Local Date
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now.getTime() - offset).toISOString().split("T")[0];
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  // console.log("\n\n\n\n\n\n\n\n\n\nCheck\n\n\n\n\n\n\n\n\n\n\n");
  try {
    // 1. CHECK LOCK (Ignore malformed DB entries)
    const existing = await prisma.kalari_games.findUnique({
      where: {
        mode_scheduled_for: {
          mode,
          scheduled_for: todayDate,
        },
      },
      select: { content: true },
    });

    // console.log("\n\n\n\n\n\n\n\n\n\nCheck2\n\n\n\n\n\n\n\n\n\n\n");
    if (existing?.content) {
      const content = existing.content as Record<string, unknown>;
      const hasGut = mode === "gut_check" && content.questions;
      const hasFacts = mode === "extract_facts" && content.mcq_questions;

      if (hasGut || hasFacts) {
        return content as GameResult;
      }
    }

    // 2. HARD-CODED PROMPT TEMPLATES
    const prompt =
      mode === "gut_check"
        ? `Return ONLY a raw JSON object for 'Gut Check'.
            Date: ${today}. Level: Increasing difficulty.
            {
              "industry_theme": "Industrial",
              "questions": [
                { "anchor_statement": "string", "the_real_number": 12.5, "unit": "unit", "difficulty_level": "Easy" },
                { "anchor_statement": "string", "the_real_number": 450, "unit": "unit", "difficulty_level": "Medium" },
                { "anchor_statement": "string", "the_real_number": 0.8, "unit": "unit", "difficulty_level": "Hard" }
              ]
            }`
        : `Return ONLY a raw JSON object for 'Extract the Facts'.
            Date: ${today}. Level: Complex logic.
            {
              "topic": "Future Technology",
              "paragraph_a": "Detailed factual paragraph.",
              "paragraph_b": "Detailed but slightly inaccurate paragraph.",
              "mcq_questions": [
                { "question": "string", "options": ["A", "B", "C", "D"], "correct_answer_index": 1 }
              ]
            } (Provide exactly 3 questions in mcq_questions array)`;

    // const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_GENERATIVE_AI_API_KEY}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_GENERATIVE_AI_API_KEY}`;
    // const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GOOGLE_GENERATIVE_AI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    const data = await response.json();
    // console.log("\n\n\n\n\n\n\n\n\n\nData = ", data, "\n\n\n\n\n\n\n\n\n");
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

    // 4. UPSERT
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

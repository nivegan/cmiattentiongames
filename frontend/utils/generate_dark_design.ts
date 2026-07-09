import { z } from "zod";
import dotenv from "dotenv";
import { prisma } from "../utils/prismaInit";

dotenv.config();

const { GOOGLE_GENERATIVE_AI_API_KEY } = process.env;

if (!GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("Missing required environment variables in .env");
}

// Reusable schema helper to enforce the strict 150-character limit
const LimitedString = z
  .string()
  .max(150, "Content exceeds the strict 150-character limit");
// Strictly capped at 200 characters to ensure concise explanation delivery
const ExplanationString = z
  .string()
  .max(200, "Explanation exceeds the strict 200-character limit");

// ==========================================
// 1. DYNAMIC VALIDATION SCHEMA & TYPES
// ==========================================
const DarkDesignSchema = z.object({
  vector_mcq: z.object({
    question: LimitedString,
    options: z.object({
      text: LimitedString,
      ui: LimitedString,
      ad: LimitedString,
      graph: LimitedString,
    }),
    correct_vector: z.enum(["text", "ui", "ad", "graph"]),
    correct_vector_index: z.preprocess(
      (val) => parseInt(val as string, 10),
      z.number().min(0).max(3),
    ),
  }),
  manipulation_mcq: z.object({
    question: LimitedString,
    options: z.array(LimitedString).length(4),
    correct_manipulation_name: LimitedString,
    correct_manipulation_index: z.preprocess(
      (val) => parseInt(val as string, 10),
      z.number().min(0).max(3),
    ),
  }),
  short_explanation: ExplanationString,
});

type DarkDesignData = z.infer<typeof DarkDesignSchema>;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

// ==========================================
// 2. EXCLUSIVE DARK DESIGN RUNTIME
// ==========================================
export async function generate(forceRefresh = false): Promise<DarkDesignData> {
  const mode = "dark_design";

  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now.getTime() - offset).toISOString().split("T")[0];
  // kalari_games.scheduled_for is a DateTime column — Prisma rejects a bare
  // "YYYY-MM-DD" string. Store the date at UTC midnight (same convention as the
  // other generators) so the (mode, scheduled_for) cache key is stable.
  const todayDate = new Date(`${today}T00:00:00.000Z`);

  try {
    // NATURAL 24-HOUR DAILY LOCK CHECK
    if (!forceRefresh) {
      const existing = await prisma.kalari_games.findFirst({
        where: {
          mode,
          scheduled_for: todayDate,
        },
        select: {
          content: true,
        },
      });

      // Validate the cached row against the CURRENT schema rather than trusting
      // it blindly. A row written under an older shape (e.g. the legacy object-
      // keyed manipulation_mcq) fails safeParse and falls through to regenerate,
      // so the transaction below overwrites it — self-healing on a schema change.
      if (existing?.content) {
        const cached = DarkDesignSchema.safeParse(existing.content);
        if (cached.success) {
          return cached.data;
        }
      }
    }

    // MEMORY LOOP LAYER: FETCH PAST 10 TOPICS DIRECTLY FROM KALARI_GAMES
    let recentTopics: string[] = [];
    try {
      const history = await prisma.kalari_games.findMany({
        select: {
          topic: true,
        },
        orderBy: {
          scheduled_for: "desc",
        },
        take: 10,
      });

      if (history && history.length > 0) {
        recentTopics = history
          .map((h) => h.topic)
          .filter((t): t is string => Boolean(t));
      }
    } catch (err) {
      // Silent fallback if table query defaults
      console.error("🛑 SCRIPT ERROR:", (err as Error).message);
      // ZodError has a detailed `issues` array describing exactly which fields
      // failed validation and why — very useful for debugging Gemini output changes.
      if (err instanceof z.ZodError) {
        console.error(
          "Validation Details:",
          JSON.stringify(err.issues, null, 2),
        );
      }
      throw err; //
    }

    const prompt = `Return ONLY a raw JSON object for 'Dark Design'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map((t) => `'${t}'`).join(", ")}]

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
   - Provide exactly 4 clear trick names inside a JSON array under the key "options" (4 plain string entries).
   - Set 'correct_manipulation_name' to the exact trick name string holding the true trick, and 'correct_manipulation_index' to its corresponding 0-based index position in the array.

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
    "options": ["Confirmshaming", "Visual Interference", "Sneak into Basket", "Roach Motel"],
    "correct_manipulation_name": "Visual Interference",
    "correct_manipulation_index": 1
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
          temperature: 1.0,
        },
      }),
    });

    const data = (await response.json()) as GeminiResponse;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("API returned empty candidates.");

    const parsed = JSON.parse(rawText);
    const validated = DarkDesignSchema.parse(parsed);

    // ==========================================
    // 3. TRANSACTION OVERWRITE SNAPSHOT LAYER
    // ==========================================
    await prisma.$transaction([
      prisma.kalari_games.deleteMany({
        where: {
          mode,
          scheduled_for: todayDate,
        },
      }),
      prisma.kalari_games.create({
        data: {
          mode,
          topic: "Daily Dark Design Challenge",
          content: validated,
          scheduled_for: todayDate,
        },
      }),
    ]);

    const finalOutput = JSON.stringify(validated, null, 2);
    process.stdout.write(finalOutput);

    return validated;
  } catch (err) {
    if (err instanceof z.ZodError) {
      process.stderr.write(JSON.stringify(err.issues, null, 2));
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

export type { DarkDesignData };

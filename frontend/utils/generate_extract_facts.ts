import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";
import { prisma } from "./prismaInit";
import { getTodayIST } from "./seedRng";

dotenv.config();

const { GOOGLE_GENERATIVE_AI_API_KEY } = process.env;

if (!GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("Missing required environment variables in .env.local");
}

// ==========================================
// 1. DYNAMIC VALIDATION SCHEMA & TYPES
// ==========================================
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

type ExtractFactsData = z.infer<typeof ExtractFactsSchema>;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface YargsArgs {
  forceRefresh?: boolean | string;
  force?: boolean;
  mode?: string;
  _?: Array<string | number>;
}

// ==========================================
// 2. EXCLUSIVE RUNTIME (STRICT TEMPLATE)
// ==========================================
const generate = async (
  forceRefresh: boolean = false,
): Promise<ExtractFactsData> => {
  const mode = "extract_facts";

  // FIX: Explicit compilation resolution via parseSync() instead of direct unsafe .argv chaining
  const rawArgv = yargs(
    hideBin(process.argv),
  ).parseSync() as unknown as YargsArgs;
  const shouldForce =
    forceRefresh ||
    rawArgv.forceRefresh === true ||
    rawArgv.forceRefresh === "true" ||
    rawArgv.force === true;

  // The platform's "day" rolls over at IST midnight — the same boundary the
  // daily play lock uses (utils/getCurrentDayRange.ts). Deriving this from the
  // server's local timezone would desync content from the lock on non-IST servers.
  const today = getTodayIST();

  // FIX: Clear day boundary windows to account for database column timezone discrepancies safely
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const todayEnd = new Date(`${today}T23:59:59.999Z`);

  try {
    // NATURAL 24-HOUR DAILY LOCK CHECK
    if (!shouldForce) {
      const existing = await prisma.kalari_games.findFirst({
        where: {
          mode,
          scheduled_for: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
        select: { content: true },
      });

      if (existing && existing.content) {
        let contentObj = existing.content;

        // FIX: Account for edge-cases where columns return raw stringified JSON
        if (typeof contentObj === "string") {
          try {
            contentObj = JSON.parse(contentObj);
          } catch (err) {
            console.error("🛑 SCRIPT ERROR:", (err as Error).message);
            // ZodError has a detailed `issues` array describing exactly which fields
            // failed validation and why — very useful for debugging Gemini output changes.
            if (err instanceof z.ZodError) {
              console.error(
                "Validation Details:",
                JSON.stringify(err.issues, null, 2),
              );
            }
            throw err; // re-throw so the calling server action can return an error response
          }
        }

        if (contentObj && typeof contentObj === "object") {
          const typedContent = contentObj as Record<string, unknown>;
          if (typedContent.topic) {
            const finalOutput = JSON.stringify(typedContent, null, 2);
            process.stdout.write(finalOutput);
            return typedContent as unknown as ExtractFactsData;
          }
        }
      }
    }

    // MEMORY LOOP LAYER: EXPANDED WINDOW FOR DIVERSITY
    let recentTopics: string[] = [];
    try {
      const history = await prisma.kalari_games.findMany({
        orderBy: { scheduled_for: "desc" },
        take: 20,
        select: { topic: true },
      });

      if (history && history.length > 0) {
        recentTopics = history
          .map((h) => h.topic)
          .filter((t): t is string => Boolean(t));
      }
    } catch (err) {
      console.error("🛑 SCRIPT ERROR:", (err as Error).message);
      // ZodError has a detailed `issues` array describing exactly which fields
      // failed validation and why — very useful for debugging Gemini output changes.
      if (err instanceof z.ZodError) {
        console.error(
          "Validation Details:",
          JSON.stringify(err.issues, null, 2),
        );
      }
      throw err; // re-throw so the calling server action can return an error response
    }

    const prompt = `Return ONLY a raw JSON object for 'Extract the Facts'.
Date: ${today}.
Entropy Factor: ${Math.random().toString(36).substring(7)}.

ANTI-REPETITION FILTER:
You must select a radically different topic than these recent entries: [${recentTopics.map((t) => `'${t}'`).join(", ")}].
Vary between: global industry shifts, ethical dilemmas in technology, sensitive societal controversies, corporate policy changes, or complex human behaviors.

THEME AND VOICE INSTRUCTIONS:
1. Topic Choice: Select high-impact, potentially polarizing themes. Examples include: AI displacing specialized labor, the ethics of remote surveillance in a corporation, the societal impact of radical new consumer technologies, or the friction between traditional industries and emerging automation.
2. ANONYMITY RULE: ABSOLUTELY NO PROPER NOUNS. Use generic placeholders like: Company X, City Y, Country Z, The Organization, The Platform, The New Tech, The Industry, or The Group. Do not name specific brands, actual people, or real geographic locations.
3. Sentiment Variance: 
   - Paragraph A: Pro-perspective (e.g., efficiency, progress, innovation, necessary sacrifice). 
   - Paragraph B: Critical-perspective (e.g., human cost, moral danger, loss of privacy, long-term instability).
4. Strict Length: Both paragraphs must be under 280 characters.
5. NO QUOTES: Do not use " or ' anywhere in the paragraph text.
6. Tone: Sharp, observational, and provocative. 

Expected JSON Structure:
{
  "topic": "<Broad, Non-Specific, Polarizing Title>",
  "paragraph_a": "<Pro/Optimistic perspective, under 280 chars, no quotes>",
  "paragraph_b": "<Critical/Cynical perspective, under 280 chars, no quotes>",
  "mcq_questions": [
    { "question": "<Analytical question comparing the perspectives>", "options": ["Option A", "Option B", "Option C", "Option D"], "correct_answer_index": 0 },
    { "question": "<Analytical question regarding the core dilemma>", "options": ["Option A", "Option B", "Option C", "Option D"], "correct_answer_index": 2 },
    { "question": "<Analytical question testing the deeper implication>", "options": ["Option A", "Option B", "Option C", "Option D"], "correct_answer_index": 1 }
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
          temperature: 1.0,
        },
      }),
    });

    const data = (await response.json()) as GeminiResponse;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("API returned empty candidates.");

    const parsed = JSON.parse(rawText);
    const validated = ExtractFactsSchema.parse(parsed);

    // TRANSACTION OVERWRITE SNAPSHOT LAYER
    // FIX: Match explicit 24-hour block deletion alignment target, wrapped atomically
    await prisma.$transaction([
      prisma.kalari_games.deleteMany({
        where: {
          mode,
          scheduled_for: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
      }),
      prisma.kalari_games.create({
        data: {
          mode,
          topic: validated.topic,
          content: validated,
          scheduled_for: todayStart,
        },
      }),
    ]);

    const finalOutput = JSON.stringify(validated, null, 2);
    process.stdout.write(finalOutput);

    return validated;
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      // FIX: Changed .errors reference to standard .issues property layout
      process.stderr.write(JSON.stringify(err.issues, null, 2));
    } else if (err instanceof Error) {
      process.stderr.write(err.message);
    } else {
      process.stderr.write(String(err));
    }
    throw err;
  }
};

// ==========================================
// 3. TERMINAL EXECUTION HOOK (STRICT TEMPLATE)
// ==========================================
// const currentScript = process.argv[1];
// if (currentScript) {
//   const matchesName =
//     baseName === "generate_extract_facts.js" ||
//     baseName === "generate_extract_facts.ts";

//   if (matchesName) {
//     // FIX: Explicit execution resolution context via parseSync()
//     const terminalArgv = yargs(
//       hideBin(process.argv),
//     ).parseSync() as unknown as YargsArgs;
//     const force =
//       terminalArgv.forceRefresh === true ||
//       terminalArgv.forceRefresh === "true" ||
//       terminalArgv.force === true;
//     const targetMode =
//       terminalArgv.mode ||
//       (terminalArgv._ && typeof terminalArgv._[0] === "string"
//         ? terminalArgv._[0]
//         : null);

//     generate(targetMode, force);
//   }
// }

export { generate };
export type { ExtractFactsData };

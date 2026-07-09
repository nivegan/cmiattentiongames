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

const LimitedString = z
  .string()
  .max(150, "Content exceeds the strict 150-character limit");

// ==========================================
// 1. DYNAMIC VALIDATION SCHEMA & TYPES
// ==========================================
const GutCheckSchema = z.object({
  industry_theme: z.string(),
  questions: z
    .array(
      z.object({
        anchor_statement: LimitedString,
        is_anchor_true: z.preprocess(
          (val) =>
            typeof val === "string"
              ? val.toLowerCase() === "true"
              : Boolean(val),
          z.boolean(),
        ),
        the_real_question: LimitedString,
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

type GutCheckData = z.infer<typeof GutCheckSchema>;

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
// 2. EXCLUSIVE GUT CHECK RUNTIME
// ==========================================
const generate = async (forceRefresh = false): Promise<GutCheckData> => {
  const mode = "gut_check";

  // FIX: Explicit execution context compilation via parseSync()
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

  // FIX: Explicit 24-hour boundary ranges to handle Timestamp / Timezone variations safely
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const todayEnd = new Date(`${today}T23:59:59.999Z`);

  // STRICT ORDER FILTER FOR SERIALIZATION ENGINE
  const strictJsonReplacerOrder: string[] = [
    "industry_theme",
    "questions",
    "anchor_statement",
    "is_anchor_true",
    "the_real_question",
    "the_real_number",
    "unit",
    "difficulty_level",
  ];

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

        // FIX: Safe-parse if the DB returned the JSON payload as a raw string
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
            throw err;
          }
        }

        if (contentObj && typeof contentObj === "object") {
          const typedContent = contentObj as Record<string, unknown>;
          if (typedContent.industry_theme || typedContent.questions) {
            process.stderr.write(
              `[CACHE HIT] Found active game in Prisma for ${today}. Bypassing API.\n`,
            );
            const finalOutput = JSON.stringify(
              typedContent,
              strictJsonReplacerOrder,
              2,
            );
            process.stdout.write(finalOutput);
            return typedContent as unknown as GutCheckData;
          }
        }
      }
    }

    process.stderr.write(
      `[API INIT] Cache empty or forced. Reaching out to Gemini API for ${today}...\n`,
    );

    // MEMORY LOOP LAYER: FETCH PAST 10 TOPICS DIRECTLY FROM KALARI_GAMES
    let recentTopics: string[] = [];
    try {
      const history = await prisma.kalari_games.findMany({
        orderBy: { scheduled_for: "desc" },
        take: 10,
        select: { topic: true },
      });

      if (history && history.length > 0) {
        recentTopics = history
          .map((h) => h.topic)
          .filter((t): t is string => Boolean(t));
      }
    } catch (err) {
      // Fallback
      console.error("🛑 SCRIPT ERROR:", (err as Error).message);
      // ZodError has a detailed `issues` array describing exactly which fields
      // failed validation and why — very useful for debugging Gemini output changes.
      if (err instanceof z.ZodError) {
        console.error(
          "Validation Details:",
          JSON.stringify(err.issues, null, 2),
        );
      }
      throw err;
    }

    const prompt = `Return ONLY a raw JSON object for 'Gut Check'.
Date: ${today}.
Dynamic Entropy Value: ${Date.now()}-${Math.random()}.

THEME VARIETY INSTRUCTIONS:
Select a fun, high-level, broad general knowledge domain that appeals to a mainstream audience. The theme must be widely recognizable and culturally accessible.
Mandatory broad categories to pick from (rotate or select one dynamically):
- Global Landmarks & Travel Geography (e.g., world capitals, flight distances, mountain ranges, famous rivers)
- Everyday Culinary Arts & Food Culture (e.g., standard baking temperatures, regional crop production scales, restaurant milestones)
- Consumer Tech & Modern Internet History (e.g., launch years of popular apps, standard battery life capacities, pixel counts)
- Major Sports & Athletic Milestones (e.g., marathon lengths, Olympic records, historic stadium seating capacities)
- Everyday Urban Economics & Lifestyle (e.g., average commute times, common household sizes, historical currency shifts)
- Science & Natural Phenomena (e.g., average rainfall, standard atmospheric pressures, common chemical concentrations)
- Science & Discovery (e.g., average lifespan of common species, standard measurements in physics, historical scientific milestones)
- History & Cultural Landmarks (e.g., founding years of major cities, historical population counts, landmark construction dates)
- Fun Facts & Trivia (e.g., world record statistics, quirky historical facts, unusual natural occurrences)
- Geography & Environmental Science (e.g., average river lengths, standard ocean depths, common climate statistics)
- Biology & Life Sciences (e.g., average gestation periods, standard lifespans of species, common biological measurements)
- Astronomy & Space Exploration (e.g., average distances to celestial bodies, standard orbital periods, historical space mission dates)
- Modern discoveries & Innovations (e.g., launch years of major tech products, standard measurements in engineering, recent scientific breakthroughs)

CRITICAL BAN LIST (NEVER GENERATE THESE):
Do NOT focus on hyper-niche academic disciplines, marine biology, deep-sea exploration, oceanography, astrophysics, space metrics, 'Mycology', 'Mushroom networks', 'Burj Khalifa', architectural building heights, or specialized scientific lab values.


ANTI-REPETITION FILTER (MEMORY LOOP):
Avoid themes matching or closely relating to these recent topics:
[${recentTopics.map((t) => `'${t}'`).join(", ")}]

CRITICAL LENGTH CONSTRAINTS:
1. Every 'anchor_statement' MUST be under a strict maximum length of 150 characters.
2. Every 'the_real_question' MUST be under a strict maximum length of 150 characters.

MANDATORY QUESTION STYLE:
Every single question segment must consist of two steps:
1. An 'anchor_statement': Phrased as a clear binary "Yes/No" baseline check containing an everyday numeric benchmark (e.g., "Does a standard marathon cover more than 30 miles?").
2. A 'the_real_question': A direct numerical question fallback styled to ask the user for the actual count or value if they guess incorrectly or encounter a false anchor (e.g., "What is the official length of a standard marathon in miles?").

Field Mapping Specifications:
1. 'industry_theme': A friendly, accessible theme title representing the specific general knowledge sector chosen.
2. 'anchor_statement': The literal "Yes/No" baseline statement text under 150 characters.
3. 'is_anchor_true': Boolean (true/false) indicating whether the initial 'anchor_statement' benchmark is factually accurate. Maintain a mix of true and false flags across the 3 questions.
4. 'the_real_question': The follow-up question string specifically asking for the exact parameter/measurement under 150 characters.
5. 'the_real_number': The absolute, precise, factually accurate raw numerical answer to 'the_real_question'.
6. Do not wrap the JSON output in markdown backticks or code blocks.

Expected JSON Structure:
{
  "industry_theme": "<A Broad, Accessible, and General Interest Theme>",
  "questions": [
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary under 150 chars>", "is_anchor_true": false, "the_real_question": "<Follow-up question requesting the actual target metric under 150 chars>", "the_real_number": 26.2, "unit": "miles", "difficulty_level": "Easy" },
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary under 150 chars>", "is_anchor_true": true, "the_real_question": "<Follow-up question requesting the actual target metric under 150 chars>", "the_real_number": 1997, "unit": "year", "difficulty_level": "Medium" },
    { "anchor_statement": "<Clear Yes/No question containing a numeric baseline boundary under 150 chars>", "is_anchor_true": false, "the_real_question": "<Follow-up question requesting the actual target metric under 150 chars>", "the_real_number": 120, "unit": "minutes", "difficulty_level": "Hard" }
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
    const validated = GutCheckSchema.parse(parsed);

    // Forces exact key serialization layout alignment prior to database entry
    const orderedPayload = JSON.parse(
      JSON.stringify(validated, strictJsonReplacerOrder),
    );

    // ==========================================
    // 3. TRANSACTION OVERWRITE SNAPSHOT LAYER
    // ==========================================
    // FIX: Match exact 24-hour block for structural table clearing, wrapped atomically
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
          topic: validated.industry_theme,
          content: orderedPayload,
          scheduled_for: todayStart,
        },
      }),
    ]);

    const finalOutput = JSON.stringify(validated, strictJsonReplacerOrder, 2);
    process.stdout.write(finalOutput);

    return validated;
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      // FIX: Reference .issues directly for type safety in ZodError instances
      process.stderr.write(JSON.stringify(err.issues, null, 2));
    } else if (err instanceof Error) {
      process.stderr.write(err.message + "\n");
    } else {
      process.stderr.write(String(err) + "\n");
    }
    throw err;
  }
};

// ==========================================
// 4. TERMINAL EXECUTION HOOK
// ==========================================
// const currentScript = process.argv[1];
// if (currentScript) {
//   const baseName = path.basename(currentScript);
//   const matchesName =
//     baseName === "generate_gut_check.js" ||
//     baseName === "generate_gut_check.ts" ||
//     baseName === "generate_gut_checks.js" ||
//     baseName === "generate_gut_checks.ts";

//   if (matchesName) {
//     // FIX: Synchronous argument processing using parseSync()
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
export type { GutCheckData };

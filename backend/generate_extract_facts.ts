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

const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);
const RESOLVED_OUTPUT_PATH = path.join(process.cwd(), 'extract_facts.json');

// ==========================================
// 1. DYNAMIC VALIDATION SCHEMA
// ==========================================
const ExtractFactsSchema = z.object({
  topic: z.string(),
  paragraph_a: z.string(),
  paragraph_b: z.string(),
  mcq_questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).length(4),
      correct_answer_index: z.preprocess(
        (val) => parseInt(val as string, 10),
        z.number().min(0).max(3)
      ),
    })
  ).length(3),
});

// ==========================================
// 2. EXCLUSIVE RUNTIME (STRICT TEMPLATE)
// ==========================================
export async function generate(customMode: string | null = null, forceRefresh: boolean = false) {
  const mode = "extract_facts";

  const argv: any = yargs(hideBin(process.argv)).argv;
  const shouldForce = forceRefresh || argv.forceRefresh === true || argv.forceRefresh === 'true' || argv.force === true;

  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const today = new Date(now.getTime() - offset).toISOString().split('T')[0];

  try {
    // NATURAL 24-HOUR DAILY LOCK CHECK
    if (!shouldForce) {
      const { data: existing } = await supabase
        .from("kalari_games")
        .select("content")
        .eq("mode", mode)
        .eq("scheduled_for", today)
        .maybeSingle();

      if (existing && existing.content && (existing.content as any).topic) {
        const finalOutput = JSON.stringify(existing.content, null, 2);
        fs.writeFileSync(RESOLVED_OUTPUT_PATH, finalOutput);
        process.stdout.write(finalOutput);
        return existing.content;
      }
    }

    // MEMORY LOOP LAYER: EXPANDED WINDOW FOR DIVERSITY
    let recentTopics: string[] = [];
    try {
      const { data: history } = await supabase
        .from("kalari_games")
        .select("topic")
        .order("scheduled_for", { ascending: false })
        .limit(20);
      
      if (history && history.length > 0) {
        recentTopics = history.map(h => h.topic).filter((t): t is string => Boolean(t));
      }
    } catch (histErr) {}

    const prompt = `Return ONLY a raw JSON object for 'Extract the Facts'.
Date: ${today}.
Entropy Factor: ${Math.random().toString(36).substring(7)}.

ANTI-REPETITION FILTER:
You must select a radically different topic than these recent entries: [${recentTopics.map(t => `'${t}'`).join(', ')}].
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
        generationConfig: { responseMimeType: "application/json", temperature: 1.0 },
      }),
    });

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("API returned empty candidates.");

    const parsed = JSON.parse(rawText);
    const validated = ExtractFactsSchema.parse(parsed);

    // TRANSACTION OVERWRITE SNAPSHOT LAYER
    await supabase
      .from("kalari_games")
      .delete()
      .eq("mode", mode)
      .eq("scheduled_for", today);

    await supabase.from("kalari_games").insert({
      mode,
      topic: validated.topic,
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
// 3. TERMINAL EXECUTION HOOK (STRICT TEMPLATE)
// ==========================================
const currentScript = process.argv[1];
if (currentScript) {
  const baseName = path.basename(currentScript);
  const matchesName = 
    baseName === "generate_extract_facts.js" || 
    baseName === "generate_extract_facts.ts";

  if (matchesName) {
    const argv: any = yargs(hideBin(process.argv)).argv;
    const force = argv.forceRefresh === true || argv.forceRefresh === 'true' || argv.force === true;
    const targetMode = argv.mode || (argv._ && argv._[0] ? argv._[0] : null);

    generate(targetMode, force);
  }
}

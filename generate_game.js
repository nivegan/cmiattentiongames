import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env.local');

// 1. ENV PARSER (With Trailing Slash Protection)
if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split(/\r?\n/).forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            let v = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
            if (key.trim().toUpperCase() === 'SUPABASE_URL' && v.endsWith('/')) v = v.slice(0, -1);
            process.env[key.trim().toUpperCase()] = v;
        }
    });
}

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. REVISED SCHEMAS (Gut Check = 3 Questions | Extract Facts = Bias Test)
const GutCheckSchema = z.object({
    industry_theme: z.string(),
    questions: z.array(z.object({
        anchor_statement: z.string(),
        the_real_number: z.number(),
        unit: z.string()
    })).length(3)
});

const ExtractFactsSchema = z.object({
    topic: z.string(),
    paragraph_a: z.string(), // Narrative 1
    paragraph_b: z.string(), // Narrative 2
    mcq_questions: z.array(z.object({
        question: z.string(),
        options: z.array(z.string()).length(4),
        correct_answer_index: z.number().min(0).max(3)
    })).length(3)
});

// 3. MAIN LOGIC
async function generate() {
    const argv = yargs(hideBin(process.argv)).argv;
    const mode = argv.mode;

    if (!mode || !['gut_check', 'extract_facts'].includes(mode)) {
        console.log("Usage: node generate_game.js --mode=gut_check");
        return;
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GOOGLE_GENERATIVE_AI_API_KEY}`;

    const prompts = {
        gut_check: `Generate 3 estimation questions for a niche academic topic. Return ONLY JSON: { "industry_theme": "string", "questions": [{"anchor_statement": "string", "the_real_number": number, "unit": "string"}] }`,
        extract_facts: `Generate a 'Separating Bias' scenario. Provide two short paragraphs on the same niche topic with opposing biased narratives. Provide 3 MCQs that test the ability to identify neutral facts vs spin. Return ONLY JSON: { "topic": "string", "paragraph_a": "string", "paragraph_b": "string", "mcq_questions": [{"question": "string", "options": ["","","",""], "correct_answer_index": 0}] }`
    };

    try {
        console.log(`--- Curating ${mode} Round ---`);
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompts[mode] }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const rawText = data.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(rawText);

        // Validation Firewall
        const schema = mode === 'gut_check' ? GutCheckSchema : ExtractFactsSchema;
        const validated = schema.parse(parsed);

        // Upload to Supabase
        const { error } = await supabase.from('kalari_games').insert([{
            mode: mode,
            topic: validated.topic || validated.industry_theme,
            content: validated 
        }]);

        if (error) throw error;

        // Output to local file
        fs.writeFileSync(path.join(__dirname, 'output.json'), JSON.stringify(validated, null, 2));

        // Print clean JSON for the demo
        console.log(JSON.stringify(validated, null, 2));
        console.log(`\n✅ Success! Round saved to output.json and Supabase.`);

    } catch (err) {
        if (err instanceof z.ZodError) {
            console.error("🛑 Schema Validation Failed. AI sent incorrect structure:");
            console.error(JSON.stringify(err.format(), null, 2));
        } else {
            console.error("🛑 Error:", err.message);
        }
    }
}

generate();
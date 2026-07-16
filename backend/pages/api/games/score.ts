import { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables matching your stack profile
dotenv.config({ path: ".env.local" });
const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("Missing required environment variables (SUPABASE_URL, SUPABASE_KEY, or GOOGLE_GENERATIVE_AI_API_KEY).");
}

// 1. FIXED: Added non-null assertion (!) to guarantee defined string types to the SDK clients
const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);
const ai = new GoogleGenAI({ apiKey: GOOGLE_GENERATIVE_AI_API_KEY! });

// =========================================================================
// 2. FIXED: Declared lightweight request/response types to avoid implicit 'any'
// =========================================================================
interface CustomRequest extends IncomingMessage {
  body?: any;
  method?: string;
}

interface CustomResponse extends ServerResponse {
  status: (statusCode: number) => CustomResponse;
  json: (body: any) => void;
}

export default async function handler(req: CustomRequest, res: CustomResponse) {
  // Ensure the endpoint only handles incoming POST data
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { scenarioId, takeaway, selectedFacts } = req.body || {};

    // Structural validation guardrail
    if (!scenarioId || !takeaway || !selectedFacts) {
      return res.status(400).json({ 
        error: "Missing required fields: scenarioId, takeaway, and selectedFacts are all required." 
      });
    }

    // 1. Fetch ground-truth scenario content directly from kalari_games table
    const { data: gameRow, error: dbError } = await supabase
      .from("kalari_games")
      .select("content")
      .eq("game_type_id", "EXTRACT_THE_FACTS")
      .eq("id", scenarioId)
      .single();

    if (dbError || !gameRow) {
      return res.status(404).json({ 
        error: "Target scenario content not found in kalari_games table.", 
        details: dbError?.message 
      });
    }

    const groundTruthContent = gameRow.content;

    // 2. Construct the grading prompt matching your exact scoring rubric
    const prompt = `
      You are an objective grading script designed to evaluate a player's performance in the 'Extract the Facts' game mode.
      Your task is to mathematically score their submission against the ground-truth content schema.

      ---
      INPUT CHANNELS:
      - Ground-Truth Content: ${JSON.stringify(groundTruthContent)}
      - Player's Selected Facts (Array of Strings): ${JSON.stringify(selectedFacts)}
      - Player's Written Takeaway: "${takeaway}"

      ---
      SCORING MATRIX RULES (Max Possible: 100 | Min Possible: 0):
      1. Neutral Facts Accuracy (Up to 45 Points): Evaluate how accurately the player's selected facts match the neutral ground-truth facts.
      2. Substantive Takeaway Depth (Up to 55 Points): Evaluate the analytical depth and objective comprehensiveness of the written takeaway.
      3. Strict Emotional Modifier Penalty: Achieving a perfect 100 requires absolute objectivity with zero emotional or biased modifiers. 
         - Scan both the selected facts and the takeaway text for loaded adjectives or adverbs (e.g., 'disastrous', 'wonderful', 'alarming', 'manipulative').
         - Deduct exactly 10 points for every single loaded/biased word identified.

      ---
      OUTPUT REGULATION:
      Return your response strictly as a JSON object matching this exact structure:
      {
        "takeawayDepthScore": <calculated integer between 0 and 100>
      }
    `;

    // 3. Generate content using the exact SDK-supported model string
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.0, // Hard determinism for standardized scoring
        seed: 42
      },
    });

    // 4. FIXED: Narrow textResponse type and throw explicit error if it's undefined
    const textResponse = response.text;
    if (!textResponse) {
      throw new Error("AI Engine returned an undefined or empty response body.");
    }

    const evaluationResult = JSON.parse(textResponse.trim());

    // 5. Return the exact designated structure back to the client
    return res.status(200).json(evaluationResult);

  } catch (error: unknown) {
    // 5. FIXED: Guard and cast the 'unknown' error parameter cleanly
    console.error("Error in scoring engine:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "Internal Server Error", message: errorMsg });
  }
}

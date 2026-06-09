import type { NextApiRequest, NextApiResponse } from "next";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

// Consistent environment setup matching your project layout
dotenv.config({ path: ".env.local" });
const { GOOGLE_GENERATIVE_AI_API_KEY } = process.env;

// Initialize client exactly using your configuration style
const ai = new GoogleGenAI({ apiKey: GOOGLE_GENERATIVE_AI_API_KEY });

// Define interfaces for type safety on incoming and outgoing payloads
interface ScoringRequestBody {
  scenarioId?: string;
  correctAnswers: Record<string, any> | string;
  userAnswers: string;
}

interface ScoringSuccessResponse {
  takeawayDepthScore: number;
  explanation: string;
}

interface ScoringErrorResponse {
  error: string;
  message?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ScoringSuccessResponse | ScoringErrorResponse>
) {
  // Ensure the endpoint only handles incoming POST data
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Cast the request body to our expected type structure
    const { scenarioId, correctAnswers, userAnswers } = req.body as ScoringRequestBody;

    // Structural validation guardrail
    if (!correctAnswers || !userAnswers) {
      return res.status(400).json({ error: "Missing required fields: correctAnswers and userAnswers are required." });
    }

    // Construct the grading prompt
    const prompt = `
       You are an objective grading script designed to evaluate the depth of a user's takeaway from a given scenario. Your task is to cross-reference the user's remembered narrative paragraph against the ground-truth factual schema and judge how accurately the user retained the facts.
      
      Task: Cross-reference the user's remembered narrative paragraph against the ground-truth factual schema. Judge how accurately the user retained the facts.
      
      Scenario ID: ${scenarioId || "Default"}
      Target Reference Answers (Ground Truth): ${JSON.stringify(correctAnswers)}
      Player's Provided Response: "${userAnswers}"
      
      Analyze the player's response against the target reference answers. 
      Calculate a 'takeawayDepthScore' from 0 to 100 based on how accurately and deeply they captured the core facts.
      Provide a brief, clear explanation for the score assigned.
      
      Return your final response strictly as a JSON object with this exact structure:
      {
        "takeawayDepthScore": <number between 0 and 100>
        
      }
    `;

    // Generate content using the exact SDK-supported model string
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        // Force the model to output a verified, machine-readable JSON format
        responseMimeType: "application/json",
        // Force deterministic, predictable output across multiple evaluations
        temperature: 0.0,
        seed: 42
      },
    });

    // Ensure we safely have text contents back from the SDK
    if (!response.text) {
      throw new Error("No evaluation text returned from the Gemini engine.");
    }

    // Parse the validated JSON payload out of the model's text response
    const evaluationResult = JSON.parse(response.text) as ScoringSuccessResponse;

    // Return the typed evaluation metrics back to the client
    return res.status(200).json(evaluationResult);

  } catch (error: any) {
    console.error("Error in scoring engine:", error);
    return res.status(500).json({ 
      error: "Internal Server Error", 
      message: error instanceof Error ? error.message : String(error) 
    });
  }
}

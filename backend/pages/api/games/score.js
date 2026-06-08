import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // userAnswers here is the short paragraph the user typed out based on their memory
  const { scenarioId, userAnswers, correctAnswers } = req.body;

  if (!userAnswers) {
    return res
      .status(400)
      .json({ error: "User narrative paragraph is required." });
  }

  try {
    const prompt = `
      You are an objective grading script designed to evaluate the depth of a user's takeaway from a given scenario. Your task is to cross-reference the user's remembered narrative paragraph against the ground-truth factual schema and judge how accurately the user retained the facts.
      
      Task: Cross-reference the user's remembered narrative paragraph against the ground-truth factual schema. Judge how accurately the user retained the facts.
      
      Factual Schema (Ground Truth):
      ${JSON.stringify(correctAnswers)}
      
      User's Remembered Narrative Paragraph:
      "${userAnswers}"
      
      Scoring Metric:
      - Assign a "Takeaway Depth Score" from 0 to 100 based strictly on factual alignment and precision.
      
      Respond strictly in this JSON format:
      {
        "takeawayDepthScore": <number between 0 and 100>
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const scoringResult = JSON.parse(response.text);
    return res.status(200).json(scoringResult);
  } catch (error) {
    console.error("Scoring Pipeline Error:", error);
    return res.status(500).json({ error: "Failed to evaluate depth score." });
  }
}

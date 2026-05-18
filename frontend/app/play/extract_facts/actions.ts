"use server";

import { ExtractFactsGame, generate } from "@/utils/generate_game";

const fetchServerGameData = async (): Promise<ExtractFactsGame | null> => {
  try {
    const result = await generate("extract_facts");
    return result as ExtractFactsGame;
  } catch (error) {
    console.error("Error generating game:", error);
    return null;
  }
};

export { fetchServerGameData };

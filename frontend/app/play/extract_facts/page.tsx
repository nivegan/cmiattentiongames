import { ExtractFactsGame, generate } from "@/utils/generate_game";

const getGameData = async (): Promise<ExtractFactsGame | null> => {
  try {
    const result = await generate("extract_facts");
    return result as ExtractFactsGame;
  } catch (error) {
    console.error("Error generating game:", error);
    return null;
  }
};

const ExtractFacts = async () => {
  const gameData = await getGameData();
  console.log(gameData);
  return <div>ExtractFacts</div>;
};

export default ExtractFacts;

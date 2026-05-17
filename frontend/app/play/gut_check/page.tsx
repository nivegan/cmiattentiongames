import { generate, GutCheckGame } from "@/utils/generate_game";

const getGameData = async (): Promise<GutCheckGame | null> => {
  try {
    const result = await generate("gut_check");
    return result as GutCheckGame;
  } catch (error) {
    console.error("Error generating game:", error);
    return null;
  }
};

const GutCheck = async () => {
  const gameData = await getGameData();
  console.log(gameData);
  return <div>GutCheck</div>;
};

export default GutCheck;

import { generate } from "@/utils/generate_game";

const testGenerate = async () => {
  try {
    const result = await generate("gut_check");
    console.log("Generated Game Result:", result);
  } catch (error) {
    console.error("Error generating game:", error);
  }
};

const HistoryPage = () => {
  testGenerate();
  return <div>HistoryPage</div>;
};

export default HistoryPage;

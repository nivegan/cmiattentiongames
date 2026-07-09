"use server";
// extract_facts/actions.ts
// Server action for the Extract Facts game page. Identical structure to
// gut_check/actions.ts — see that file for a detailed explanation.
//
// This one checks the "EXTRACT_THE_FACTS" daily lock and fetches AI-generated
// paragraph + MCQ content via generate() from utils/generate_extract_facts.ts.

import { generate } from "@/utils/generate_extract_facts";
import type { ExtractFactsData } from "@/utils/generate_extract_facts";
import { auth } from "@clerk/nextjs/server";
import { checkHasPlayedToday } from "@/utils/checkHasPlayedToday";

// First of two daily-lock checkpoints — prevents serving game content to a user
// who already completed this mode today. Mirrors the pattern in gut_check/actions.ts.
const fetchServerGameData = async (
  deviceId: string,
): Promise<{
  success: boolean;
  data: ExtractFactsData | null;
  error?: "ALREADY_PLAYED" | "UNKNOWN";
}> => {
  try {
    const { userId } = await auth();
    const targetIdentifier = userId || deviceId;

    if (targetIdentifier) {
      const played = await checkHasPlayedToday(
        targetIdentifier,
        "EXTRACT_THE_FACTS",
      );
      if (played) {
        return { success: false, data: null, error: "ALREADY_PLAYED" };
      }
    }

    const result = await generate();
    return { success: true, data: result };
  } catch (error) {
    console.error("Error generating extract facts game data payload:", error);
    return { success: false, data: null, error: "UNKNOWN" };
  }
};

export { fetchServerGameData };

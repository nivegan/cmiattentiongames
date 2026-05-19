"use server";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { GutCheckGame, generate } from "@/utils/generate_game";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
dotenv.config();

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const fetchServerGameData = async (): Promise<GutCheckGame | null> => {
  try {
    const result = await generate("gut_check");
    return result as GutCheckGame;
  } catch (error) {
    console.error("Error generating gut check game metadata payload:", error);
    return null;
  }
};

const saveUserGameStats = async (
  score: number,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const rowId = globalThis.crypto.randomUUID();
    const mockUserId = globalThis.crypto.randomUUID();

    await prisma.user_stats.create({
      data: {
        id: rowId,
        user_id: mockUserId,
        game_type_id: "GUT_CHECK",
        difficulty_band: 1.0,
        score: score,
        is_success: true,
        reaction_time_ms: null,
        metadata: { source: "web_gut_check_v1" },
      },
    });

    return { success: true };
  } catch (error) {
    console.error(
      "Database Transaction Error in saveUserGameStats Gut Check Action:",
      error,
    );
    const errorMessage =
      error instanceof Error ? error.message : "Unknown write failure";
    return { success: false, error: errorMessage };
  } finally {
    await prisma.$disconnect();
  }
};

export { fetchServerGameData, saveUserGameStats };

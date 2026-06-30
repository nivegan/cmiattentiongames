"use server";
// saveUserFeedback.ts
// Server action for writing a feedback submission to the `user_feedback` table.
//
// "use server" means this runs on the server only; the browser invokes it as a
// normal async function (Next.js turns the call into an HTTP POST).
//
// Mirrors saveUserGameStat / logFunnelEvent:
//   1. Identify the user (Clerk userId, else anonymous device UUID)
//   2. Convert the identifier to a DB-safe UUID
//   3. Write one row to user_feedback
// Unlike game scores there is NO daily lock — feedback can be submitted any number
// of times.

import { auth } from "@clerk/nextjs/server";
import { safeFormatToUuid } from "@/utils/safeFormatToUuid";
import { prisma } from "@/utils/prismaInit";

const saveUserFeedback = async (
  nps: number, // 1–10 "how likely to recommend"
  improvement: number, // 1–10 combined logic/clarity/awareness rating
  comments: string, // free-text; "" if the user left it blank
  deviceId: string, // anonymous localStorage UUID; "" if the user is signed in
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { userId } = await auth();
    // Prefer the Clerk ID; fall back to the anonymous device UUID.
    const identifier = userId || deviceId;
    if (!identifier) return { success: false, error: "UNKNOWN" };

    const dbSafeUuid = safeFormatToUuid(identifier);
    const rowId = globalThis.crypto.randomUUID();

    await prisma.user_feedback.create({
      data: {
        id: rowId,
        user_id: dbSafeUuid,
        nps_score: nps,
        improvement_score: improvement,
        // Store null rather than an empty string when no comment was given
        // (the column is nullable).
        comments: comments.trim() || null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Database error saving feedback:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown write failure";
    return { success: false, error: errorMessage };
  }
};

export { saveUserFeedback };

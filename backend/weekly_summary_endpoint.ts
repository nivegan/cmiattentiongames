import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// ==========================================
// 1. ENVIRONMENT CONFIGURATION & VALIDATION
// ==========================================
dotenv.config({ path: ".env.local" });

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_GENERATIVE_AI_API_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("Missing required environment variables in .env.local");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 2. PERFORMANCE MATRIX CONFIGURATION
// ==========================================
const ALL_SIX_GAMES = [
  { id: "extract_facts", name: "extract facts", max: 3 },
  { id: "mental_reflex", name: "mental reflex", max: 3 },
  { id: "gut_check", name: "gut check", max: 2 },
  { id: "steady_gaze", name: "steady gaze", max: 2 },
  { id: "read_designs", name: "read designs", max: 2 },
  { id: "clear_air", name: "clear air", max: 2 }
];

interface UserStatRow {
  user_id: string;
  game_type_id: string;
  score: number;
  is_success: boolean;
  reaction_time_ms: number;
}

// ==========================================
// 3. CORE PROCESSING LOGIC
// ==========================================
async function generateWeeklySummaries() {
  try {
    console.log("⚡ Starting weekly performance table generation...");

    // Calculate window: Last Sunday 00:00:00 to yesterday Saturday 23:59:59
    const now = new Date();
    const currentDayIndex = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    const startSunday = new Date(now);
    const daysToSubtract = currentDayIndex === 0 ? 7 : currentDayIndex; 
    startSunday.setDate(now.getDate() - daysToSubtract);
    startSunday.setHours(0, 0, 0, 0);

    const endSaturday = new Date(startSunday);
    endSaturday.setDate(startSunday.getDate() + 6);
    endSaturday.setHours(23, 59, 59, 999);

    const weekStartISO = startSunday.toISOString();
    const weekEndISO = endSaturday.toISOString();
    const weekStartKey = weekStartISO.split("T")[0];

    console.log(`Date Window: [Sunday ${weekStartKey}] -> [Saturday ${weekEndISO.split("T")[0]}]`);

    // Fetch all unique user IDs to catch 0-game profiles
    const { data: userRows, error: userError } = await supabase
      .from("user_stats")
      .select("user_id");
      
    if (userError) throw userError;
    const allUniqueUsers = Array.from(new Set((userRows || []).map(r => r.user_id)));

    if (allUniqueUsers.length === 0) {
      console.log(" No entries in user_stats to aggregate.");
      return;
    }

    // Fetch target window performance logs
    const { data: records, error: fetchError } = await supabase
      .from("user_stats")
      .select("user_id, game_type_id, score, is_success, reaction_time_ms")
      .gte("created_at", weekStartISO)
      .lte("created_at", weekEndISO);

    if (fetchError) throw fetchError;
    const safeRecords = (records || []) as UserStatRow[];

    // Iterate through profiles to calculate and compile the JSON payloads
    for (const userId of allUniqueUsers) {
      const userRecords = safeRecords.filter(r => r.user_id === userId);
      const totalGamesPlayedCount = userRecords.length;

      const statsMap: Record<string, { played: number; wins: number; totalScore: number }> = {};
      ALL_SIX_GAMES.forEach(g => {
        statsMap[g.id] = { played: 0, wins: 0, totalScore: 0 };
      });

      let totalReactionTime = 0;
      let totalWins = 0;

      userRecords.forEach(row => {
        totalReactionTime += row.reaction_time_ms || 0;
        if (row.is_success) totalWins++;
        
        if (statsMap[row.game_type_id]) {
          statsMap[row.game_type_id].played++;
          statsMap[row.game_type_id].totalScore += row.score || 0;
          if (row.is_success) statsMap[row.game_type_id].wins++;
        }
      });

      // Format total games text ratio metrics block
      const total_games_played = ALL_SIX_GAMES
        .map(g => `${g.name} : ${statsMap[g.id].played}/${g.max} times`)
        .join(", ");

      // Calculate best game mode using peak average score
      let bestGameMode: string | null = null;
      let maxAverageScore = -1;

      ALL_SIX_GAMES.forEach(g => {
        const stats = statsMap[g.id];
        if (stats.played > 0) {
          const avg = stats.totalScore / stats.played;
          if (avg > maxAverageScore) {
            maxAverageScore = avg;
            bestGameMode = g.id;
          }
        }
      });

      const globalAvgTimeMs = totalGamesPlayedCount > 0 ? totalReactionTime / totalGamesPlayedCount : 0;
      const average_completion_time = `${(globalAvgTimeMs / 1000).toFixed(1)}s`;
      const generalSuccessRate = totalGamesPlayedCount > 0 ? (totalWins / totalGamesPlayedCount) * 100 : 0;

      // ==========================================
      // WITTY PERFORMANCE COPY MATRICES
      // ==========================================
      let summary_copy = "";
      
      if (totalGamesPlayedCount < 5) {
        // Band 1: Low engagement fallback threshold
        summary_copy = "We missed you this week, you’ll only know if you try";
      } 
      else if (totalGamesPlayedCount >= 10 && generalSuccessRate >= 80) {
        // Band 2: Max volume + High accuracy
        summary_copy = "excelent work, keep going consistency is key";
      } 
      else if (totalGamesPlayedCount >= 10 && generalSuccessRate < 50) {
        // Band 3: High volume + Low accuracy chaos runner
        summary_copy = "You ran through the arena like a loose live wire this week. High energy, pure chaos. Let's trade some of that frantic speed for actual accuracy next run.";
      } 
      else if (totalGamesPlayedCount >= 5 && totalGamesPlayedCount <= 10 && generalSuccessRate >= 75) {
        // Band 4: Mid volume + High accuracy
        summary_copy = "keep pushing, just a little more, your mental abs are almost visible";
      } 
      else if (totalGamesPlayedCount > 8) {
        // Band 5: Granular game breakdowns for high activity nodes (> 8 games played)
        if (statsMap["gut_check"].played >= 2) {
          summary_copy = "Leaned hard into Gut Check runs this week, huh? Intuition is solid, but make sure your logic loop isn't just taking wild calculated guesses.";
        } else if (statsMap["mental_reflex"].played >= 3) {
          summary_copy = "Absolute reflex engine champion this week. You're reacting at lightning speeds, just remember to let your analytical focus keep up.";
        } else if (statsMap["extract_facts"].played >= 3) {
          summary_copy = "You spent a lot of time extracting facts this week. Your data mining skills are clean, now let's scale up that evaluation pacing.";
        } else {
          summary_copy = "Solid execution metrics and healthy volume across the board. Your diagnostic radar is getting a serious workout.";
        }
      } 
      else if (generalSuccessRate < 50) {
        // Band 6: Low accuracy fallback safety loop
        summary_copy = "Dont loose heart, keep training, we're rooting for you";
      } 
      else {
        // Fallback default balancing node line
        summary_copy = "Consistent and balanced progression. Keep tuning your core cognitive instincts across your upcoming daily runs.";
      }

      const payload = {
        total_games_played,
        best_game: {
          game_type_id: bestGameMode,
          highest_score: maxAverageScore === -1 ? 0 : Math.round(maxAverageScore)
        },
        average_completion_time,
        summary_copy
      };

      // Write the complete compiled payload directly into the single table layout
      const { error: upsertError } = await supabase
        .from("weekly_summaries")
        .upsert({
          user_id: userId,
          week_start_date: weekStartKey,
          payload: payload
        });

      if (upsertError) {
        console.error(` Database write failed for user ${userId}:`, upsertError.message);
      } else {
        console.log(` Stored summary payload for user: ${userId}`);
      }
    }

    console.log("\n Generation processing finished successfully.");

  } catch (err: any) {
    console.error("Execution breakdown error:", err.message);
  }
}

generateWeeklySummaries();

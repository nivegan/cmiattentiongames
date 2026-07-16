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
  { id: "EXTRACT_THE_FACTS", name: "Extract the Facts", max: 3 },
  { id: "MENTAL_REFLEX", name: "Mental Reflex", max: 3 },
  { id: "GUT_CHECK", name: "Gut Check", max: 2 },
  { id: "STEADY_GAZE", name: "Steady Gaze", max: 2 },
  { id: "READ_BETWEEN_DESIGNS", name: "Read Between the Designs", max: 2 },
  { id: "CLEAR_THE_AIR", name: "Clear the Air", max: 2 }
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

    // Calculate window: Previous week's Monday 00:00:00 to Sunday 23:59:59
    const now = new Date();
    const currentDayIndex = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Determine days elapsed since this current week's Monday
    const daysSinceMonday = currentDayIndex === 0 ? 6 : currentDayIndex - 1;
    
    // Go back to the Monday of the previous week (days elapsed this week + 7 full days)
    const startMonday = new Date(now);
    startMonday.setDate(now.getDate() - (daysSinceMonday + 7));
    startMonday.setHours(0, 0, 0, 0);

    // End on the Sunday of that week (+6 days from that Monday)
    const endSunday = new Date(startMonday);
    endSunday.setDate(startMonday.getDate() + 6);
    endSunday.setHours(23, 59, 59, 999);

    const weekStartISO = startMonday.toISOString();
    const weekEndISO = endSunday.toISOString();
    const weekStartKey = weekStartISO.split("T")[0];

    console.log(`Date Window: [Monday ${weekStartKey}] -> [Sunday ${weekEndISO.split("T")[0]}]`);

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

      const statsMap: Record<string, { played: number; totalScore: number }> = {};
      ALL_SIX_GAMES.forEach(g => {
        statsMap[g.id] = { played: 0, totalScore: 0 };
      });

      let totalReactionTime = 0;
      let grandTotalScore = 0;

      userRecords.forEach(row => {
        const scoreVal = Number(row.score) || 0; 
        totalReactionTime += row.reaction_time_ms || 0;
        grandTotalScore += scoreVal;
        
        if (statsMap[row.game_type_id]) {
          statsMap[row.game_type_id].played++;
          statsMap[row.game_type_id].totalScore += scoreVal;
        }
      });

      // Format total games text ratio metrics block
      const total_games_played = ALL_SIX_GAMES
        .map(g => `${g.name} : ${statsMap[g.id].played}/${g.max} times`)
        .join(", ");

      // -----------------------------------------------------------------------
      // CALIBRATED COGNITIVE METRIC SELECTION ENGINE (Score / (100 * Played))
      // -----------------------------------------------------------------------
      const playedGamesStats = ALL_SIX_GAMES.map(g => {
        const stats = statsMap[g.id];
        return {
          id: g.id,
          played: stats.played,
          avgScore: stats.played > 0 ? stats.totalScore / (100 * stats.played) : 0
        };
      }).filter(g => g.played > 0);

      let bestGameMode: string | null = null;
      let highestAvgScore = 0;

      if (playedGamesStats.length > 0) {
        playedGamesStats.sort((a, b) => b.avgScore - a.avgScore);
        bestGameMode = playedGamesStats[0].id;
        highestAvgScore = playedGamesStats[0].avgScore;
      }

      const globalAvgTimeMs = totalGamesPlayedCount > 0 ? totalReactionTime / totalGamesPlayedCount : 0;
      const average_completion_time = `${(globalAvgTimeMs / 1000).toFixed(1)}s`;
      
      // Global average score normalization using the updated formula rule
      const averageScore = totalGamesPlayedCount > 0 ? grandTotalScore / (100 * totalGamesPlayedCount) : 0;

      // Helper mapping to check specific standalone game average scores using the updated formula
      const getGameAvg = (id: string) => statsMap[id].played > 0 ? statsMap[id].totalScore / (100 * statsMap[id].played) : 0;

      // Identify if exactly one game type remains untouched (The Blind Spot Check)
      const unplayedGames = ALL_SIX_GAMES.filter(g => statsMap[g.id].played === 0);
      const playedCount = ALL_SIX_GAMES.length - unplayedGames.length;

      // ==========================================
      // ADVANCED WITTY PERFORMANCE COPY MATRICES
      // ==========================================
      let summary_copy = "";
      
      if (totalGamesPlayedCount < 5) {
        summary_copy = "We missed you this week, the arena is waiting, let's get back to the grind next week!";
      }
      else if (playedCount === 5 && unplayedGames.length === 1) {
        const missedGame = unplayedGames[0];
        summary_copy = `You almost cleared the entire radar board this week, but completely left out **${missedGame.name}**. Don't let it sit in your blind spot next week!`;
      }
      else if (getGameAvg("MENTAL_REFLEX") >= 75 && (getGameAvg("GUT_CHECK") < 55 || getGameAvg("EXTRACT_THE_FACTS") < 55 || getGameAvg("READ_BETWEEN_DESIGNS") < 55)) {
        const lowGames: string[] = [];
        if (statsMap["GUT_CHECK"].played > 0 && getGameAvg("GUT_CHECK") < 55) lowGames.push("Gut Check");
        if (statsMap["EXTRACT_THE_FACTS"].played > 0 && getGameAvg("EXTRACT_THE_FACTS") < 55) lowGames.push("Extract the Facts");
        if (statsMap["READ_BETWEEN_DESIGNS"].played > 0 && getGameAvg("READ_BETWEEN_DESIGNS") < 55) lowGames.push("Read Between the Designs");
        
        const laggingModules = lowGames.length > 0 ? lowGames.join(" and ") : "analytical accuracy";
        summary_copy = `Your rapid-fire processing in **Mental Reflex** is lightning fast, but your raw score in **${laggingModules}** tells us you're moving faster than your logic loops can verify. Let's trade raw speed for calibrated accuracy next week.`;
      }
      else if (totalGamesPlayedCount >= 10 && averageScore >= 80) {
        summary_copy = "excelent work, keep going consistency is key";
      } 
      else if (totalGamesPlayedCount >= 10 && averageScore < 50) {
        summary_copy = "You ran through the arena like a loose live wire this week. High energy, pure chaos. Let's trade some of that frantic speed for actual accuracy next run.";
      } 
      else if (totalGamesPlayedCount >= 5 && totalGamesPlayedCount <= 10 && averageScore >= 75) {
        summary_copy = "keep pushing, just a little more, your mental abs are almost visible";
      } 
      else if (totalGamesPlayedCount > 8) {
        if (statsMap["GUT_CHECK"].played >= 2) {
          summary_copy = "Leaned hard into Gut Check runs this week, huh? Intuition is solid, but make sure your logic loop isn't just taking wild calculated guesses.";
        } else if (statsMap["MENTAL_REFLEX"].played >= 3) {
          summary_copy = "Absolute reflex engine champion this week. You're reacting at lightning speeds, just remember to let your analytical focus keep up.";
        } else if (statsMap["EXTRACT_THE_FACTS"].played >= 3) {
          summary_copy = "You spent a lot of time extracting facts this week. Your data mining skills are clean, now let's scale up that evaluation pacing.";
        } else {
          summary_copy = "Solid execution metrics and healthy volume across the board. Your diagnostic radar is getting a serious workout.";
        }
      } 
      else if (averageScore < 50) {
        summary_copy = "Dont loose heart, keep training, we're rooting for you";
      } 
      else {
        summary_copy = "Consistent and balanced progression. Keep tuning your core cognitive instincts across your upcoming daily runs.";
      }

      const payload = {
        total_games_played,
        best_game: {
          game_type_id: bestGameMode,
          highest_score: Math.round(highestAvgScore)
        },
        average_completion_time,
        summary_copy
      };

      // Write the complete compiled payload directly into the weekly_summaries table
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

export interface DailyCopy {
  dayName: string;
  game1: string;
  game2: string;
  copy: string;
}

export const DAILY_COPIES: Record<number, DailyCopy> = {
  0: {
    dayName: "Sunday",
    game1: "GUT_CHECK",
    game2: "DARK_DESIGN",
    copy: "Sunday Checklist: Coffee in hand, gut feelings engaged, and dark patterns unmasked. Let’s outsmart the designers before the Sunday Scaries set in!"
  },
  1: {
    dayName: "Monday",
    game1: "EXTRACT_THE_FACTS",
    game2: "GUT_CHECK",
    copy: "Monday Reality Check: Dust off your critical thinking. Time to filter out the noise, extract pure facts, and see if your intuition holds up after the weekend!"
  },
  2: {
    dayName: "Tuesday",
    game1: "DARK_DESIGN",
    game2: "EXTRACT_THE_FACTS",
    copy: "Tuesdays are for spotted traps: Uncover subtle manipulation in Dark Design and separate cold, hard facts from clever fiction."
  },
  3: {
    dayName: "Wednesday",
    game1: "DARK_DESIGN",
    game2: "CLEAR_THE_AIR",
    copy: "Over the midweek hump! Defuse shady UI tactics in Dark Design, then sweep away confusion with a crisp round of Clear the Air."
  },
  4: {
    dayName: "Thursday",
    game1: "GUT_CHECK",
    game2: "DARK_DESIGN",
    copy: "Almost Friday! Put your instincts to the ultimate test in Gut Check and spot hidden traps before they trick you."
  },
  5: {
    dayName: "Friday",
    game1: "EXTRACT_THE_FACTS",
    game2: "CLEAR_THE_AIR",
    copy: "Friday Finale: Clear the air on hot takes, grab the essential facts, and wrap up the week with a clean score sheet!"
  },
  6: {
    dayName: "Saturday",
    game1: "CLEAR_THE_AIR",
    game2: "GUT_CHECK",
    copy: "Weekend Warmup: No corporate buzzwords or tricky interfaces allowed—just quick gut checks and crystal-clear facts to kick off your weekend!"
  }
};

/**
 * Returns the copy configuration for the current date or a specific target date.
 */
export function getDailyCopy(targetDate?: Date): DailyCopy {
  const date = targetDate || new Date();
  const dayIndex = date.getDay(); // 0 (Sun) - 6 (Sat)
  return DAILY_COPIES[dayIndex];
}

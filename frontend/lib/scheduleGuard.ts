// scheduleGuard.ts
// Server-side guard that keeps /play/* routes locked to the games scheduled for
// the current IST weekday (data/dailySchedule.json — the same source the home
// grid reads). Without it, typing the URL of an unscheduled game plays it and
// bypasses the daily rotation.
//
// Only enforced in production: `npm run dev` opens every game regardless of the
// day so development and testing aren't blocked by the calendar.
//
// Used by the layout.tsx in each app/play/<game>/ folder. Deliberately NOT a
// "use server" file — those may export only async server actions.

import scheduleData from "@/data/dailySchedule.json";
import { connection } from "next/server";
import { redirect } from "next/navigation";

const schedule = scheduleData.schedule as Record<string, string[]>;

// Today's IST weekday as a lowercase schedule key ("wednesday"). Same Intl
// pattern as components/HomeGrid.tsx and
// app/history/actions.ts::scheduledCountForDateKey.
const istWeekdayKey = (): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  })
    .format(new Date())
    .toLowerCase();

// True when `slug` (a data/dailySchedule.json / GAME_CATALOG key, e.g.
// "clear_air" — note slugs differ from routes) is on today's IST lineup.
const isScheduledToday = (slug: string): boolean =>
  (schedule[istWeekdayKey()] ?? []).includes(slug);

// Redirects home when the game isn't scheduled today. Call it at the top of a
// game route's layout.
const assertScheduledToday = async (slug: string): Promise<void> => {
  // These routes render client components with no request-time APIs, so Next
  // would prerender them at build time and bake in the build day's schedule
  // forever. connection() forces a runtime render — the documented fix when the
  // only dynamic input is new Date().
  await connection();
  if (process.env.NODE_ENV !== "production") return;
  // redirect() works by throwing NEXT_REDIRECT — never wrap it in try/catch.
  if (!isScheduledToday(slug)) redirect("/");
};

export { isScheduledToday, assertScheduledToday };

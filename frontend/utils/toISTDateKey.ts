// utils/toISTDateKey.ts
// Converts a Date to an IST calendar date string like "2026-06-05".
// The platform's "day" is IST (Asia/Kolkata) — use this whenever timestamps
// need to be bucketed into calendar days (history streaks, admin daily log).
// "en-CA" formats as YYYY-MM-DD, which sorts lexicographically by date.

const toISTDateKey = (date: Date): string => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", // convert to IST before extracting the date
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

export { toISTDateKey };

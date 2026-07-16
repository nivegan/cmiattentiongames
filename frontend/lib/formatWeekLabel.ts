// lib/formatWeekLabel.ts
// Display-only formatting of a weekly-review span, e.g. "5th Jul – 11th Jul '26".
// Shared by the WeeklyReviewModal (retro) and the History weekly cards (serif) —
// styling is the caller's concern, this only produces the text.

// 1st / 2nd / 3rd / 4th …, with the 11–13 teens all taking "th".
const ordinal = (n: number): string => {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

// Keys are IST calendar dates ("YYYY-MM-DD"); parse at local midnight so the
// calendar fields read back unchanged (same trick as history's formatDay).
const partsOf = (key: string): { day: string; month: string; year: number } => {
  const d = new Date(`${key}T00:00:00`);
  return {
    day: ordinal(d.getDate()),
    month: d.toLocaleDateString("en-US", { month: "short" }),
    year: d.getFullYear(),
  };
};

const formatWeekLabel = (weekStartKey: string, weekEndKey: string): string => {
  const start = partsOf(weekStartKey);
  const end = partsOf(weekEndKey);
  const yearSuffix = `'${String(end.year).slice(-2)}`;
  return `${start.day} ${start.month} – ${end.day} ${end.month} ${yearSuffix}`;
};

export { formatWeekLabel };

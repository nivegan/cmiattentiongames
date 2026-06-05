// getCurrentDayRange.ts
// Returns the UTC timestamps that bracket the *current IST calendar day*.
//
// WHY IST (India Standard Time)?
// The platform is India-facing. Users expect the day to reset at midnight in
// India (IST, UTC+5:30) — not at UTC midnight, which would be 5:30 AM in India.
//
// WHY UTC TIMESTAMPS IN THE DB?
// Postgres stores all timestamps in UTC internally. We compute the IST day
// boundaries and then let JavaScript auto-convert them to UTC via the +05:30
// offset in the ISO string. The DB receives UTC but we queried using IST logic.
//
// All "has played today?" queries in checkHasPlayedToday.ts use this range.

const getCurrentDayRange = () => {
  const now = new Date(); // current moment in time (JavaScript always uses UTC internally)

  // Intl.DateTimeFormat is the built-in locale-aware date formatter.
  // "en-CA" (Canada) formats dates as YYYY-MM-DD, which is easy to destructure
  // without string-splitting tricks.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", // interpret the current moment in IST
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // formatToParts returns an array like:
  //   [ {type:"year",value:"2026"}, {type:"literal",value:"-"},
  //     {type:"month",value:"06"}, {type:"literal",value:"-"},
  //     {type:"day",value:"05"} ]
  // We use comma elisions to skip the separator literals (odd-indexed elements)
  // and pull out only the year, month, and day value strings.
  const [{ value: year }, , { value: month }, , { value: day }] =
    formatter.formatToParts(now);

  // By appending "+05:30" we declare this as IST. JavaScript automatically
  // converts it to UTC when constructing the Date object — no manual arithmetic.
  const start = new Date(`${year}-${month}-${day}T00:00:00+05:30`); // IST midnight
  const end = new Date(`${year}-${month}-${day}T23:59:59.999+05:30`); // IST end-of-day

  return { start, end };
};

export { getCurrentDayRange };

// Returns the UTC timestamps that bracket the current IST calendar day.
// All "has played today?" queries use this range so the day boundary is always
// IST midnight regardless of where the server is running.
const getCurrentDayRange = () => {
  const now = new Date();

  // en-CA gives YYYY-MM-DD parts which are easy to destructure
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // formatToParts returns [{type,value}, literal, {type,value}, ...]; we skip
  // the separator literals (odd-indexed elements) with the comma elisions below.
  const [{ value: year }, , { value: month }, , { value: day }] =
    formatter.formatToParts(now);

  // Constructing with an explicit +05:30 offset lets JavaScript convert to UTC
  // automatically rather than us having to subtract 5.5 hours manually.
  const start = new Date(`${year}-${month}-${day}T00:00:00+05:30`);
  const end = new Date(`${year}-${month}-${day}T23:59:59.999+05:30`);

  return { start, end };
};

export { getCurrentDayRange };

const getCurrentDayRange = () => {
  const now = new Date();

  // Get current date in IST
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const [{ value: year }, , { value: month }, , { value: day }] =
    formatter.formatToParts(now);

  // IST midnight converted to UTC
  const start = new Date(`${year}-${month}-${day}T00:00:00+05:30`);

  // IST end of day converted to UTC
  const end = new Date(`${year}-${month}-${day}T23:59:59.999+05:30`);

  return { start, end };
};

export { getCurrentDayRange };

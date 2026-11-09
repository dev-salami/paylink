const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** End of the due calendar day in Africa/Lagos (UTC+1, no DST). */
export function dueEndUtc(isoDay: string): Date {
  const [year, month, day] = isoDay.split("-").map((part) => Number(part));
  if (!year || !month || !day) return new Date(NaN);
  return new Date(Date.UTC(year, month - 1, day, 22, 59, 59, 999));
}

export function isPastDue(isoDay: string, now: Date): boolean {
  const end = dueEndUtc(isoDay);
  if (Number.isNaN(end.getTime())) return false;
  return now.getTime() > end.getTime();
}

export function formatLongDate(isoDay: string): string {
  const [year, month, day] = isoDay.split("-").map((part) => Number(part));
  if (!year || !month || !day) return isoDay;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Parse a due phrase relative to `now`.
 * Accepts ISO dates, "today", "tomorrow", weekdays, and "6 Nov" / "Nov 6".
 */
export function parseDueDate(input: string | undefined, now: Date): string {
  if (!input || !input.trim()) return isoDate(addDays(now, 7));
  const text = input.trim().toLowerCase().replace(/\.$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (text === "today") return isoDate(now);
  if (text === "tomorrow") return isoDate(addDays(now, 1));

  const weekday = WEEKDAYS.indexOf(text as (typeof WEEKDAYS)[number]);
  if (weekday >= 0) {
    const current = now.getUTCDay();
    let delta = (weekday - current + 7) % 7;
    if (delta === 0) delta = 7;
    return isoDate(addDays(now, delta));
  }

  const dayMonth = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/);
  const monthDay = text.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
  const match = dayMonth
    ? { day: Number(dayMonth[1]), monthName: dayMonth[2] ?? "", year: dayMonth[3] }
    : monthDay
      ? { day: Number(monthDay[2]), monthName: monthDay[1] ?? "", year: monthDay[3] }
      : null;
  if (!match || MONTHS[match.monthName] === undefined || !match.day) {
    return isoDate(addDays(now, 7));
  }
  const year = match.year ? Number(match.year) : now.getUTCFullYear();
  const month = MONTHS[match.monthName] ?? 0;
  let candidate = new Date(Date.UTC(year, month, match.day));
  if (!match.year && candidate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    candidate = new Date(Date.UTC(year + 1, month, match.day));
  }
  return isoDate(candidate);
}

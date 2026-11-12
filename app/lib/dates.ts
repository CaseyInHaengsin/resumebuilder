// Pure date helpers. Imported by route components that are bundled for the
// browser, so no Node-only imports here. Dates are "YYYY-MM-DD" calendar dates.

/** Today's calendar date in the given IANA zone (the process's local zone if undefined). */
export function todayIn(
  timeZone: string | undefined,
  now: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today in APP_TIMEZONE. Server-only: reads process.env at call time. */
export function appToday(now: Date = new Date()): string {
  return todayIn(process.env.APP_TIMEZONE || undefined, now);
}

/** Whole calendar days from `from` to `to`; NaN unless both start with YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return (b - a) / 86_400_000;
}

function dayNumber(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

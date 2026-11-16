const DEFAULT_HOUR = 9;

const MINUTE_MS = 60_000;
const RELATIVE_UNITS: Record<string, { minutes?: number; days?: number }> = {
  m: { minutes: 1 },
  min: { minutes: 1 },
  mins: { minutes: 1 },
  minute: { minutes: 1 },
  minutes: { minutes: 1 },
  h: { minutes: 60 },
  hr: { minutes: 60 },
  hrs: { minutes: 60 },
  hour: { minutes: 60 },
  hours: { minutes: 60 },
  d: { days: 1 },
  day: { days: 1 },
  days: { days: 1 },
  w: { days: 7 },
  wk: { days: 7 },
  week: { days: 7 },
  weeks: { days: 7 },
};
const RELATIVE = /^(?:in )?(\d+) ?([a-z]+)$/;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2})(?::(\d{2}))? ?(am|pm)?$/;

interface Time {
  hour: number;
  minute: number;
}

type Day =
  | { kind: "fixed"; date: Date }
  /** The next such weekday, today included while the time is still ahead. */
  | { kind: "weekday"; weekday: number };

/**
 * Reads a typed snooze end in local time, or `null` when it can't be read or is not in the future.
 *
 * Accepts a duration (`30m`, `2h`, `in 3 days`, `1w`), a time (`14:30`, `9am` — today, or tomorrow
 * once passed), a day (`tomorrow`, `fri`, `2026-11-20` — at 09:00), or a day and a time
 * (`fri 14:00`, `tomorrow at 8am`, `2026-11-20T14:30`).
 */
export function parseSnoozeUntil(input: string, now: Date): Date | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  const until = parseRelative(text, now) ?? parseAbsolute(text, now);
  return until && until > now ? until : null;
}

function parseRelative(text: string, now: Date): Date | null {
  const match = RELATIVE.exec(text);
  if (!match) return null;
  const unit = RELATIVE_UNITS[match[2]];
  if (!unit) return null;
  const amount = Number(match[1]);
  if (unit.minutes) return new Date(now.getTime() + amount * unit.minutes * MINUTE_MS);
  const date = new Date(now);
  date.setDate(date.getDate() + amount * (unit.days ?? 0));
  return date;
}

function parseAbsolute(text: string, now: Date): Date | null {
  const words = text
    .replace(/^(\d{4}-\d{2}-\d{2})t/, "$1 ")
    .split(" ")
    .filter((word) => word !== "at");
  if (words.length === 0) return null;
  const first = words[0];
  const rest = words.slice(1);

  const day = parseDay(first, now);
  const timeText = (day ? rest : [first, ...rest]).join(" ");
  if (!day) {
    const time = parseTime(timeText);
    if (!time) return null;
    const today = atTime(now, 0, time);
    return today > now ? today : atTime(now, 1, time);
  }

  const time = timeText ? parseTime(timeText) : { hour: DEFAULT_HOUR, minute: 0 };
  if (!time) return null;
  if (day.kind === "fixed") return atTime(day.date, 0, time);
  const offset = (day.weekday - now.getDay() + 7) % 7;
  const next = atTime(now, offset, time);
  return next > now ? next : atTime(now, offset + 7, time);
}

function parseDay(word: string, now: Date): Day | null {
  if (word === "today") return { kind: "fixed", date: now };
  if (word === "tomorrow" || word === "tmr") return { kind: "fixed", date: atTime(now, 1, null) };
  if (word.length >= 3) {
    const weekday = WEEKDAYS.findIndex((name) => name.startsWith(word));
    if (weekday !== -1) return { kind: "weekday", weekday };
  }
  const iso = ISO_DATE.exec(word);
  if (!iso) return null;
  const [year, month, date] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
  const parsed = new Date(year, month, date);
  // `new Date` rolls 2026-02-31 over into March; a date that moved was never a real one.
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== date) {
    return null;
  }
  return { kind: "fixed", date: parsed };
}

function parseTime(text: string): Time | null {
  const match = TIME.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

function atTime(base: Date, dayOffset: number, time: Time | null): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + dayOffset);
  if (time) date.setHours(time.hour, time.minute, 0, 0);
  return date;
}

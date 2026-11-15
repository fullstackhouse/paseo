import { describe, expect, it } from "vitest";
import { parseSnoozeUntil } from "./custom-until";

function local(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

// Wednesday 2026-11-11, 14:30 local.
const NOW = local(2026, 11, 11, 14, 30);

describe("parseSnoozeUntil", () => {
  it.each([
    ["30m", local(2026, 11, 11, 15, 0)],
    ["2h", local(2026, 11, 11, 16, 30)],
    ["in 3 days", local(2026, 11, 14, 14, 30)],
    ["1w", local(2026, 11, 18, 14, 30)],
  ])("reads the duration %s", (input, expected) => {
    expect(parseSnoozeUntil(input, NOW)).toEqual(expected);
  });

  it.each([
    ["16:45", local(2026, 11, 11, 16, 45)],
    ["9am", local(2026, 11, 12, 9)],
    ["2:15 PM", local(2026, 11, 12, 14, 15)],
    ["12am", local(2026, 11, 12, 0)],
  ])("reads the time %s as its next occurrence", (input, expected) => {
    expect(parseSnoozeUntil(input, NOW)).toEqual(expected);
  });

  it.each([
    ["tomorrow", local(2026, 11, 12, 9)],
    ["tomorrow at 8am", local(2026, 11, 12, 8)],
    ["fri", local(2026, 11, 13, 9)],
    ["Friday 14:00", local(2026, 11, 13, 14)],
    ["wed 18:00", local(2026, 11, 11, 18)],
    ["wed 10:00", local(2026, 11, 18, 10)],
    ["2026-11-20", local(2026, 11, 20, 9)],
    ["2026-11-20 14:30", local(2026, 11, 20, 14, 30)],
    ["2026-11-20T14:30", local(2026, 11, 20, 14, 30)],
  ])("reads the day %s", (input, expected) => {
    expect(parseSnoozeUntil(input, NOW)).toEqual(expected);
  });

  it.each([
    "",
    "soon",
    "25:00",
    "13pm",
    "9:75",
    "2026-02-31",
    "2026-11-01",
    "today 9:00",
    "5 parsecs",
  ])("rejects %j", (input) => {
    expect(parseSnoozeUntil(input, NOW)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { snoozePresets } from "./presets";

function local(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

function untilOf(now: Date, id: string): Date | null {
  const preset = snoozePresets(now).find((entry) => entry.id === id);
  if (!preset) throw new Error(`no ${id} preset`);
  return preset.until ? new Date(preset.until) : null;
}

describe("snoozePresets", () => {
  it("offers tonight, tomorrow morning, next Monday and indefinitely in the afternoon", () => {
    const now = local(2026, 11, 11, 14, 30); // Wednesday
    expect(snoozePresets(now).map((preset) => preset.id)).toEqual([
      "tonight",
      "tomorrow",
      "nextWeek",
      "indefinite",
    ]);
    expect(untilOf(now, "tonight")).toEqual(local(2026, 11, 11, 20));
    expect(untilOf(now, "tomorrow")).toEqual(local(2026, 11, 12, 9));
    expect(untilOf(now, "nextWeek")).toEqual(local(2026, 11, 16, 9));
    expect(untilOf(now, "indefinite")).toBeNull();
  });

  it("drops tonight once 20:00 has passed", () => {
    const ids = snoozePresets(local(2026, 11, 11, 21)).map((preset) => preset.id);
    expect(ids).not.toContain("tonight");
  });

  it("means the Monday after next when it is already Monday", () => {
    expect(untilOf(local(2026, 11, 9, 8), "nextWeek")).toEqual(local(2026, 11, 16, 9));
  });

  it("crosses a month end", () => {
    expect(untilOf(local(2026, 11, 30, 10), "tomorrow")).toEqual(local(2026, 12, 1, 9));
  });
});

import { describe, expect, it } from "vitest";
import { NOTHING_MOVING_AFTER_MS, isEntryMoving, nextNothingMovingAt } from "./moving";

const now = 1_000_000_000;
const idle = { runningAgentIds: new Set<string>(), liveWork: false, now };
const entry = (updatedAt: number, extra: object = {}) => ({
  id: "A1",
  title: "t",
  updatedAt,
  ...extra,
});

describe("isEntryMoving", () => {
  it("moves until it has been unchanged for the threshold", () => {
    expect(isEntryMoving(entry(now - NOTHING_MOVING_AFTER_MS), idle)).toBe(true);
    expect(isEntryMoving(entry(now - NOTHING_MOVING_AFTER_MS - 1), idle)).toBe(false);
  });

  it("moves while watched, while live work runs, or while its agent runs a turn", () => {
    const old = now - 2 * NOTHING_MOVING_AFTER_MS;
    expect(isEntryMoving(entry(old, { watched: true }), idle)).toBe(true);
    expect(isEntryMoving(entry(old), { ...idle, liveWork: true })).toBe(true);
    const running = { ...idle, runningAgentIds: new Set(["agent-1"]) };
    expect(isEntryMoving(entry(old, { agentId: "agent-1" }), running)).toBe(true);
    expect(isEntryMoving(entry(old, { agentId: "agent-2" }), running)).toBe(false);
  });
});

describe("nextNothingMovingAt", () => {
  it("is the earliest moment an unwatched entry stops moving", () => {
    expect(
      nextNothingMovingAt(
        [entry(now - 60_000), entry(now - 120_000), entry(now - 60_000, { watched: true })],
        now,
      ),
    ).toBe(now - 120_000 + NOTHING_MOVING_AFTER_MS + 1);
  });

  it("is null when every entry already stopped or is watched", () => {
    expect(nextNothingMovingAt([entry(now - 2 * NOTHING_MOVING_AFTER_MS)], now)).toBeNull();
    expect(nextNothingMovingAt([entry(now, { watched: true })], now)).toBeNull();
    expect(nextNothingMovingAt([], now)).toBeNull();
  });
});

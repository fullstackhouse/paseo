import { describe, expect, it } from "vitest";
import { selectInProgressBadges } from "./in-progress-items";

describe("selectInProgressBadges", () => {
  it("says nothing without in-progress work", () => {
    expect(selectInProgressBadges({})).toEqual([]);
    expect(selectInProgressBadges({ notMoving: 0, reason: null, reasonCount: 0 })).toEqual([]);
  });

  it("puts not moving first, then the entries behind the row's group", () => {
    expect(selectInProgressBadges({ notMoving: 1, reason: "working", reasonCount: 3 })).toEqual([
      { kind: "notMoving", count: 1 },
      { kind: "inProgress", count: 3 },
    ]);
    expect(selectInProgressBadges({ notMoving: 0, reason: "blocked", reasonCount: 2 })).toEqual([
      { kind: "awaitingReview", count: 2 },
    ]);
  });

  it("shows not moving wherever it applies, without a reason", () => {
    expect(selectInProgressBadges({ notMoving: 2, reason: null, reasonCount: 2 })).toEqual([
      { kind: "notMoving", count: 2 },
    ]);
  });
});

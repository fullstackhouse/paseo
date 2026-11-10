import { describe, expect, test } from "vitest";
import { settleReplayedSubagents } from "./settle-replayed.js";

describe("settleReplayedSubagents", () => {
  test("cancels replayed children whose history ends without an outcome", () => {
    const settled = settleReplayedSubagents([
      { provider: "claude", event: { type: "upsert", id: "open", title: "Open" } },
      { provider: "claude", event: { type: "upsert", id: "done", status: "running" } },
      { provider: "claude", event: { type: "upsert", id: "done", status: "completed" } },
      { provider: "claude", event: { type: "upsert", id: "done", subtitle: "presentation only" } },
      { provider: "claude", event: { type: "upsert", id: "gone", status: "running" } },
      { provider: "claude", event: { type: "remove", id: "gone" } },
    ]);

    expect(settled.slice(6)).toEqual([
      { provider: "claude", event: { type: "upsert", id: "open", status: "canceled" } },
    ]);
  });

  test("leaves children a live process reported running", () => {
    const settled = settleReplayedSubagents(
      [
        { provider: "claude", event: { type: "upsert", id: "live", status: "running" } },
        { provider: "claude", event: { type: "upsert", id: "stale", status: "running" } },
      ],
      new Set(["live"]),
    );

    expect(settled.slice(2)).toEqual([
      { provider: "claude", event: { type: "upsert", id: "stale", status: "canceled" } },
    ]);
  });
});

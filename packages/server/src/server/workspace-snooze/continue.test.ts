import { describe, expect, test } from "vitest";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import { formatWakePrompt, pickWakeAgent } from "./continue.js";

function agent(id: string, overrides: Partial<StoredAgentRecord> = {}): StoredAgentRecord {
  return {
    id,
    provider: "claude",
    cwd: "/tmp/ws",
    workspaceId: "ws_1",
    createdAt: "2026-11-09T08:00:00.000Z",
    updatedAt: "2026-11-09T08:00:00.000Z",
    labels: {},
    lastStatus: "idle",
    ...overrides,
  } as StoredAgentRecord;
}

describe("pickWakeAgent", () => {
  test("picks the most recently active top-level agent", () => {
    const picked = pickWakeAgent([
      agent("older", { lastActivityAt: "2026-11-09T09:00:00.000Z" }),
      agent("newer", { lastActivityAt: "2026-11-09T11:00:00.000Z" }),
      agent("child", {
        lastActivityAt: "2026-11-09T12:00:00.000Z",
        labels: { [PARENT_AGENT_ID_LABEL]: "newer" },
      }),
      agent("internal", { lastActivityAt: "2026-11-09T12:00:00.000Z", internal: true }),
      agent("archived", {
        lastActivityAt: "2026-11-09T12:00:00.000Z",
        archivedAt: "2026-11-09T12:30:00.000Z",
      }),
    ]);
    expect(picked?.id).toBe("newer");
  });

  test("falls back to updatedAt and returns null with no candidates", () => {
    expect(pickWakeAgent([agent("only", { updatedAt: "2026-11-09T10:00:00.000Z" })])?.id).toBe(
      "only",
    );
    expect(pickWakeAgent([agent("gone", { archivedAt: "2026-11-09T10:00:00.000Z" })])).toBeNull();
  });
});

describe("formatWakePrompt", () => {
  test("wraps the prompt as system context that explains why it arrived", () => {
    const prompt = formatWakePrompt("Continue where you left off.");
    expect(prompt.startsWith("<paseo-system>\n")).toBe(true);
    expect(prompt).toContain("snooze ended");
    expect(prompt).toContain("Continue where you left off.");
  });
});

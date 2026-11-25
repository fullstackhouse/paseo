import { describe, expect, test } from "vitest";
import {
  type ProviderSubagentInputEvent,
  ProviderSubagentStore,
  type ProviderSubagentStatus,
} from "./store.js";

function statusAt(status: ProviderSubagentStatus, timestamp: string): ProviderSubagentInputEvent {
  return { type: "upsert", id: "child-1", status, timestamp };
}

describe("ProviderSubagentStore", () => {
  test("keeps provider children and their timelines scoped to the parent agent", () => {
    const subagents = new ProviderSubagentStore();

    subagents.apply("parent-a", "codex", {
      type: "upsert",
      id: "child-1",
      title: "Explore",
      cwd: "/workspace/child",
      status: "running",
      timestamp: "2026-07-12T10:00:00.000Z",
    });
    subagents.apply("parent-a", "codex", {
      type: "timeline",
      id: "child-1",
      item: { type: "assistant_message", text: "Found it." },
      timestamp: "2026-07-12T10:00:01.000Z",
    });
    subagents.apply("parent-a", "codex", {
      type: "upsert",
      id: "child-1",
      status: "completed",
      timestamp: "2026-07-12T10:00:02.000Z",
    });
    subagents.apply("parent-b", "claude", {
      type: "upsert",
      id: "child-1",
      title: "Review",
      status: "running",
      timestamp: "2026-07-12T10:00:03.000Z",
    });

    expect(subagents.list("parent-a")).toEqual([
      expect.objectContaining({
        id: "child-1",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Explore",
        cwd: "/workspace/child",
        status: "completed",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:02.000Z",
      }),
    ]);
    expect(subagents.fetchTimeline("parent-a", "child-1").rows).toMatchObject([
      {
        seq: 1,
        timestamp: "2026-07-12T10:00:01.000Z",
        item: { type: "assistant_message", text: "Found it." },
      },
    ]);
    expect(subagents.list("parent-b")[0]).toMatchObject({ provider: "claude", title: "Review" });
    expect(subagents.deleteParent("parent-a")).toEqual([
      { type: "remove", parentAgentId: "parent-a", subagentId: "child-1" },
    ]);
    expect(subagents.list("parent-a")).toEqual([]);
    expect(subagents.list("parent-b")).toHaveLength(1);
  });

  test("limits oversized provider child tool output before storage", () => {
    const subagents = new ProviderSubagentStore();
    const output = "x".repeat(70 * 1024);
    const update = subagents.apply("parent-a", "opencode", {
      type: "timeline",
      id: "child-1",
      item: {
        type: "tool_call",
        callId: "call-1",
        name: "shell",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "print", output },
      },
    });

    expect(update.type).toBe("timeline");
    const [row] = subagents.fetchTimeline("parent-a", "child-1").rows;
    expect(row?.item).toMatchObject({
      type: "tool_call",
      detail: { type: "shell", output: expect.stringMatching(/^x+…\[truncated \d+\.\d KB\]$/) },
    });
  });

  test("pages provider history on projected item boundaries", () => {
    const subagents = new ProviderSubagentStore();
    for (let index = 0; index < 101; index += 1) {
      subagents.apply("parent-a", "opencode", {
        type: "timeline",
        id: "child-1",
        item: { type: "assistant_message", text: String(index) },
      });
    }

    const page = subagents.fetchTimeline("parent-a", "child-1", {
      direction: "tail",
      limit: 1,
    });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.seqStart).toBe(1);
    expect(page.rows[0]?.item).toMatchObject({
      text: Array.from({ length: 101 }, (_, i) => String(i)).join(""),
    });
    expect(page.rows.at(-1)?.seq).toBe(101);
    expect(page.hasOlder).toBe(false);
  });

  test("counts an open run from its start and keeps it out of the total", () => {
    const subagents = new ProviderSubagentStore();
    subagents.apply("parent", "claude", statusAt("running", "2026-07-12T10:00:00.000Z"));
    subagents.apply("parent", "claude", statusAt("running", "2026-07-12T10:05:00.000Z"));

    expect(subagents.get("parent", "child-1")).toMatchObject({
      workedMs: 0,
      runStartedAt: "2026-07-12T10:00:00.000Z",
    });
  });

  test("adds up the runs of a resumed child without the idle time between them", () => {
    const subagents = new ProviderSubagentStore();
    subagents.apply("parent", "claude", statusAt("running", "2026-07-12T10:00:00.000Z"));
    subagents.apply("parent", "claude", statusAt("completed", "2026-07-12T10:02:00.000Z"));
    subagents.apply("parent", "claude", statusAt("running", "2026-07-12T13:00:00.000Z"));
    subagents.apply("parent", "claude", statusAt("completed", "2026-07-12T13:03:00.000Z"));

    expect(subagents.get("parent", "child-1")).toMatchObject({
      workedMs: 5 * 60_000,
      runStartedAt: null,
    });
  });

  test("leaves a finished child's total alone when late details or a corrected outcome arrive", () => {
    const subagents = new ProviderSubagentStore();
    subagents.apply("parent", "claude", statusAt("running", "2026-07-12T10:00:00.000Z"));
    subagents.apply("parent", "claude", statusAt("canceled", "2026-07-12T10:02:00.000Z"));
    subagents.apply("parent", "claude", {
      type: "upsert",
      id: "child-1",
      subtitle: "general-purpose · 12k tokens",
      timestamp: "2026-07-12T11:00:00.000Z",
    });
    subagents.apply("parent", "claude", statusAt("completed", "2026-07-12T12:00:00.000Z"));

    expect(subagents.get("parent", "child-1")).toMatchObject({
      workedMs: 2 * 60_000,
      runStartedAt: null,
    });
  });

  test("replaces the total when history is replayed over a finished child", () => {
    const subagents = new ProviderSubagentStore();
    const history = [
      statusAt("running", "2026-07-12T10:00:00.000Z"),
      statusAt("completed", "2026-07-12T10:02:00.000Z"),
      statusAt("running", "2026-07-12T13:00:00.000Z"),
      statusAt("completed", "2026-07-12T13:03:00.000Z"),
    ];
    for (const event of [...history, ...history]) subagents.apply("parent", "claude", event);

    expect(subagents.get("parent", "child-1")?.workedMs).toBe(5 * 60_000);
  });

  test("records no work for a child first seen finished", () => {
    const subagents = new ProviderSubagentStore();
    subagents.apply("parent", "codex", statusAt("completed", "2026-07-12T10:00:00.000Z"));

    expect(subagents.get("parent", "child-1")).toMatchObject({ workedMs: 0, runStartedAt: null });
  });
});

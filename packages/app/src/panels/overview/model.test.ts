import { describe, expect, it } from "vitest";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { Agent } from "@/stores/session-store";
import type { AttentionItem } from "@/workspace-attention/model";
import {
  deriveWorkspaceStateWord,
  deriveYourMove,
  MAX_ENTRIES_PER_ITEM,
  partitionSummaryItems,
} from "./model";

function summaryItem(patch: Partial<WorkspaceSummaryItem>): WorkspaceSummaryItem {
  return {
    entryKey: 0,
    serverId: "s",
    pluginId: "p",
    itemId: "i",
    workspaceId: "w",
    title: "Item",
    ...patch,
  };
}

type AgentFacts = Pick<Agent, "status" | "pendingPermissions" | "archivedAt">;
const idle: AgentFacts = { status: "idle", pendingPermissions: [], archivedAt: null };

describe("deriveWorkspaceStateWord", () => {
  it("reads the status card first", () => {
    const status = { state: "waiting_on_you", summary: "s", updatedAt: 1 } as const;
    expect(deriveWorkspaceStateWord({ status, agents: [] })).toBe("waiting");
    expect(deriveWorkspaceStateWord({ status: { ...status, answered: true }, agents: [] })).toBe(
      "answered",
    );
    expect(deriveWorkspaceStateWord({ status: { ...status, state: "done" }, agents: [idle] })).toBe(
      "done",
    );
  });

  it("falls back to the agents without a card", () => {
    expect(deriveWorkspaceStateWord({ status: null, agents: [idle] })).toBe("idle");
    expect(
      deriveWorkspaceStateWord({ status: null, agents: [idle, { ...idle, status: "running" }] }),
    ).toBe("working");
    expect(deriveWorkspaceStateWord({ status: null, agents: [{ ...idle, status: "error" }] })).toBe(
      "failed",
    );
    expect(
      deriveWorkspaceStateWord({
        status: null,
        agents: [{ ...idle, status: "running", pendingPermissions: [{}] as never }],
      }),
    ).toBe("waiting");
    expect(
      deriveWorkspaceStateWord({
        status: null,
        agents: [{ ...idle, status: "running", archivedAt: new Date() }],
      }),
    ).toBe("idle");
  });
});

describe("deriveYourMove", () => {
  const asks = summaryItem({
    needsYou: true,
    entries: Array.from({ length: 7 }, (_, index) => ({ id: `A${index}`, title: `Ask ${index}` })),
  });
  const items: AttentionItem[] = [
    { kind: "permission", key: "perm", agentId: "a1" },
    { kind: "plugin", key: "plugin", item: asks },
    { kind: "failed", key: "failed", agentId: "a2" },
    { kind: "pr-checks-failed", key: "checks" },
  ];

  it("lists blocking items in ladder order, one row per entry, then checks and git", () => {
    const rows = deriveYourMove({
      items,
      agentRunning: false,
      gitPrimaryId: "commit",
      prMerged: false,
    });
    expect(rows.map((row) => row.kind)).toEqual([
      "permission",
      ...Array(MAX_ENTRIES_PER_ITEM).fill("entry"),
      "failed",
      "checks",
      "git",
    ]);
  });

  it("keeps only blocking items while an agent runs", () => {
    const rows = deriveYourMove({
      items,
      agentRunning: true,
      gitPrimaryId: "commit",
      prMerged: false,
    });
    expect(rows.some((row) => row.kind === "checks" || row.kind === "git")).toBe(false);
  });

  it("shows a plugin item without entries as one row", () => {
    const rows = deriveYourMove({
      items: [{ kind: "plugin", key: "x", item: summaryItem({ needsYou: true }) }],
      agentRunning: false,
      gitPrimaryId: null,
      prMerged: false,
    });
    expect(rows).toEqual([{ kind: "plugin", key: "x", item: expect.anything() }]);
  });

  it("offers archive only once the PR merged", () => {
    const input = { items: [], agentRunning: false, gitPrimaryId: "archive-workspace" };
    expect(deriveYourMove({ ...input, prMerged: false })).toEqual([]);
    expect(deriveYourMove({ ...input, prMerged: true })).toEqual([
      { kind: "git", key: "git:archive-workspace" },
    ]);
  });
});

describe("partitionSummaryItems", () => {
  it("routes status, attention and plain facts", () => {
    const status = summaryItem({
      itemId: "status",
      status: { state: "done", summary: "s", updatedAt: 1 },
    });
    const asks = summaryItem({ itemId: "asks", entries: [] });
    const waiting = summaryItem({ itemId: "w", needsYou: true });
    const limits = summaryItem({ itemId: "limits", label: "62%" });
    expect(partitionSummaryItems([limits, status, asks, waiting])).toEqual({
      status,
      more: [limits],
    });
  });
});

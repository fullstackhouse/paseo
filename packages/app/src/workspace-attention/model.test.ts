import { describe, expect, it } from "vitest";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import {
  decideExplorerAutoShow,
  deriveAttentionItems,
  type AttentionInput,
  type AttentionItem,
} from "./model";

type TestAgent = AttentionInput["agents"][number];
type TestPullRequest = NonNullable<AttentionInput["pullRequest"]>;

function agent(id: string, over: Partial<TestAgent> = {}): TestAgent {
  return { id, status: "idle", pendingPermissions: [], archivedAt: null, ...over };
}

function permission(id: string): TestAgent["pendingPermissions"][number] {
  return {
    id,
    provider: "claude",
    name: "Bash",
    kind: "tool",
  } as TestAgent["pendingPermissions"][number];
}

function summary(over: Partial<WorkspaceSummaryItem> = {}): WorkspaceSummaryItem {
  return {
    entryKey: 1,
    serverId: "s",
    pluginId: "paseo-asks",
    itemId: "asks",
    workspaceId: "w",
    title: "Asks",
    needsYou: true,
    key: "ask-1",
    panelId: "asks",
    ...over,
  };
}

function pr(over: Partial<TestPullRequest> = {}): TestPullRequest {
  return {
    number: 7,
    url: "https://example.test/pr/7",
    title: "Retry",
    state: "open",
    baseRefName: "main",
    headRefName: "retry",
    isMerged: false,
    ...over,
  };
}

const keys = (items: AttentionItem[]) => items.map((item) => item.key);

describe("deriveAttentionItems", () => {
  it("returns nothing for a quiet workspace", () => {
    expect(
      deriveAttentionItems({ agents: [agent("a")], summaryItems: [], pullRequest: null }),
    ).toEqual([]);
  });

  it("orders permission, plugin, failure, then PR", () => {
    const items = deriveAttentionItems({
      agents: [
        agent("a", { status: "error" }),
        agent("b", { pendingPermissions: [permission("p1")] }),
      ],
      summaryItems: [summary()],
      pullRequest: pr({ isMerged: true }),
    });
    expect(keys(items)).toEqual([
      "permission:b:p1",
      "plugin:paseo-asks:asks:ask-1",
      "failed:a",
      "pr-merged:7",
    ]);
  });

  it("ignores archived agents and summary items that don't need you", () => {
    const items = deriveAttentionItems({
      agents: [agent("a", { status: "error", archivedAt: new Date() })],
      summaryItems: [summary({ needsYou: false })],
      pullRequest: null,
    });
    expect(items).toEqual([]);
  });

  it("keys failing checks by the failing check names", () => {
    const items = deriveAttentionItems({
      agents: [],
      summaryItems: [],
      pullRequest: pr({
        checksStatus: "failure",
        checks: [
          { name: "typecheck", status: "failure", url: null },
          { name: "e2e", status: "failure", url: null },
          { name: "lint", status: "success", url: null },
        ],
      }),
    });
    expect(keys(items)).toEqual(["pr-checks-failed:7:e2e,typecheck"]);
  });

  it("flags a PR ready to merge only when checks pass, review is ok and it is mergeable", () => {
    const ready = pr({
      checksStatus: "success",
      reviewDecision: "approved",
      mergeable: "MERGEABLE",
    });
    expect(
      keys(deriveAttentionItems({ agents: [], summaryItems: [], pullRequest: ready })),
    ).toEqual(["pr-ready:7"]);
    for (const notReady of [
      { ...ready, checksStatus: "pending" as const },
      { ...ready, reviewDecision: "changes_requested" as const },
      { ...ready, mergeable: "CONFLICTING" as const },
      { ...ready, isDraft: true },
      { ...ready, state: "closed" },
    ]) {
      expect(deriveAttentionItems({ agents: [], summaryItems: [], pullRequest: notReady })).toEqual(
        [],
      );
    }
  });
});

describe("decideExplorerAutoShow", () => {
  const ask: AttentionItem = {
    kind: "plugin",
    key: "plugin:paseo-asks:asks:ask-1",
    item: summary(),
  };
  const merged: AttentionItem = { kind: "pr-merged", key: "pr-merged:7" };

  it("does nothing on Never", () => {
    expect(decideExplorerAutoShow({ setting: "never", items: [ask], record: null })).toEqual({
      kind: "none",
    });
  });

  it("opens for the first unseen item", () => {
    expect(
      decideExplorerAutoShow({ setting: "needed", items: [merged, ask], record: null }),
    ).toEqual({
      kind: "item",
      item: merged,
    });
    expect(
      decideExplorerAutoShow({
        setting: "needed",
        items: [merged, ask],
        record: { hidden: false, seenKeys: [merged.key] },
      }),
    ).toEqual({ kind: "item", item: ask });
  });

  it("keeps a hidden Explorer hidden until a new key arrives", () => {
    const record = { hidden: true, seenKeys: [ask.key] };
    expect(decideExplorerAutoShow({ setting: "always", items: [ask], record })).toEqual({
      kind: "none",
    });
    const newer: AttentionItem = { ...ask, key: "plugin:paseo-asks:asks:ask-2" };
    expect(decideExplorerAutoShow({ setting: "always", items: [newer], record })).toEqual({
      kind: "item",
      item: newer,
    });
  });

  it("shows Explorer on Always when nothing is unseen and it wasn't hidden", () => {
    expect(decideExplorerAutoShow({ setting: "always", items: [], record: null })).toEqual({
      kind: "show",
    });
    expect(decideExplorerAutoShow({ setting: "needed", items: [], record: null })).toEqual({
      kind: "none",
    });
  });
});

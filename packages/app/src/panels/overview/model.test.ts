import { describe, expect, it } from "vitest";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { Agent } from "@/stores/session-store";
import type { AttentionItem } from "@/workspace-attention/model";
import {
  branchFacts,
  canAnswerPermissionInPlace,
  permissionActions,
  permissionFacts,
  permissionResponse,
  permissionSubject,
  deriveCodeRow,
  deriveWorkspaceStateWord,
  deriveYourMove,
  gitMoveFacts,
  isStatusDone,
  isStatusOutdated,
  MAX_ENTRIES_PER_ITEM,
  overviewSubtitle,
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
      statusDone: false,
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
      statusDone: false,
    });
    expect(rows.some((row) => row.kind === "checks" || row.kind === "git")).toBe(false);
  });

  it("shows a plugin item without entries as one row", () => {
    const rows = deriveYourMove({
      items: [{ kind: "plugin", key: "x", item: summaryItem({ needsYou: true }) }],
      agentRunning: false,
      gitPrimaryId: null,
      prMerged: false,
      statusDone: false,
    });
    expect(rows).toEqual([{ kind: "plugin", key: "x", item: expect.anything() }]);
  });

  it("offers archive only once the PR merged or the status card says done", () => {
    const input = { items: [], agentRunning: false, gitPrimaryId: "archive-workspace" };
    const archive = [{ kind: "git", key: "git:archive-workspace" }];
    expect(deriveYourMove({ ...input, prMerged: false, statusDone: false })).toEqual([]);
    expect(deriveYourMove({ ...input, prMerged: true, statusDone: false })).toEqual(archive);
    expect(deriveYourMove({ ...input, prMerged: false, statusDone: true })).toEqual(archive);
  });
});

describe("isStatusDone", () => {
  const done = { state: "done" as const, summary: "s", updatedAt: 100 };

  it("is true for a current done card", () => {
    expect(isStatusDone({ status: done, agentRunning: false, lastPromptAt: 50 })).toBe(true);
    expect(isStatusDone({ status: done, agentRunning: false, lastPromptAt: null })).toBe(true);
  });

  it("is false without a card, for other states, answered or outdated cards", () => {
    const at = { agentRunning: false, lastPromptAt: 50 };
    expect(isStatusDone({ ...at, status: null })).toBe(false);
    expect(isStatusDone({ ...at, status: { ...done, state: "working" } })).toBe(false);
    expect(isStatusDone({ ...at, status: { ...done, answered: true } })).toBe(false);
    expect(isStatusDone({ ...at, status: done, lastPromptAt: 150 })).toBe(false);
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

describe("isStatusOutdated", () => {
  const updatedAt = 1_000_000;

  it("flags a card when a prompt came after it and the turn ended without a new one", () => {
    expect(isStatusOutdated({ updatedAt, agentRunning: false, lastPromptAt: updatedAt + 1 })).toBe(
      true,
    );
  });

  it("doesn't flag a card reported after the last prompt", () => {
    expect(isStatusOutdated({ updatedAt, agentRunning: false, lastPromptAt: updatedAt - 1 })).toBe(
      false,
    );
  });

  it("doesn't flag while an agent runs, since the card is due an update", () => {
    expect(isStatusOutdated({ updatedAt, agentRunning: true, lastPromptAt: updatedAt + 1 })).toBe(
      false,
    );
  });

  it("doesn't flag without a prompt", () => {
    expect(isStatusOutdated({ updatedAt, agentRunning: false, lastPromptAt: null })).toBe(false);
  });
});

describe("overviewSubtitle", () => {
  it("prefers the goal, then the project", () => {
    expect(overviewSubtitle({ goal: "Ship it", project: "paseo" })).toBe("Ship it");
    expect(overviewSubtitle({ goal: null, project: "paseo" })).toBe("paseo");
    expect(overviewSubtitle({ goal: "", project: null })).toBe(null);
  });
});

describe("branch and git move facts", () => {
  const t = (key: string) => key.replace("panels.overview.", "");
  const clean = { ahead: 0, behind: 0, isDirty: false, diffStat: null, pullRequest: null };

  it("says nothing for a clean branch in sync", () => {
    expect(branchFacts(clean, t)).toBe("");
    expect(gitMoveFacts(clean, t)).toBe("");
  });

  it("lists sync, diff and uncommitted changes", () => {
    const facts = {
      ...clean,
      ahead: 2,
      isDirty: true,
      diffStat: { additions: 10, deletions: 3 },
    };
    expect(branchFacts(facts, t)).toBe("↑2 · +10 −3 · uncommitted");
  });

  it("says nothing once the PR merged", () => {
    const facts = { ...clean, ahead: 1, pullRequest: { isMerged: true } };
    expect(branchFacts(facts, t)).toBe("");
    expect(gitMoveFacts(facts, t)).toBe("");
  });

  it("puts an open PR's checks and review before the branch facts on the git move", () => {
    const facts = {
      ...clean,
      ahead: 2,
      pullRequest: { isMerged: false, checksStatus: "failure", reviewDecision: "pending" } as const,
    };
    expect(gitMoveFacts(facts, t)).toBe("checksFailing · reviewRequired · ↑2");
  });
});

describe("deriveCodeRow", () => {
  it("shows nothing when the git move already names the PR or branch", () => {
    expect(deriveCodeRow({ hasPullRequest: true, gitMoveShown: true, branchHasFacts: true })).toBe(
      null,
    );
    expect(deriveCodeRow({ hasPullRequest: false, gitMoveShown: true, branchHasFacts: true })).toBe(
      null,
    );
  });

  it("shows only the PR, not its branch, when there is one", () => {
    expect(deriveCodeRow({ hasPullRequest: true, gitMoveShown: false, branchHasFacts: true })).toBe(
      "pr",
    );
  });

  it("shows the branch only when it has something to report", () => {
    expect(
      deriveCodeRow({ hasPullRequest: false, gitMoveShown: false, branchHasFacts: true }),
    ).toBe("branch");
    expect(
      deriveCodeRow({ hasPullRequest: false, gitMoveShown: false, branchHasFacts: false }),
    ).toBe(null);
  });
});

describe("permissions on Overview", () => {
  const shell = { kind: "tool", detail: { type: "shell", command: "npm run db:migrate" } } as const;

  it("says what a tool permission would do in one line", () => {
    expect(permissionSubject(shell)).toBe("npm run db:migrate");
    expect(permissionSubject({ kind: "tool", detail: { type: "read", filePath: "a.ts" } })).toBe(
      "a.ts",
    );
    expect(
      permissionSubject({ kind: "tool", detail: { type: "fetch", url: "https://x.test" } }),
    ).toBe("https://x.test");
  });

  it("names the directory when a command runs outside the workspace", () => {
    const elsewhere = {
      kind: "tool",
      detail: { type: "shell", command: "rm -rf build", cwd: "/tmp" },
    } as const;
    expect(permissionSubject(elsewhere, "/repo")).toBe("rm -rf build (in /tmp)");
    expect(permissionSubject(elsewhere, "/tmp")).toBe("rm -rf build");
    expect(permissionSubject({ kind: "tool", detail: { type: "shell", command: " " } })).toBe(null);
  });

  it("shows why the agent asks next to what it would do", () => {
    expect(permissionFacts({ ...shell, description: "Needs network access" }, null)).toBe(
      "npm run db:migrate · Needs network access",
    );
    expect(permissionFacts({ kind: "tool", description: "Edit a.ts" }, null)).toBe("Edit a.ts");
  });

  it("answers in place only when that line shows everything being approved", () => {
    expect(canAnswerPermissionInPlace(shell)).toBe(true);
    expect(
      canAnswerPermissionInPlace({ kind: "tool", detail: { type: "edit", filePath: "a.ts" } }),
    ).toBe(false);
    expect(canAnswerPermissionInPlace({ kind: "tool" })).toBe(false);
    expect(canAnswerPermissionInPlace({ ...shell, kind: "plan" })).toBe(false);
    expect(canAnswerPermissionInPlace({ ...shell, kind: "question" })).toBe(false);
  });

  it("falls back to accept and deny when the request names no actions", () => {
    const actions = permissionActions(shell, { accept: "Accept", deny: "Deny" });
    expect(actions.map((action) => [action.id, action.behavior])).toEqual([
      ["accept", "allow"],
      ["reject", "deny"],
    ]);
    const own = [{ id: "always", label: "Allow always", behavior: "allow" as const }];
    expect(permissionActions({ ...shell, actions: own }, { accept: "A", deny: "D" })).toBe(own);
  });

  it("maps an action to its response", () => {
    expect(permissionResponse({ id: "accept", label: "A", behavior: "allow" })).toEqual({
      behavior: "allow",
      selectedActionId: "accept",
    });
    expect(permissionResponse({ id: "reject", label: "D", behavior: "deny" })).toEqual({
      behavior: "deny",
      selectedActionId: "reject",
      message: "Denied by user",
    });
  });
});

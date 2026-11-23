import { describe, expect, it } from "vitest";
import type { GitActionId } from "@/git/policy";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { Agent } from "@/stores/session-store";
import type { AttentionItem } from "@/workspace-attention/model";
import {
  blockerTarget,
  statusBlockers,
  branchFacts,
  canAnswerPermissionInPlace,
  permissionActions,
  permissionFacts,
  permissionResponse,
  permissionSubject,
  derivePullRequests,
  findBlocking,
  isTreeBlocker,
  orderChildren,
  deriveWorkspaceStateWord,
  deriveYourMove,
  isStatusDone,
  isStatusOutdated,
  noPullRequestFacts,
  openMoveKey,
  pinOpenMove,
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

  it("lists blocking items in ladder order, one row per entry, and no git or checks rows", () => {
    const rows = deriveYourMove({
      items,
      agentRunning: false,
      gitPrimaryId: "commit",
      canArchive: true,
      isWorktree: true,
      prMerged: false,
      statusDone: false,
    });
    expect(rows.map((row) => row.kind)).toEqual([
      "permission",
      ...Array(7).fill("entry"),
      "failed",
    ]);
  });

  it("shows a plugin item without entries as one row", () => {
    const rows = deriveYourMove({
      items: [{ kind: "plugin", key: "x", item: summaryItem({ needsYou: true }) }],
      agentRunning: false,
      gitPrimaryId: null,
      canArchive: false,
      isWorktree: true,
      prMerged: false,
      statusDone: false,
    });
    expect(rows).toEqual([{ kind: "plugin", key: "x", item: expect.anything() }]);
  });

  describe("archive", () => {
    const base = {
      items: [],
      agentRunning: false,
      gitPrimaryId: "archive-workspace" as GitActionId,
      canArchive: true,
      isWorktree: true,
      prMerged: false,
      statusDone: true,
    };
    const archive = [{ kind: "archive", key: "git:archive-workspace" }];

    it("is offered only once the PR merged or the status card says done", () => {
      expect(deriveYourMove({ ...base, statusDone: false })).toEqual([]);
      expect(deriveYourMove({ ...base, statusDone: false, prMerged: true })).toEqual(archive);
      expect(deriveYourMove(base)).toEqual(archive);
    });

    it("is offered over a leftover sync step", () => {
      for (const id of ["pull", "push", "pull-and-push", "merge-from-base"] as const) {
        expect(deriveYourMove({ ...base, gitPrimaryId: id })).toEqual(archive);
      }
    });

    it("waits while work isn't in the PR yet, or there is no git step", () => {
      for (const id of ["commit", "merge-pr-squash", "pr"] as const) {
        expect(deriveYourMove({ ...base, gitPrimaryId: id })).toEqual([]);
      }
      expect(deriveYourMove({ ...base, gitPrimaryId: null })).toEqual([]);
    });

    it("waits while an agent runs or archive can't run", () => {
      expect(deriveYourMove({ ...base, agentRunning: true })).toEqual([]);
      expect(deriveYourMove({ ...base, canArchive: false })).toEqual([]);
    });

    it("is offered in a regular checkout only after a merge", () => {
      const input = { ...base, isWorktree: false };
      expect(deriveYourMove(input)).toEqual([]);
      expect(deriveYourMove({ ...input, statusDone: false, prMerged: true })).toEqual(archive);
    });
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
    const prs = summaryItem({ itemId: "prs", pullRequests: [] });
    expect(partitionSummaryItems([limits, status, asks, waiting, prs])).toEqual({
      status,
      pullRequests: prs,
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

describe("branchFacts", () => {
  const t = (key: string) => key.replace("panels.overview.", "");
  const clean = { ahead: 0, behind: 0, isDirty: false, diffStat: null, pullRequest: null };

  it("says nothing for a clean branch in sync", () => {
    expect(branchFacts(clean, t)).toBe("");
  });

  it("lists sync, diff and uncommitted changes", () => {
    const facts = { ...clean, ahead: 2, isDirty: true, diffStat: { additions: 10, deletions: 3 } };
    expect(branchFacts(facts, t)).toBe("↑2 · +10 −3 · uncommitted");
  });

  it("says nothing once the PR merged", () => {
    expect(branchFacts({ ...clean, ahead: 1, pullRequest: { isMerged: true } }, t)).toBe("");
  });
});

describe("derivePullRequests", () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    options?.count === undefined ? key.replace("panels.overview.", "") : `${options.count}`;
  const host = {
    number: 231,
    url: "https://github.test/o/paseo/pull/231",
    title: "Tree and PRs",
    state: "OPEN",
    isMerged: false,
    checksStatus: "failure" as const,
    reviewDecision: "changes_requested" as const,
  };
  const pr = (patch: object) => ({
    id: "u",
    number: 1,
    title: "T",
    url: "https://github.test/o/paseo/pull/1",
    state: "open" as const,
    ...patch,
  });

  it("shows the host's branch PR with its checks and review, in red", () => {
    expect(derivePullRequests({ plugin: null, host, t })).toEqual({
      open: [
        {
          key: host.url,
          ref: "#231",
          title: "Tree and PRs",
          facts: "checksFailing · changesRequested",
          tone: "danger",
          url: host.url,
          isBranchPr: true,
        },
      ],
      done: [],
    });
  });

  it("files a merged or closed host PR as done", () => {
    const merged = derivePullRequests({ plugin: null, host: { ...host, isMerged: true }, t });
    expect(merged.done.map((row) => [row.facts, row.tone])).toEqual([["prState.merged", "merged"]]);
    const closed = derivePullRequests({ plugin: null, host: { ...host, state: "CLOSED" }, t });
    expect(closed.done.map((row) => row.tone)).toEqual(["muted"]);
  });

  it("prefers the plugin's list, splitting open from merged and closed", () => {
    const list = derivePullRequests({
      plugin: [
        pr({ id: "a", number: 231, facts: "2 failing", tone: "danger" }),
        pr({ id: "b", number: 58, repo: "paseo-prs", state: "draft" }),
        pr({ id: "c", number: 229, state: "merged" }),
        pr({ id: "d", number: 228, state: "closed" }),
      ],
      host,
      t,
    });
    expect(list.open.map((row) => [row.ref, row.facts, row.tone, row.isBranchPr])).toEqual([
      ["#231", "2 failing", "danger", true],
      ["paseo-prs#58", "prState.draft", "muted", false],
    ]);
    expect(list.done.map((row) => [row.ref, row.tone])).toEqual([
      ["#229", "merged"],
      ["#228", "muted"],
    ]);
  });

  it("takes an empty plugin list as no PRs", () => {
    expect(derivePullRequests({ plugin: [], host, t })).toEqual({ open: [], done: [] });
  });
});

describe("noPullRequestFacts", () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    options?.count === undefined ? key.replace("panels.overview.", "") : `${options.count} commits`;

  it("says what a PR would propose", () => {
    expect(
      noPullRequestFacts(
        { aheadOfBase: 3, isDirty: true, diffStat: { additions: 120, deletions: 8 } },
        t,
      ),
    ).toBe("3 commits · +120 −8 · uncommitted");
  });

  it("is null with nothing ahead of the base", () => {
    expect(noPullRequestFacts({ aheadOfBase: 0, isDirty: true, diffStat: null }, t)).toBeNull();
    expect(noPullRequestFacts({ aheadOfBase: null, isDirty: false, diffStat: null }, t)).toBeNull();
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

describe("openMoveKey", () => {
  const rows = [
    { kind: "failed", key: "a", agentId: "x" },
    { kind: "archive", key: "b" },
  ] as const;

  it("opens the lead row until the human chooses", () => {
    expect(openMoveKey(rows, undefined)).toBe("a");
  });

  it("keeps only the row the human opened open", () => {
    expect(openMoveKey(rows, "b")).toBe("b");
  });

  it("keeps every row closed after the human closes the open one", () => {
    expect(openMoveKey(rows, null)).toBeNull();
  });

  it("falls back to the lead row once the chosen row is gone", () => {
    expect(openMoveKey(rows, "answered")).toBe("a");
  });

  it("has nothing to open without rows", () => {
    expect(openMoveKey([], undefined)).toBeNull();
  });
});

describe("pinOpenMove", () => {
  const ask = (id: string) =>
    ({
      kind: "entry",
      key: `asks:${id}`,
      item: summaryItem({ EntryComponent: () => null }),
      entry: { id, title: id },
    }) as const;
  const permission = { kind: "permission", key: "perm", agentId: "x" } as const;
  const archive = { kind: "archive", key: "git:archive-workspace" } as const;

  it("keeps the ask being answered open when a move arrives above it", () => {
    const pinned = pinOpenMove([ask("a")], undefined);
    expect(pinned).toBe("asks:a");
    expect(openMoveKey([permission, ask("a")], pinOpenMove([permission, ask("a")], pinned))).toBe(
      "asks:a",
    );
  });

  it("never pins a row that can't expand, so a later ask above it still opens", () => {
    const pinned = pinOpenMove([archive], undefined);
    expect(pinned).toBeUndefined();
    expect(openMoveKey([ask("a"), archive], pinOpenMove([ask("a"), archive], pinned))).toBe(
      "asks:a",
    );
  });

  it("keeps every row closed after the human closes the open one", () => {
    expect(pinOpenMove([ask("a")], null)).toBeNull();
  });

  it("pins the next lead ask once the pinned one is answered", () => {
    expect(pinOpenMove([ask("b")], "asks:a")).toBe("asks:b");
  });
});

describe("Blocked by", () => {
  const blocked = {
    state: "blocked" as const,
    summary: "Waiting on the migration",
    updatedAt: 1,
    blockedBy: [
      { kind: "pr" as const, label: "#42 Migrate", url: "https://github.com/a/b/pull/42" },
    ],
  };

  it("lists blockers only on an unanswered blocked status", () => {
    expect(statusBlockers(blocked)).toEqual(blocked.blockedBy);
    expect(statusBlockers({ ...blocked, answered: true })).toEqual([]);
    expect(statusBlockers({ ...blocked, state: "working" })).toEqual([]);
    expect(statusBlockers(null)).toEqual([]);
  });

  it("lists the same blocker once", () => {
    const pr = blocked.blockedBy[0]!;
    expect(statusBlockers({ ...blocked, blockedBy: [pr, { ...pr, detail: "open" }] })).toEqual([
      pr,
    ]);
  });

  it("opens the agent, else its workspace, else the link", () => {
    expect(
      blockerTarget({ kind: "agent", label: "Fix", agentId: "a1", workspaceId: "w1" }),
    ).toEqual({ kind: "agent", agentId: "a1" });
    expect(blockerTarget({ kind: "workspace", label: "DB", workspaceId: "w1" })).toEqual({
      kind: "workspace",
      workspaceId: "w1",
    });
    expect(blockerTarget({ kind: "pr", label: "#1", url: "https://x.test/pull/1" })).toEqual({
      kind: "url",
      url: "https://x.test/pull/1",
    });
    expect(blockerTarget({ kind: "person", label: "Mo" })).toBeNull();
  });
});

describe("Tree", () => {
  it("sends workspace and agent blockers to the Tree, the rest to Waiting on", () => {
    expect(isTreeBlocker({ kind: "workspace", label: "w" })).toBe(true);
    expect(isTreeBlocker({ kind: "agent", label: "a" })).toBe(true);
    expect(isTreeBlocker({ kind: "pr", label: "#1" })).toBe(false);
    expect(isTreeBlocker({ kind: "person", label: "Mo" })).toBe(false);
  });

  it("orders children needing you first, then newest first", () => {
    const words = { a: "done", b: "waiting", c: "working", d: "failed" } as const;
    expect(orderChildren(["a", "b", "c", "d"], (id) => words[id as keyof typeof words])).toEqual([
      "d",
      "b",
      "c",
      "a",
    ]);
  });

  it("finds the workspaces whose blocked status names this workspace or its agents", () => {
    const blocked = (workspaceId: string, blockedBy: object[], patch: object = {}) =>
      summaryItem({
        workspaceId,
        status: { state: "blocked", summary: "s", updatedAt: 1, blockedBy, ...patch } as never,
      });
    const items = [
      blocked("w-docs", [{ kind: "workspace", label: "Here", workspaceId: "W-HERE" }]),
      blocked("w-fix", [{ kind: "agent", label: "Impl", agentId: "agent-here" }]),
      blocked("w-other", [{ kind: "workspace", label: "Else", workspaceId: "w-else" }]),
      blocked("w-answered", [{ kind: "workspace", label: "Here", workspaceId: "w-here" }], {
        answered: true,
      }),
      blocked("w-here", [{ kind: "workspace", label: "Self", workspaceId: "w-here" }]),
      summaryItem({ serverId: "other", workspaceId: "w-x", status: undefined }),
    ];
    expect(
      findBlocking({
        items,
        serverId: "s",
        workspaceId: "w-here",
        agentIdsHere: new Set(["agent-here"]),
        normalize: (id) => id.toLowerCase(),
      }),
    ).toEqual([
      { serverId: "s", workspaceId: "w-docs" },
      { serverId: "s", workspaceId: "w-fix" },
    ]);
  });
});

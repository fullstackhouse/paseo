import { describe, expect, it } from "vitest";
import type { GitActionId } from "@/git/policy";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { Agent } from "@/stores/session-store";
import type { AttentionItem } from "@/workspace-attention/model";
import { deriveStatusCard } from "@/workspace-status/attention";
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
  foldsDonePullRequests,
  collapsePullRequests,
  VISIBLE_PULL_REQUESTS,
  pullRequestsFoldLabel,
  findBlocking,
  isTreeBlocker,
  orderChildren,
  deriveWorkspaceStateWord,
  deriveYourMove,
  deriveInProgress,
  hasInProgressEntries,
  type InProgressAgent,
  isStatusDone,
  isStatusOutdated,
  isWorkStillOpen,
  newestReplyAt,
  noPullRequestFacts,
  openMoveKey,
  pinOpenMove,
  overviewSubtitle,
  partitionSummaryItems,
  type YourMoveRow,
} from "./model";
import { NOTHING_MOVING_AFTER_MS } from "@/workspace-status/moving";

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

function rowKinds(rows: readonly YourMoveRow[]): YourMoveRow["kind"][] {
  return rows.map((row) => row.kind);
}

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
      workOpen: false,
      inProgress: false,
    });
    expect(rows.map((row) => row.kind)).toEqual([
      "permission",
      ...Array(7).fill("entry"),
      "failed",
    ]);
  });

  it("lists one entry row per unrecorded agent, keyed and rendered by the card's item", () => {
    const status = summaryItem({ pluginId: "paseo-status", itemId: "status", title: "Status" });
    const rows = deriveYourMove({
      items: [
        { kind: "unrecorded", key: "unrecorded:a:1", item: status, agentId: "a" },
        { kind: "unrecorded", key: "unrecorded:b:2", item: status, agentId: "b" },
      ],
      agentRunning: false,
      gitPrimaryId: null,
      canArchive: false,
      isWorktree: true,
      prMerged: false,
      statusDone: false,
      workOpen: false,
      inProgress: false,
    });
    expect(rows).toEqual([
      {
        kind: "entry",
        key: "entry:paseo-status:status:a",
        item: status,
        entry: { id: "a", title: "Status", agentId: "a" },
        unrecorded: true,
      },
      {
        kind: "entry",
        key: "entry:paseo-status:status:b",
        item: status,
        entry: { id: "b", title: "Status", agentId: "b" },
        unrecorded: true,
      },
    ]);
  });

  it("keeps an entry's row key when the plugin item's key moves to a newer entry", () => {
    // Asks sets the item key to its newest ask, so a new ask changes the attention key.
    const rowsFor = (attentionKey: string, ids: string[]) =>
      deriveYourMove({
        items: [
          {
            kind: "plugin",
            key: attentionKey,
            item: summaryItem({
              needsYou: true,
              entries: ids.map((id) => ({ id, title: id })),
            }),
          },
        ],
        agentRunning: false,
        gitPrimaryId: null,
        canArchive: false,
        isWorktree: true,
        prMerged: false,
        statusDone: false,
        workOpen: false,
        inProgress: false,
      });
    const [answering] = rowsFor("plugin:p:i:A1", ["A1"]);
    const after = rowsFor("plugin:p:i:A2", ["A2", "A1"]);
    expect(after.map((row) => row.key)).toContain(answering?.key);
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
      workOpen: false,
      inProgress: false,
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
      workOpen: false,
      inProgress: false,
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
      for (const id of ["merge-pr-squash", "pr"] as const) {
        expect(deriveYourMove({ ...base, gitPrimaryId: id })).toEqual([]);
      }
      expect(deriveYourMove({ ...base, gitPrimaryId: null })).toEqual([]);
    });

    const commit = { ...base, gitPrimaryId: "commit" as GitActionId };
    const uncommitted = [{ kind: "uncommitted", key: "git:commit" }];

    it("says uncommitted changes hold it back once the work shipped", () => {
      // Done, 10 PRs merged, +22 lines left in the worktree: the header's step is Commit.
      expect(deriveYourMove(commit)).toEqual(uncommitted);
      expect(deriveYourMove({ ...commit, statusDone: false, prMerged: true })).toEqual(uncommitted);
    });

    it("doesn't mention uncommitted changes when Archive wouldn't be offered anyway", () => {
      expect(deriveYourMove({ ...commit, statusDone: false })).toEqual([]);
      expect(deriveYourMove({ ...commit, canArchive: false })).toEqual([]);
      expect(deriveYourMove({ ...commit, isWorktree: false })).toEqual([]);
      expect(deriveYourMove({ ...commit, agentRunning: true })).toEqual([]);
      expect(deriveYourMove({ ...commit, workOpen: true })).toEqual([]);
      expect(deriveYourMove({ ...commit, inProgress: true })).toEqual([]);
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

    it("waits while anything else is listed", () => {
      // A permission or failure outranks running in the workspace status, hiding another agent's live work.
      const permission: AttentionItem = { kind: "permission", key: "perm", agentId: "a1" };
      const failed: AttentionItem = { kind: "failed", key: "failed", agentId: "a2" };
      expect(rowKinds(deriveYourMove({ ...base, items: [permission] }))).toEqual(["permission"]);
      expect(rowKinds(deriveYourMove({ ...base, items: [failed] }))).toEqual(["failed"]);
      // An open ask ("merge or request review") means the work isn't settled, whatever the card says.
      const plugin: AttentionItem = {
        kind: "plugin",
        key: "x",
        item: summaryItem({ needsYou: true }),
      };
      const ask: AttentionItem = {
        kind: "plugin",
        key: "asks",
        item: summaryItem({ needsYou: true, entries: [{ id: "A1", title: "Merge PR #1" }] }),
      };
      expect(rowKinds(deriveYourMove({ ...base, items: [plugin] }))).toEqual(["plugin"]);
      expect(rowKinds(deriveYourMove({ ...base, items: [ask] }))).toEqual(["entry"]);
      // Nor while an ask is in progress on top of that.
      expect(
        rowKinds(deriveYourMove({ ...base, items: [ask], workOpen: true, inProgress: true })),
      ).toEqual(["entry"]);
    });

    it("waits, with no placeholder row, while an ask is in progress", () => {
      expect(deriveYourMove({ ...base, inProgress: true })).toEqual([]);
      expect(
        deriveYourMove({ ...base, statusDone: false, prMerged: true, inProgress: true }),
      ).toEqual([]);
    });

    it("waits while other work in the workspace is open", () => {
      // A dev server a finished agent left running: In progress lists it, Your move stays empty.
      expect(deriveYourMove({ ...base, workOpen: true })).toEqual([]);
      expect(
        deriveYourMove({ ...base, statusDone: false, prMerged: true, workOpen: true }),
      ).toEqual([]);
    });
  });
});

describe("isWorkStillOpen", () => {
  it("is open while the report is working, blocked or needs you", () => {
    for (const reported of ["working", "blocked", "needs_you"] as const) {
      expect(isWorkStillOpen({ reported, workspaceRunning: false, cardState: null })).toBe(true);
    }
  });

  it("is open while the host still counts the workspace running, with no report", () => {
    // An idle agent waiting on a monitor or subagent, or a shell, with no status card.
    expect(isWorkStillOpen({ reported: null, workspaceRunning: true, cardState: null })).toBe(true);
  });

  it("is open while live work runs, even when the report says done", () => {
    // Agent A merged and said done; agent B, with no card, waits on a long test run.
    expect(isWorkStillOpen({ reported: "done", workspaceRunning: true, cardState: null })).toBe(
      true,
    );
  });

  it("is open while the newest card says working or blocked, even when the report doesn't", () => {
    // A Working card with nothing live for 5 minutes: paseo-status no longer reports it.
    for (const cardState of ["working", "blocked"] as const) {
      expect(isWorkStillOpen({ reported: null, workspaceRunning: false, cardState })).toBe(true);
    }
    expect(isWorkStillOpen({ reported: "done", workspaceRunning: false, cardState: "done" })).toBe(
      false,
    );
  });

  it("is closed once the report is done or empty and nothing runs", () => {
    expect(isWorkStillOpen({ reported: "done", workspaceRunning: false, cardState: null })).toBe(
      false,
    );
    expect(isWorkStillOpen({ reported: null, workspaceRunning: false, cardState: null })).toBe(
      false,
    );
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

describe("newestReplyAt", () => {
  const card = { state: "waiting_on_you" as const, summary: "s", updatedAt: 100 };
  const agent = (lastUserMessageAt: number | null, lastReplyAt?: number | null) => ({
    archivedAt: null,
    lastUserMessageAt: lastUserMessageAt === null ? null : new Date(lastUserMessageAt),
    ...(lastReplyAt === undefined
      ? {}
      : { lastReplyAt: lastReplyAt === null ? null : new Date(lastReplyAt) }),
  });
  const outdated = (lastPromptAt: number | null) =>
    isStatusOutdated({ updatedAt: card.updatedAt, agentRunning: false, lastPromptAt });

  it("ignores a plugin prompt sent after the card", () => {
    // An Asks check at 150 moved lastUserMessageAt but not lastReplyAt.
    const at = newestReplyAt([agent(150, 80)]);
    expect(at).toBe(80);
    expect(outdated(at)).toBe(false);
  });

  it("counts a person's reply sent after the card", () => {
    const at = newestReplyAt([agent(150, 150)]);
    expect(at).toBe(150);
    expect(outdated(at)).toBe(true);
  });

  it("falls back to any prompt on daemons that don't send lastReplyAt", () => {
    const at = newestReplyAt([agent(150)]);
    expect(at).toBe(150);
    expect(outdated(at)).toBe(true);
  });

  it("takes the newest across live agents and skips archived ones", () => {
    expect(newestReplyAt([agent(90, 90), agent(120, 120)])).toBe(120);
    expect(newestReplyAt([{ ...agent(300, 300), archivedAt: new Date(400) }, agent(90, 90)])).toBe(
      90,
    );
    expect(newestReplyAt([agent(null, null)])).toBeNull();
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
    const taken = summaryItem({ itemId: "taken", inProgress: [] });
    expect(partitionSummaryItems([limits, status, asks, waiting, prs, taken])).toEqual({
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

describe("foldsDonePullRequests", () => {
  const row = (key: string) =>
    ({
      key,
      ref: key,
      title: key,
      facts: "",
      tone: "merged",
      url: key,
      isBranchPr: false,
    }) as const;

  it("folds finished PRs while one is open or when there are several", () => {
    expect(foldsDonePullRequests({ open: [row("a")], done: [row("b")] })).toBe(true);
    expect(foldsDonePullRequests({ open: [], done: [row("b"), row("c")] })).toBe(true);
  });

  it("keeps a lone finished PR, and open PRs alone, inline", () => {
    expect(foldsDonePullRequests({ open: [], done: [row("b")] })).toBe(false);
    expect(foldsDonePullRequests({ open: [row("a")], done: [] })).toBe(false);
  });
});

describe("collapsePullRequests", () => {
  const row = (key: string) =>
    ({ key, ref: key, title: key, facts: "", tone: "muted", url: key, isBranchPr: false }) as const;
  const rows = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => row(`${prefix}${i}`));
  const keys = (list: { key: string }[]) => list.map((r) => r.key);

  it("shows a short list whole", () => {
    expect(collapsePullRequests({ open: rows("o", 3), done: [] })).toEqual({
      rows: rows("o", 3),
      hidden: null,
    });
    expect(collapsePullRequests({ open: [], done: [row("d")] }).hidden).toBeNull();
  });

  it("folds only finished PRs when the open ones fit", () => {
    const collapsed = collapsePullRequests({ open: rows("o", 2), done: rows("d", 2) });
    expect(keys(collapsed.rows)).toEqual(["o0", "o1"]);
    expect(collapsed.hidden).toBe("done");
  });

  it("caps a long open list and folds the rest behind Show all", () => {
    const collapsed = collapsePullRequests({ open: rows("o", 50), done: rows("d", 3) });
    expect(keys(collapsed.rows)).toEqual(keys(rows("o", VISIBLE_PULL_REQUESTS)));
    expect(collapsed.hidden).toBe("more");
  });

  it("labels the toggle by what it hides", () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key.replace("panels.overview.", "")}:${String(options?.count)}`;
    const list = { open: rows("o", 6), done: [{ ...row("d"), tone: "merged" as const }] };
    expect(pullRequestsFoldLabel(list, "more", t)).toBe("showAll:7");
    expect(pullRequestsFoldLabel(list, "done", t)).toBe("prsMerged.one:1");
  });

  it("caps a long finished list", () => {
    const collapsed = collapsePullRequests({ open: [], done: rows("d", 9) });
    expect(collapsed.rows).toEqual([]);
    expect(collapsed.hidden).toBe("done");
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
  const ask = (id: string) =>
    ({
      kind: "entry",
      key: `asks:${id}`,
      item: summaryItem({ EntryComponent: () => null }),
      entry: { id, title: id },
    }) as const;
  const failed = { kind: "failed", key: "f", agentId: "x" } as const;
  const rows = [ask("a"), ask("b")];

  it("opens the first row that can expand until the human chooses", () => {
    expect(openMoveKey(rows, undefined)).toBe("asks:a");
  });

  it("opens the first ask below a row that can't expand", () => {
    expect(openMoveKey([failed, ask("a"), ask("b")], undefined)).toBe("asks:a");
  });

  it("opens nothing when no row can expand", () => {
    expect(openMoveKey([failed], undefined)).toBeNull();
  });

  it("keeps only the row the human opened open", () => {
    expect(openMoveKey(rows, "asks:b")).toBe("asks:b");
  });

  it("keeps every row closed after the human closes the open one", () => {
    expect(openMoveKey(rows, null)).toBeNull();
  });

  it("falls back to the first ask once the chosen row is gone", () => {
    expect(openMoveKey(rows, "answered")).toBe("asks:a");
  });

  it("has nothing to open without rows", () => {
    expect(openMoveKey([], undefined)).toBeNull();
  });

  it("keeps an In progress row open instead of the lead, but never opens one by itself", () => {
    expect(openMoveKey(rows, "progress:x", ["progress:x"])).toBe("progress:x");
    expect(openMoveKey([], undefined, ["progress:x"])).toBeNull();
    // The ask left In progress: back to the first ask.
    expect(openMoveKey(rows, "progress:x", [])).toBe("asks:a");
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

  it("keeps one row open across Your move and In progress", () => {
    // Opening an In progress row closes the ask; a new move arriving doesn't take it back.
    expect(pinOpenMove([ask("a")], "progress:x", ["progress:x"])).toBe("progress:x");
    expect(openMoveKey([permission, ask("a")], "progress:x", ["progress:x"])).toBe("progress:x");
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

describe("deriveInProgress", () => {
  const now = 10 * 60 * 60_000;
  const minutes = (count: number) => now - count * 60_000;
  const agent = (patch: Partial<InProgressAgent>): InProgressAgent => ({
    agentId: "lead",
    running: false,
    lastActivityAt: minutes(1),
    subagentsRunning: false,
    subagentsActive: false,
    jobs: [],
    ...patch,
  });
  const asks = (inProgress: WorkspaceSummaryItem["inProgress"]) =>
    summaryItem({ pluginId: "asks", itemId: "asks", inProgress });
  const derive = (input: Partial<Parameters<typeof deriveInProgress>[0]>) =>
    deriveInProgress({ items: [], agents: [], liveBackgroundWork: false, now, ...input });

  it("lists entries and moving agents oldest first, across kinds", () => {
    const rows = derive({
      items: [
        asks([
          { id: "A1", title: "PR #2104", updatedAt: minutes(5), watched: true },
          { id: "A2", title: "Org keys", updatedAt: minutes(240), watched: true },
        ]),
      ],
      agents: [agent({ running: true, lastActivityAt: minutes(60) })],
    });
    expect(rows.map((row) => row.key)).toEqual([
      "progress:asks:asks:A2",
      "agent:lead",
      "progress:asks:asks:A1",
    ]);
  });

  it("lists an agent only while it runs a turn, its subagents work or a job is live", () => {
    expect(derive({ agents: [agent({})] })).toEqual([]);
    // Failed subagents alone are no movement; the track pill still reports them.
    expect(derive({ agents: [agent({ subagentsActive: true })] })).toEqual([]);
    expect(derive({ agents: [agent({ subagentsRunning: true, subagentsActive: true })] })).toEqual([
      expect.objectContaining({ kind: "agent", running: false, subagents: true }),
    ]);
    const job = { id: "j", kind: "shell", description: "merge-queue.sh", startedAt: minutes(120) };
    expect(derive({ agents: [agent({ jobs: [job] })] })).toEqual([
      expect.objectContaining({ kind: "agent", subagents: false, jobs: [job] }),
    ]);
  });

  it("puts an agent's jobs under it, oldest first", () => {
    const jobs = [
      { id: "b", kind: "monitor", description: null, startedAt: minutes(5) },
      { id: "a", kind: "shell", description: "dev", startedAt: minutes(50) },
    ];
    const [row] = derive({ agents: [agent({ running: true, jobs })] });
    expect(row?.kind === "agent" && row.jobs.map((job) => job.id)).toEqual(["a", "b"]);
    expect(jobs.map((job) => job.id)).toEqual(["b", "a"]);
  });

  it("sorts jobs without Array.prototype.toSorted, which Android's Hermes lacks", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
    Reflect.deleteProperty(Array.prototype, "toSorted");
    try {
      const jobs = [
        { id: "b", kind: "monitor", description: null, startedAt: minutes(5) },
        { id: "a", kind: "shell", description: "dev", startedAt: minutes(50) },
      ];
      const [row] = derive({ agents: [agent({ running: true, jobs })] });
      expect(row?.kind === "agent" && row.jobs.map((job) => job.id)).toEqual(["a", "b"]);
    } finally {
      if (descriptor) Reflect.defineProperty(Array.prototype, "toSorted", descriptor);
    }
  });

  describe("nothing moving", () => {
    const stale = { id: "A1", title: "Release", agentId: "lead", updatedAt: minutes(11) };
    const flag = (input: Partial<Parameters<typeof deriveInProgress>[0]>) => {
      const [row] = derive(input);
      return row?.kind === "entry" ? row.nothingMoving : null;
    };

    it("flags an entry nothing has moved for over ten minutes", () => {
      expect(flag({ items: [asks([stale])] })).toBe(true);
      expect(flag({ items: [asks([{ ...stale, agentId: undefined }])] })).toBe(true);
      expect(
        flag({ items: [asks([{ ...stale, updatedAt: now - NOTHING_MOVING_AFTER_MS }])] }),
      ).toBe(false);
    });

    it("doesn't flag it while its agent runs a turn", () => {
      const agents = [agent({ running: true })];
      expect(flag({ items: [asks([stale])], agents })).toBe(false);
      // Another agent's turn moves nothing here.
      expect(flag({ items: [asks([{ ...stale, agentId: "other" }])], agents })).toBe(true);
    });

    it("doesn't flag it while background work is live or something outside watches it", () => {
      expect(flag({ items: [asks([stale])], liveBackgroundWork: true })).toBe(false);
      const job = { id: "j", kind: "shell", description: null, startedAt: minutes(2) };
      expect(flag({ items: [asks([stale])], agents: [agent({ agentId: "x", jobs: [job] })] })).toBe(
        false,
      );
      expect(flag({ items: [asks([{ ...stale, watched: true }])] })).toBe(false);
    });
  });

  it("knows whether any plugin lists work in progress", () => {
    expect(hasInProgressEntries([asks([])])).toBe(false);
    expect(hasInProgressEntries([asks([{ id: "A1", title: "x", updatedAt: 1 }])])).toBe(true);
  });
});

describe("a waiting card that attention reads as blocked", () => {
  const status = summaryItem({
    pluginId: "paseo-status",
    itemId: "status",
    status: { state: "waiting_on_you", summary: "PR #65 needs a reviewer", updatedAt: 5 },
    cards: [{ agentId: "a", state: "waiting_on_you", updatedAt: 5, liveChildren: ["c"] }],
  });
  const asks = summaryItem({
    pluginId: "paseo-asks",
    itemId: "asks",
    inProgress: [{ id: "A1", title: "Request review on PR #65", agentId: "a", updatedAt: 5 }],
  });
  const card = deriveStatusCard(status, [status, asks], () => "Child agent");

  it("reads Blocked in Status and in the lineage word", () => {
    expect(card?.state).toBe("blocked");
    expect(deriveWorkspaceStateWord({ status: card, agents: [] })).toBe("blocked");
  });

  it("lists the ask under Waiting on and the child under the Tree's Blocked by", () => {
    const blockers = statusBlockers(card);
    expect(blockers.filter((blocker) => !isTreeBlocker(blocker))).toEqual([
      { kind: "other", label: "Request review on PR #65" },
    ]);
    expect(blockers.filter(isTreeBlocker)).toEqual([
      { kind: "agent", agentId: "c", label: "Child agent" },
    ]);
  });
});

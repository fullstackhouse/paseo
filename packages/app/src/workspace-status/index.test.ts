import { describe, expect, it } from "vitest";
import type { PluginWorkspaceInProgressEntry } from "@getpaseo/plugin/client";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { deriveEffectiveWorkspaceStatus } from "./index";
import { createReportedWorkLookup } from "./reported-work";

const now = 1_000_000_000;
const STALE = now - 11 * 60_000;

function workspace(patch: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor {
  return {
    createdAt: null,
    lastUserMessageAt: null,
    id: "w",
    projectId: "proj",
    projectDisplayName: "repo",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "feature",
    title: null,
    // A finished turn nobody read: Ready to review by today's rules.
    status: "attention",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...patch,
  };
}

let nextKey = 0;
function item(fields: Partial<WorkspaceSummaryItem>): WorkspaceSummaryItem {
  return {
    entryKey: nextKey++,
    serverId: "s",
    pluginId: "paseo-asks",
    itemId: "asks",
    workspaceId: "w",
    title: "Asks",
    ...fields,
  };
}

let nextEntry = 0;
const ci = (): PluginWorkspaceInProgressEntry => ({
  id: `A${nextEntry++}`,
  title: "PR",
  watched: true,
  updatedAt: now,
});
const review = (): PluginWorkspaceInProgressEntry => ({ ...ci(), waitingOnReview: true });
const stale = (): PluginWorkspaceInProgressEntry => ({
  id: `A${nextEntry++}`,
  title: "Ask",
  updatedAt: STALE,
});

function derive(
  entries: PluginWorkspaceInProgressEntry[],
  options: { workspace?: Partial<WorkspaceDescriptor>; items?: WorkspaceSummaryItem[] } = {},
) {
  const items = [...(options.items ?? [])];
  if (entries.length > 0) items.push(item({ inProgress: entries }));
  return deriveEffectiveWorkspaceStatus({
    serverId: "s",
    workspace: workspace(options.workspace),
    reportedWork: createReportedWorkLookup(items, now),
  });
}

const statusCard = (state: "working" | "done" | "blocked", updatedAt = now) =>
  item({
    pluginId: "paseo-status",
    itemId: "status",
    workState: state,
    status: { state, summary: "s", updatedAt },
  });

describe("deriveEffectiveWorkspaceStatus with in-progress work (S1)", () => {
  it("CI running: Working, with N in progress as the reason", () => {
    expect(derive([ci(), ci(), ci()])).toMatchObject({
      status: "running",
      inProgress: { notMoving: 0, reason: "working", reasonCount: 3 },
    });
  });

  it("review only: Blocked, awaiting review", () => {
    expect(derive([review()])).toMatchObject({
      status: "blocked",
      inProgress: { notMoving: 0, reason: "blocked", reasonCount: 1 },
    });
  });

  it("CI and review mixed: Working", () => {
    expect(derive([ci(), review()])).toMatchObject({
      status: "running",
      inProgress: { reason: "working", reasonCount: 2 },
    });
  });

  it("one stuck among three moving: stays under Working, 1 not moving", () => {
    expect(derive([ci(), ci(), ci(), stale()])).toMatchObject({
      status: "running",
      inProgress: { notMoving: 1, reason: "working", reasonCount: 3 },
    });
  });

  it("stuck at least as many as moving: Ready to review, N not moving, no reason", () => {
    expect(derive([ci(), stale()])).toMatchObject({
      status: "attention",
      inProgress: { notMoving: 1, reason: null },
    });
    expect(derive([stale(), stale()], { workspace: { status: "done" } })).toMatchObject({
      status: "attention",
      inProgress: { notMoving: 2, reason: null },
    });
  });

  it("a Done card loses to moving work", () => {
    expect(derive([ci()], { items: [statusCard("done")] })).toMatchObject({
      status: "running",
      inProgress: { reason: "working", reasonCount: 1 },
    });
  });

  it("all items finished: today's rules", () => {
    const result = derive([], { items: [statusCard("done")] });
    expect(result.status).toBe("done");
    expect(result.inProgress).toBeUndefined();
    expect(derive([]).status).toBe("attention");
  });
});

describe("deriveEffectiveWorkspaceStatus precedence over in-progress work", () => {
  it("a permission prompt or a failure wins", () => {
    for (const status of ["needs_input", "failed"] as const) {
      expect(derive([ci()], { workspace: { status } })).toMatchObject({
        status,
        inProgress: { reason: null },
      });
    }
  });

  it("a running turn stays Working with no in-progress reason and no stuck entries", () => {
    expect(derive([ci(), stale()], { workspace: { status: "running" } })).toMatchObject({
      status: "running",
      inProgress: { notMoving: 0, reason: null },
    });
  });

  it("a dev server's background work counts as live work but is not the reason", () => {
    expect(
      derive([review(), stale()], {
        workspace: { status: "running", runningFromBackgroundWork: true },
      }),
    ).toMatchObject({ status: "running", inProgress: { notMoving: 0, reason: null } });
  });

  it("an open ask wins over moving work", () => {
    expect(derive([ci()], { items: [item({ itemId: "open", needsYou: true })] })).toMatchObject({
      status: "attention",
      inProgress: { reason: null },
    });
  });

  it("a fresh Working card is already the reason, so no in-progress badge", () => {
    expect(derive([ci()], { items: [statusCard("working")] })).toMatchObject({
      status: "running",
      inProgress: { reason: null },
    });
  });

  it("a Working card beats work waiting on a review, by the existing rank", () => {
    expect(derive([review()], { items: [statusCard("working")] }).status).toBe("running");
  });

  it("a manual move holds until a newer status", () => {
    const setAt = new Date(now).toISOString();
    const manualGroup = { group: "done" as const, setAt };
    expect(derive([ci()], { workspace: { manualGroup } })).toMatchObject({
      status: "done",
      inProgress: { reason: null },
    });
    expect(
      derive([ci()], { workspace: { manualGroup }, items: [statusCard("blocked", now + 1)] }),
    ).toMatchObject({ status: "running", inProgress: { reason: "working" } });
  });
});

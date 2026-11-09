import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { agentSearchFields, buildArchivedSearchRows } from "./archived-search";
import { filterAndRankBuiltInResults } from "./results";

function historyAgent(input: {
  id: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  branch: string;
  lastActivityAt: Date;
  archivedAt?: Date | null;
}): AggregatedAgent {
  return {
    id: input.id,
    serverId: "host",
    serverLabel: "Host",
    title: input.title,
    status: "closed",
    lastActivityAt: input.lastActivityAt,
    cwd: `/worktrees/${input.workspaceId}`,
    workspaceId: input.workspaceId,
    provider: "claude",
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: input.archivedAt === undefined ? input.lastActivityAt : input.archivedAt,
    createdAt: input.lastActivityAt,
    labels: {},
    projectPlacement: {
      projectKey: "groomershop",
      projectName: "groomershop-mercato",
      workspaceName: input.workspaceName,
      checkout: {
        cwd: `/worktrees/${input.workspaceId}`,
        isGit: true,
        isPaseoOwnedWorktree: true,
        currentBranch: input.branch,
        remoteUrl: null,
        mainRepoRoot: "/repo",
      },
    },
  } as AggregatedAgent;
}

const opened: string[] = [];
function build(historyAgents: AggregatedAgent[], listed: { workspaces?: string[] } = {}) {
  return buildArchivedSearchRows({
    historyAgents,
    listedWorkspaceKeys: new Set(listed.workspaces ?? []),
    listedAgentKeys: new Set(),
    showHost: false,
    agentTitle: (agent) => agent.title ?? "Agent",
    openWorkspace: (serverId, workspaceId) => () => opened.push(`${serverId}:${workspaceId}`),
    openAgent: (serverId, agentId) => () => opened.push(`${serverId}:${agentId}`),
  });
}

const grantMax = historyAgent({
  id: "agent-1",
  title: "Chciałbym dać Maksowi dostęp do prod",
  workspaceId: "ws-grant",
  workspaceName: "Grant Max access to production",
  branch: "docs/offboarding-maks",
  lastActivityAt: new Date("2026-11-09T10:00:00Z"),
});

describe("buildArchivedSearchRows", () => {
  it("turns an archived workspace History found into a labelled workspace row", () => {
    const { workspaces } = build([grantMax]);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({
      id: "workspace:host:ws-grant",
      title: "Grant Max access to production",
      subtitle: "groomershop-mercato · docs/offboarding-maks",
      archived: true,
    });
    workspaces[0].run();
    expect(opened.at(-1)).toBe("host:ws-grant");
  });

  it("finds the archived workspace for the query from the report", () => {
    const { workspaces } = build([grantMax]);
    const ranked = filterAndRankBuiltInResults(workspaces, "grant max", (row) => ({
      visible: [row.title, row.subtitle],
      hidden: [],
    }));
    expect(ranked.map((row) => row.id)).toEqual(["workspace:host:ws-grant"]);
  });

  it("keeps one row per workspace, from its most recent agent", () => {
    const older = historyAgent({
      id: "agent-0",
      title: "Earlier attempt",
      workspaceId: "ws-grant",
      workspaceName: "Grant Max access to production",
      branch: "docs/old",
      lastActivityAt: new Date("2026-11-08T10:00:00Z"),
    });
    const { workspaces, agents } = build([older, grantMax]);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].subtitle).toContain("docs/offboarding-maks");
    expect(agents.map((row) => row.id)).toEqual(["agent:host:agent-0", "agent:host:agent-1"]);
  });

  it("adds no workspace row for a workspace the command center already lists", () => {
    const { workspaces, agents } = build([grantMax], { workspaces: ["host:ws-grant"] });
    expect(workspaces).toEqual([]);
    expect(agents.map((row) => row.archived)).toEqual([true]);
  });

  it("keeps an archived agent History matched only on its branch", () => {
    const { agents } = build([grantMax]);
    const ranked = filterAndRankBuiltInResults(agents, "offboarding", agentSearchFields);
    expect(ranked.map((row) => row.id)).toEqual(["agent:host:agent-1"]);
  });

  it("ignores agents History returned that are not archived", () => {
    const live = historyAgent({
      id: "agent-live",
      title: "Background sync",
      workspaceId: "ws-background",
      workspaceName: "Background sync",
      branch: "main",
      lastActivityAt: new Date("2026-11-09T10:00:00Z"),
      archivedAt: null,
    });
    expect(build([live])).toEqual({ workspaces: [], agents: [] });
  });
});

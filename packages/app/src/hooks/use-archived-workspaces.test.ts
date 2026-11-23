import type { ArchivedWorkspaceEntry } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import {
  fetchArchivedWorkspacesBatch,
  filterArchivedWorkspaces,
  type ArchivedWorkspacesHost,
} from "./use-archived-workspaces";

function entry(
  workspaceId: string,
  archivedAt: string,
  overrides: Partial<ArchivedWorkspaceEntry> = {},
): ArchivedWorkspaceEntry {
  return {
    workspaceId,
    name: workspaceId,
    projectId: "project",
    projectDisplayName: "paseo",
    cwd: `/repo/${workspaceId}`,
    workspaceKind: "worktree",
    branch: workspaceId,
    archivedAt,
    ...overrides,
  };
}

function host(serverId: string, result: ArchivedWorkspaceEntry[] | Error): ArchivedWorkspacesHost {
  return {
    serverId,
    serverLabel: `${serverId} label`,
    client: {
      listArchivedWorkspaces: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

describe("fetchArchivedWorkspacesBatch", () => {
  it("merges hosts newest archived first and names the host that failed", async () => {
    const batch = await fetchArchivedWorkspacesBatch([
      host("laptop", [entry("old", "2026-11-01T00:00:00.000Z")]),
      host("desktop", [entry("new", "2026-11-20T00:00:00.000Z")]),
      host("offline", new Error("timeout")),
    ]);

    expect(
      batch.workspaces.map((workspace) => [workspace.workspaceId, workspace.serverId]),
    ).toEqual([
      ["new", "desktop"],
      ["old", "laptop"],
    ]);
    expect(batch.failedHosts).toEqual([
      { serverId: "offline", serverName: "offline label", reason: "failed" },
    ]);
  });

  it("fails when no host answers, so the screen shows an error instead of an empty list", async () => {
    await expect(fetchArchivedWorkspacesBatch([host("a", new Error("down"))])).rejects.toThrow(
      "No connected hosts could load archived workspaces",
    );
  });
});

describe("filterArchivedWorkspaces", () => {
  const workspaces = [
    { ...entry("fix-login", "2026-11-20T00:00:00.000Z"), serverId: "a", serverLabel: "a" },
    {
      ...entry("overview", "2026-11-19T00:00:00.000Z", {
        name: "Rework Overview tab",
        projectDisplayName: "casteo",
        branch: null,
      }),
      serverId: "a",
      serverLabel: "a",
    },
  ];

  it("keeps everything for an empty query", () => {
    expect(filterArchivedWorkspaces(workspaces, "  ")).toHaveLength(2);
  });

  it("matches across name, project and branch", () => {
    expect(
      filterArchivedWorkspaces(workspaces, "overview casteo").map((w) => w.workspaceId),
    ).toEqual(["overview"]);
    expect(filterArchivedWorkspaces(workspaces, "fix-login").map((w) => w.workspaceId)).toEqual([
      "fix-login",
    ]);
    expect(filterArchivedWorkspaces(workspaces, "nothing-like-this")).toEqual([]);
  });
});

import type { ArchivedWorkspaceEntry } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import {
  ARCHIVED_WORKSPACES_LIMIT,
  classifyArchivedWorkspacesHosts,
  fetchArchivedWorkspacesBatch,
  type ArchivedWorkspacesHost,
} from "./use-archived-workspaces";

function entry(workspaceId: string, archivedAt: string): ArchivedWorkspaceEntry {
  return {
    workspaceId,
    name: workspaceId,
    projectId: "project",
    projectDisplayName: "paseo",
    branch: workspaceId,
    archivedAt,
  };
}

interface ListOptions {
  search?: string;
  limit?: number;
}

function host(
  serverId: string,
  result: { workspaces: ArchivedWorkspaceEntry[]; truncated: boolean } | Error,
  calls: ListOptions[] = [],
): ArchivedWorkspacesHost {
  return {
    serverId,
    serverLabel: `${serverId} label`,
    client: {
      listArchivedWorkspaces: async (options: ListOptions = {}) => {
        calls.push(options);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

describe("fetchArchivedWorkspacesBatch", () => {
  it("merges hosts newest archived first and names the host that failed", async () => {
    const batch = await fetchArchivedWorkspacesBatch({
      search: "",
      hosts: [
        host("laptop", {
          workspaces: [entry("old", "2026-11-01T00:00:00.000Z")],
          truncated: false,
        }),
        host("desktop", {
          workspaces: [entry("new", "2026-11-20T00:00:00.000Z")],
          truncated: true,
        }),
        host("offline", new Error("timeout")),
      ],
    });

    expect(
      batch.workspaces.map((workspace) => [workspace.workspaceId, workspace.serverId]),
    ).toEqual([
      ["new", "desktop"],
      ["old", "laptop"],
    ]);
    expect(batch.truncated).toBe(true);
    expect(batch.failedHosts).toEqual([
      { serverId: "offline", serverName: "offline label", reason: "failed" },
    ]);
  });

  it("asks each host to search and cap on its side", async () => {
    const calls: ListOptions[] = [];
    await fetchArchivedWorkspacesBatch({
      search: "  login  ",
      hosts: [host("a", { workspaces: [], truncated: false }, calls)],
    });
    expect(calls).toEqual([{ search: "login", limit: ARCHIVED_WORKSPACES_LIMIT }]);
  });

  it("fails when no host answers, so the screen shows an error instead of an empty list", async () => {
    await expect(
      fetchArchivedWorkspacesBatch({ search: "", hosts: [host("a", new Error("down"))] }),
    ).rejects.toThrow("No connected hosts could load archived workspaces");
  });
});

describe("classifyArchivedWorkspacesHosts", () => {
  const client = { listArchivedWorkspaces: async () => ({ workspaces: [], truncated: false }) };
  const hosts = [
    { serverId: "current", label: "Current" },
    { serverId: "old", label: "Old" },
    { serverId: "offline", label: "Offline" },
    { serverId: "offline-old", label: "Offline old" },
  ];
  const classify = (serverId: string | null) =>
    classifyArchivedWorkspacesHosts({
      hosts,
      serverId,
      supportingServerIds: new Set(["current", "offline"]),
      getClient: () => client,
      isConnected: (id) => !id.startsWith("offline"),
    });

  it("asks only connected hosts that support it and says why the others are missing", () => {
    const { targetHosts, skippedHosts } = classify(null);
    expect(targetHosts.map((target) => target.serverId)).toEqual(["current"]);
    expect(skippedHosts).toEqual([
      { serverId: "old", serverName: "Old", reason: "needsUpdate" },
      { serverId: "offline", serverName: "Offline", reason: "unreachable" },
      { serverId: "offline-old", serverName: "Offline old", reason: "unreachable" },
    ]);
  });

  it("narrows to the selected host", () => {
    const { targetHosts, skippedHosts } = classify("old");
    expect(targetHosts).toEqual([]);
    expect(skippedHosts).toEqual([{ serverId: "old", serverName: "Old", reason: "needsUpdate" }]);
  });
});

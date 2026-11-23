import type { ArchivedWorkspaceEntry } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { RECALL_MATCH_OPTIONS, scoreTextFields } from "@getpaseo/protocol/search/text-match";
import { useMemo, useSyncExternalStore } from "react";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

const ALL_HOSTS_FAILED_MESSAGE = "No connected hosts could load archived workspaces";

export interface ArchivedWorkspace extends ArchivedWorkspaceEntry {
  serverId: string;
  serverLabel: string;
}

export interface ArchivedWorkspacesHost {
  serverId: string;
  serverLabel: string;
  client: Pick<DaemonClient, "listArchivedWorkspaces">;
}

/** A host whose archived workspaces are missing from the list, and why. */
export interface ArchivedWorkspacesHostIssue {
  serverId: string;
  serverName: string;
  reason: "unreachable" | "failed" | "needsUpdate";
}

export interface ArchivedWorkspacesBatch {
  workspaces: ArchivedWorkspace[];
  failedHosts: ArchivedWorkspacesHostIssue[];
}

export async function fetchArchivedWorkspacesBatch(
  hosts: readonly ArchivedWorkspacesHost[],
): Promise<ArchivedWorkspacesBatch> {
  const settled = await Promise.allSettled(
    hosts.map((host) => host.client.listArchivedWorkspaces()),
  );
  if (hosts.length > 0 && settled.every((result) => result.status === "rejected")) {
    throw new Error(ALL_HOSTS_FAILED_MESSAGE);
  }
  const workspaces: ArchivedWorkspace[] = [];
  const failedHosts: ArchivedWorkspacesHostIssue[] = [];
  settled.forEach((result, index) => {
    const host = hosts[index];
    if (result.status === "rejected") {
      failedHosts.push({ serverId: host.serverId, serverName: host.serverLabel, reason: "failed" });
      return;
    }
    for (const entry of result.value) {
      workspaces.push({ ...entry, serverId: host.serverId, serverLabel: host.serverLabel });
    }
  });
  workspaces.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  return { workspaces, failedHosts };
}

/** Typo-tolerant, like History's agent search; every query word must hit some field. */
export function filterArchivedWorkspaces(
  workspaces: readonly ArchivedWorkspace[],
  search: string,
): ArchivedWorkspace[] {
  const query = search.trim();
  if (!query) return [...workspaces];
  return workspaces.filter(
    (workspace) =>
      scoreTextFields(
        query,
        [workspace.name, workspace.projectDisplayName, workspace.branch ?? ""],
        RECALL_MATCH_OPTIONS,
      ) !== null,
  );
}

export interface ArchivedWorkspacesResult {
  /** At least one target host can list archived workspaces. */
  isSupported: boolean;
  workspaces: ArchivedWorkspace[];
  isInitialLoad: boolean;
  isError: boolean;
  hostIssues: ArchivedWorkspacesHostIssue[];
  refresh: () => Promise<void>;
}

export function useArchivedWorkspaces(options: {
  serverId: string | null;
  enabled: boolean;
  search: string;
}): ArchivedWorkspacesResult {
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  // A joined string keeps the selector stable between unrelated session-store updates.
  const supportingServerIds = useSessionStore((store) =>
    Object.entries(store.sessions)
      .filter(([, session]) => session?.serverInfo?.features?.archivedWorkspaces === true)
      .map(([serverId]) => serverId)
      .sort()
      .join("\n"),
  );

  const { targetHosts, skippedHosts } = useMemo(() => {
    void runtimeVersion;
    const supporting = new Set(supportingServerIds.split("\n"));
    const targets = options.serverId
      ? daemons.filter((daemon) => daemon.serverId === options.serverId)
      : daemons;
    const hosts: ArchivedWorkspacesHost[] = [];
    const skipped: ArchivedWorkspacesHostIssue[] = [];
    for (const daemon of targets) {
      const client = runtime.getClient(daemon.serverId);
      const serverName = daemon.label;
      if (!client || !isHostRuntimeConnected(runtime.getSnapshot(daemon.serverId))) {
        skipped.push({ serverId: daemon.serverId, serverName, reason: "unreachable" });
      } else if (!supporting.has(daemon.serverId)) {
        skipped.push({ serverId: daemon.serverId, serverName, reason: "needsUpdate" });
      } else {
        hosts.push({ serverId: daemon.serverId, serverLabel: serverName, client });
      }
    }
    return { targetHosts: hosts, skippedHosts: skipped };
  }, [daemons, options.serverId, runtime, runtimeVersion, supportingServerIds]);

  const query = useFetchQuery({
    queryKey: ["archivedWorkspaces", ...targetHosts.map((host) => host.serverId)],
    dataShape: "list",
    staleTimeMs: 5_000,
    enabled: options.enabled && targetHosts.length > 0,
    queryFn: () => fetchArchivedWorkspacesBatch(targetHosts),
  });

  const workspaces = useMemo(
    () => filterArchivedWorkspaces(query.data?.workspaces ?? [], options.search),
    [options.search, query.data],
  );
  const hostIssues = useMemo(
    () => [...skippedHosts, ...(query.data?.failedHosts ?? [])],
    [query.data, skippedHosts],
  );
  const { refetch } = query;

  return {
    isSupported: supportingServerIds.length > 0,
    workspaces,
    isInitialLoad: targetHosts.length > 0 && query.isPending,
    isError: query.isError,
    hostIssues,
    refresh: async () => {
      await refetch();
    },
  };
}

import type { ArchivedWorkspaceEntry } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useMemo, useSyncExternalStore } from "react";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

const ALL_HOSTS_FAILED_MESSAGE = "No connected hosts could load archived workspaces";
/** Per host. Archives only grow; older ones are reached by searching. */
export const ARCHIVED_WORKSPACES_LIMIT = 200;

export interface ArchivedWorkspace extends ArchivedWorkspaceEntry {
  serverId: string;
  serverLabel: string;
}

type ArchivedWorkspacesClient = Pick<DaemonClient, "listArchivedWorkspaces">;

export interface ArchivedWorkspacesHost {
  serverId: string;
  serverLabel: string;
  client: ArchivedWorkspacesClient;
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
  /** Some host had more matches than it sent. */
  truncated: boolean;
}

export async function fetchArchivedWorkspacesBatch(input: {
  hosts: readonly ArchivedWorkspacesHost[];
  search: string;
}): Promise<ArchivedWorkspacesBatch> {
  const { hosts } = input;
  const search = input.search.trim();
  const settled = await Promise.allSettled(
    hosts.map((host) =>
      host.client.listArchivedWorkspaces({
        ...(search ? { search } : {}),
        limit: ARCHIVED_WORKSPACES_LIMIT,
      }),
    ),
  );
  if (hosts.length > 0 && settled.every((result) => result.status === "rejected")) {
    throw new Error(ALL_HOSTS_FAILED_MESSAGE);
  }
  const workspaces: ArchivedWorkspace[] = [];
  const failedHosts: ArchivedWorkspacesHostIssue[] = [];
  let truncated = false;
  settled.forEach((result, index) => {
    const host = hosts[index];
    if (result.status === "rejected") {
      failedHosts.push({ serverId: host.serverId, serverName: host.serverLabel, reason: "failed" });
      return;
    }
    truncated ||= result.value.truncated;
    for (const entry of result.value.workspaces) {
      workspaces.push({ ...entry, serverId: host.serverId, serverLabel: host.serverLabel });
    }
  });
  workspaces.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  return { workspaces, failedHosts, truncated };
}

/** Which hosts can be asked, and why the rest are missing from the list. */
export function classifyArchivedWorkspacesHosts(input: {
  hosts: readonly { serverId: string; label: string }[];
  serverId: string | null;
  supportingServerIds: ReadonlySet<string>;
  getClient: (serverId: string) => ArchivedWorkspacesClient | null;
  isConnected: (serverId: string) => boolean;
}): { targetHosts: ArchivedWorkspacesHost[]; skippedHosts: ArchivedWorkspacesHostIssue[] } {
  const targets = input.serverId
    ? input.hosts.filter((host) => host.serverId === input.serverId)
    : input.hosts;
  const targetHosts: ArchivedWorkspacesHost[] = [];
  const skippedHosts: ArchivedWorkspacesHostIssue[] = [];
  for (const host of targets) {
    const client = input.getClient(host.serverId);
    const serverName = host.label;
    if (!client || !input.isConnected(host.serverId)) {
      skippedHosts.push({ serverId: host.serverId, serverName, reason: "unreachable" });
    } else if (!input.supportingServerIds.has(host.serverId)) {
      skippedHosts.push({ serverId: host.serverId, serverName, reason: "needsUpdate" });
    } else {
      targetHosts.push({ serverId: host.serverId, serverLabel: serverName, client });
    }
  }
  return { targetHosts, skippedHosts };
}

export interface ArchivedWorkspacesResult {
  workspaces: ArchivedWorkspace[];
  /** No host could be asked, so an empty list says nothing about what is archived. */
  nothingSearched: boolean;
  truncated: boolean;
  isInitialLoad: boolean;
  isError: boolean;
  hostIssues: ArchivedWorkspacesHostIssue[];
  refresh: () => Promise<void>;
}

/** Any host can list archived workspaces; hosts that can't are named inside the view. */
export function useAnyHostSupportsArchivedWorkspaces(): boolean {
  return useSessionStore((store) =>
    Object.values(store.sessions).some(
      (session) => session?.serverInfo?.features?.archivedWorkspaces === true,
    ),
  );
}

export function useArchivedWorkspaces(options: {
  serverId: string | null;
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
    return classifyArchivedWorkspacesHosts({
      hosts: daemons,
      serverId: options.serverId,
      supportingServerIds: new Set(supportingServerIds.split("\n")),
      getClient: (serverId) => runtime.getClient(serverId),
      isConnected: (serverId) => isHostRuntimeConnected(runtime.getSnapshot(serverId)),
    });
  }, [daemons, options.serverId, runtime, runtimeVersion, supportingServerIds]);

  const search = options.search.trim();
  const query = useFetchQuery({
    queryKey: ["archivedWorkspaces", search, ...targetHosts.map((host) => host.serverId)],
    dataShape: "list",
    staleTimeMs: 5_000,
    enabled: targetHosts.length > 0,
    queryFn: () => fetchArchivedWorkspacesBatch({ hosts: targetHosts, search }),
  });

  const hostIssues = useMemo(
    () => [...skippedHosts, ...(query.data?.failedHosts ?? [])],
    [query.data, skippedHosts],
  );
  const { refetch } = query;

  return {
    workspaces: query.data?.workspaces ?? [],
    nothingSearched: targetHosts.length === 0,
    truncated: query.data?.truncated ?? false,
    isInitialLoad: targetHosts.length > 0 && query.isPending,
    isError: query.isError,
    hostIssues,
    refresh: async () => {
      await refetch();
    },
  };
}

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useCallback, useMemo } from "react";
import invariant from "tiny-invariant";
import { useFetchQuery } from "@/data/query";
import { queryClient } from "@/data/query-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { buildAgentDirectoryState } from "@/utils/agent-directory-sync";

const QUERY_ROOT = ["workspaceRecentlyClosedAgents"] as const;
const PAGE_LIMIT = 200;
/** The launcher lists the newest few; older ones stay in History. */
export const RECENTLY_CLOSED_LIMIT = 5;

export interface RecentlyClosedAgent {
  id: string;
  title: string | null;
  provider: string;
  archivedAt: Date;
}

/**
 * The workspace's archived top-level agents, newest archive first. Closing an agent's tab archives
 * it, so these are its recently closed tabs. The live session store wins over the fetched page, so
 * an agent reopened anywhere drops out without a refetch. Subagents stay out: they come back with
 * their parent's track.
 */
export function selectRecentlyClosedAgents(input: {
  workspaceId: string;
  fetched: Iterable<Agent>;
  live: Iterable<Agent> | undefined;
}): RecentlyClosedAgent[] {
  const byId = new Map<string, Agent>();
  for (const agent of input.fetched) {
    if (agent.workspaceId === input.workspaceId) byId.set(agent.id, agent);
  }
  for (const agent of input.live ?? []) {
    if (agent.workspaceId === input.workspaceId) byId.set(agent.id, agent);
  }
  const rows: RecentlyClosedAgent[] = [];
  for (const agent of byId.values()) {
    if (!agent.archivedAt || agent.parentAgentId) continue;
    rows.push({
      id: agent.id,
      title: agent.title,
      provider: agent.provider,
      archivedAt: agent.archivedAt,
    });
  }
  return rows
    .sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime())
    .slice(0, RECENTLY_CLOSED_LIMIT);
}

export async function fetchWorkspaceAgents(input: {
  client: Pick<DaemonClient, "fetchAgentHistory">;
  serverId: string;
  workspaceId: string;
}): Promise<Agent[]> {
  const agents: Agent[] = [];
  let cursor: string | null = null;
  do {
    const payload = await input.client.fetchAgentHistory({
      filter: { workspaceIds: [input.workspaceId], includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: cursor ? { limit: PAGE_LIMIT, cursor } : { limit: PAGE_LIMIT },
    });
    const state = buildAgentDirectoryState({ serverId: input.serverId, entries: payload.entries });
    agents.push(...state.agents.values());
    cursor = payload.pageInfo.hasMore ? payload.pageInfo.nextCursor : null;
  } while (cursor);
  return agents;
}

export interface WorkspaceRecentlyClosed {
  agents: RecentlyClosedAgent[];
  /** Unarchives the agent. Rejects with the host's error. */
  reopen: (agentId: string) => Promise<void>;
}

/** Hosts without `features.agentWorkspaceFilter` list nothing: they can't list one workspace's agents. */
export function useWorkspaceRecentlyClosed(
  serverId: string,
  workspaceId: string,
): WorkspaceRecentlyClosed {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentWorkspaceFilter === true,
  );
  const liveAgents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const enabled = supported && isConnected && client !== null;
  const queryKey = useMemo(() => [...QUERY_ROOT, serverId, workspaceId], [serverId, workspaceId]);
  const query = useFetchQuery({
    queryKey,
    dataShape: "list",
    staleTimeMs: 5_000,
    enabled,
    queryFn: () => {
      invariant(client, "The query runs only while enabled");
      return fetchWorkspaceAgents({ client, serverId, workspaceId });
    },
  });
  const agents = useMemo(
    () =>
      enabled
        ? selectRecentlyClosedAgents({
            workspaceId,
            fetched: query.data ?? [],
            live: liveAgents?.values(),
          })
        : [],
    [enabled, liveAgents, query.data, workspaceId],
  );

  const reopen = useCallback(
    async (agentId: string) => {
      invariant(client, "Reopen is offered only while the host is connected");
      try {
        await client.refreshAgent(agentId);
      } finally {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [client, queryKey],
  );

  return { agents, reopen };
}

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useCallback, useMemo, useState } from "react";
import invariant from "tiny-invariant";
import { useFetchQuery } from "@/data/query";
import { queryClient } from "@/data/query-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { buildAgentDirectoryState } from "@/utils/agent-directory-sync";
import { toErrorMessage } from "@/utils/error-messages";

const QUERY_ROOT = ["workspaceArchivedAgents"] as const;
const PAGE_LIMIT = 200;

export interface ArchivedAgentRow {
  id: string;
  title: string | null;
  provider: string;
  archivedAt: Date;
}

/**
 * The workspace's archived top-level agents, newest archive first. The live session store wins
 * over the fetched page, so an agent unarchived here (or anywhere) drops out without a refetch.
 * Subagents stay out: they come back with their parent's track.
 */
export function selectArchivedAgentRows(input: {
  workspaceId: string;
  fetched: Iterable<Agent>;
  live: Iterable<Agent> | undefined;
}): ArchivedAgentRow[] {
  const byId = new Map<string, Agent>();
  for (const agent of input.fetched) byId.set(agent.id, agent);
  for (const agent of input.live ?? []) {
    if (agent.workspaceId === input.workspaceId) byId.set(agent.id, agent);
  }
  const rows: ArchivedAgentRow[] = [];
  for (const agent of byId.values()) {
    if (agent.workspaceId !== input.workspaceId) continue;
    if (!agent.archivedAt || agent.parentAgentId) continue;
    rows.push({
      id: agent.id,
      title: agent.title,
      provider: agent.provider,
      archivedAt: agent.archivedAt,
    });
  }
  return rows.sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime());
}

export async function fetchWorkspaceArchivedAgents(input: {
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

export interface WorkspaceArchivedAgents {
  rows: ArchivedAgentRow[];
  /** Ids being unarchived right now; their buttons show progress. */
  pendingIds: ReadonlySet<string>;
  error: string | null;
  unarchive: (agentIds: string[]) => Promise<void>;
}

/** Hosts without `features.agentWorkspaceFilter` show nothing: they can't list one workspace's agents. */
export function useWorkspaceArchivedAgents(
  serverId: string,
  workspaceId: string,
): WorkspaceArchivedAgents {
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
      return fetchWorkspaceArchivedAgents({ client, serverId, workspaceId });
    },
  });
  const rows = useMemo(
    () =>
      enabled
        ? selectArchivedAgentRows({
            workspaceId,
            fetched: query.data ?? [],
            live: liveAgents?.values(),
          })
        : [],
    [enabled, liveAgents, query.data, workspaceId],
  );

  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const unarchive = useCallback(
    async (agentIds: string[]) => {
      if (!client || !isConnected || agentIds.length === 0) return;
      setError(null);
      setPendingIds((current) => new Set([...current, ...agentIds]));
      try {
        // One at a time: each resumes a provider session, and a failure stops the rest.
        for (const agentId of agentIds) {
          await client.refreshAgent(agentId);
        }
      } catch (unarchiveError) {
        setError(toErrorMessage(unarchiveError));
      } finally {
        setPendingIds((current) => new Set([...current].filter((id) => !agentIds.includes(id))));
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [client, isConnected, queryKey],
  );

  return { rows, pendingIds, error, unarchive };
}

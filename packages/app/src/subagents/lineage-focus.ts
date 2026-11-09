import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { useMemo } from "react";
import { getFocusedAgentId } from "@/plugins/command-center/context";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { isWorkspaceRootAgent } from "./workspace-root-policy";

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

/** The workspace's most recently active root agent: whose lineage to show when no agent tab is focused. */
export function selectWorkspaceRootAgentId(
  state: SessionStoreSnapshot,
  serverId: string,
  workspaceId: string,
): string | null {
  const session = state.sessions[serverId];
  if (!session) return null;
  const target = normalizeWorkspaceOpaqueId(workspaceId);
  let best: { id: string; activity: number } | null = null;
  for (const agent of session.agents.values()) {
    if (agent.archivedAt || normalizeWorkspaceOpaqueId(agent.workspaceId) !== target) continue;
    const parent = agent.parentAgentId ? session.agents.get(agent.parentAgentId) : undefined;
    if (!isWorkspaceRootAgent(agent, parent)) continue;
    const activity = agent.lastActivityAt.getTime();
    if (!best || activity > best.activity) best = { id: agent.id, activity };
  }
  return best?.id ?? null;
}

/** Selectors run on every stream tick; recompute only when the host's agent map changes. */
function createWorkspaceRootAgentIdSelector(serverId: string, workspaceId: string) {
  let previousAgents: unknown = null;
  let previous: string | null = null;
  return (state: SessionStoreSnapshot): string | null => {
    const agents = state.sessions[serverId]?.agents ?? null;
    if (agents !== null && agents === previousAgents) return previous;
    previousAgents = agents;
    previous = selectWorkspaceRootAgentId(state, serverId, workspaceId);
    return previous;
  };
}

/**
 * Whose lineage the workspace shows: the agent in the focused tab, else the workspace's root agent.
 * Selecting an Explorer tab never moves workspace focus, so the Lineage tab itself doesn't reset it.
 */
export function useLineageFocus(serverId: string, workspaceId: string): AgentAddress | null {
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const focusedAgentId = useWorkspaceLayoutStore((state) =>
    getFocusedAgentId(workspaceKey ? (state.layoutByWorkspace[workspaceKey] ?? null) : null),
  );
  const selectRootAgentId = useMemo(
    () => createWorkspaceRootAgentIdSelector(serverId, workspaceId),
    [serverId, workspaceId],
  );
  const rootAgentId = useSessionStore(selectRootAgentId);
  const agentId = focusedAgentId ?? rootAgentId;
  return useMemo(() => (agentId ? { serverId, agentId } : null), [agentId, serverId]);
}

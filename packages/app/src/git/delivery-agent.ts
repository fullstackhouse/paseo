import { isWorkspaceRootAgent } from "@/subagents/policies";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export interface DeliveryAgentCandidate {
  id: string;
  workspaceId?: string;
  archivedAt?: Date | null;
  parentAgentId: string | null;
  lastActivityAt: Date;
}

/**
 * The agent that should deliver the workspace's branch: the focused agent tab
 * when it belongs to the workspace, else the workspace's most recently active
 * root agent (`isWorkspaceRootAgent`: no parent, or a parent in another
 * workspace). Null when the workspace has none.
 */
export function pickDeliveryAgentId(input: {
  agents: Iterable<DeliveryAgentCandidate>;
  workspaceId: string;
  focusedAgentId: string | null;
}): string | null {
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  const agents = [...input.agents];
  const agentsById = Object.fromEntries(agents.map((agent) => [agent.id, agent]));
  const eligible = agents.filter(
    (agent) =>
      normalizeWorkspaceOpaqueId(agent.workspaceId) === workspaceId &&
      !agent.archivedAt &&
      isWorkspaceRootAgent(
        agent,
        agent.parentAgentId ? agentsById[agent.parentAgentId] : undefined,
      ),
  );
  if (input.focusedAgentId && eligible.some((agent) => agent.id === input.focusedAgentId)) {
    return input.focusedAgentId;
  }
  let latest: DeliveryAgentCandidate | null = null;
  for (const agent of eligible) {
    if (!latest || agent.lastActivityAt.getTime() > latest.lastActivityAt.getTime()) {
      latest = agent;
    }
  }
  return latest?.id ?? null;
}

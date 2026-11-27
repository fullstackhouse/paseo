import type { Agent } from "@/stores/session-store";

type DelegationAgent = Pick<Agent, "parentAgentId" | "workspaceId" | "archivedAt" | "background">;

const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * Workspaces that only serve another workspace's agent: every live agent in them is a subagent
 * (attached or delegated) of an agent in another workspace. The sidebar hides them; the parent's
 * subagents track and the Lineage tab reach them. An agent whose parent isn't loaded counts as a
 * root, so a workspace is never hidden behind an agent you can't open.
 */
export function buildDelegatedWorkspaceIds(
  agents: ReadonlyMap<string, DelegationAgent>,
): ReadonlySet<string> {
  const delegated = new Set<string>();
  const rooted = new Set<string>();
  for (const agent of agents.values()) {
    const workspaceId = agent.workspaceId;
    if (!workspaceId || agent.archivedAt || agent.background) continue;
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (!parent || parent.archivedAt || !parent.workspaceId) {
      rooted.add(workspaceId);
    } else if (parent.workspaceId !== workspaceId) {
      delegated.add(workspaceId);
    }
  }
  for (const workspaceId of rooted) delegated.delete(workspaceId);
  return delegated.size === 0 ? EMPTY_IDS : delegated;
}

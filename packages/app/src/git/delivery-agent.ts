import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

/**
 * What "Create PR & Merge" asks the workspace's agent to do. Plain language on
 * purpose: it has to work for any provider, with or without delivery skills.
 * The agent, not the app, decides when the PR is ready to merge.
 */
export const DELIVERY_PROMPT =
  "Deliver this branch: commit any uncommitted changes, push, and open a pull request against " +
  "the base branch. Wait for CI. If checks fail or there are conflicts, fix them and push again. " +
  "Merge the PR once it's green and mergeable. If you can't get it there, stop and tell me why.";

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
 * top-level agent. Null when the workspace has none.
 */
export function pickDeliveryAgentId(input: {
  agents: Iterable<DeliveryAgentCandidate>;
  workspaceId: string;
  focusedAgentId: string | null;
}): string | null {
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  const eligible = [...input.agents].filter(
    (agent) =>
      normalizeWorkspaceOpaqueId(agent.workspaceId) === workspaceId &&
      !agent.archivedAt &&
      agent.parentAgentId === null,
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

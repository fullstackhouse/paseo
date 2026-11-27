import { PARENT_SERVER_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { CommandCenterContribution, CommandCenterIcon } from "@/command-center/contributions";
import type { Agent } from "@/stores/session-store";
import { MAX_LINEAGE_DEPTH } from "./lineage";

type AttachAgent = Pick<
  Agent,
  "id" | "title" | "parentAgentId" | "workspaceId" | "archivedAt" | "background" | "labels"
> &
  Partial<Pick<Agent, "lastActivityAt">>;

/** Only a root agent can be attached; a subagent is detached first. */
export function canAttachAgent(agent: AttachAgent): boolean {
  return (
    !agent.archivedAt &&
    !agent.background &&
    agent.parentAgentId === null &&
    agent.labels[PARENT_SERVER_ID_LABEL] === undefined
  );
}

function descendsFrom(
  agent: AttachAgent,
  ancestorId: string,
  agents: ReadonlyMap<string, AttachAgent>,
): boolean {
  let parentId = agent.parentAgentId;
  for (let depth = 0; parentId && depth < MAX_LINEAGE_DEPTH; depth += 1) {
    if (parentId === ancestorId) return true;
    parentId = agents.get(parentId)?.parentAgentId ?? null;
  }
  return false;
}

/** Agents on the same host that `agentId` can become a subagent of, most recently active first. */
export function listAttachTargets<T extends AttachAgent>(
  agents: ReadonlyMap<string, T>,
  agentId: string,
): T[] {
  return [...agents.values()]
    .filter(
      (candidate) =>
        candidate.id !== agentId &&
        !candidate.archivedAt &&
        !candidate.background &&
        !descendsFrom(candidate, agentId, agents),
    )
    .sort(
      (left, right) =>
        (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0),
    );
}

export interface AttachAgentContributionSource {
  agent: AttachAgent;
  agents: ReadonlyMap<string, AttachAgent>;
  workspaceName(workspaceId: string | undefined): string | null;
  labels: { group: string; keywords: string; untitled: string };
  icon: CommandCenterIcon;
  attach(parentAgentId: string): void | Promise<void>;
}

/** "Attach to agent › <agent>" rows in the command center, shown while searching. */
export function buildAttachAgentContributions(
  source: AttachAgentContributionSource,
): CommandCenterContribution[] {
  if (!canAttachAgent(source.agent)) return [];
  const groupKeywords = source.labels.keywords.split(" ");
  return listAttachTargets(source.agents, source.agent.id).map((target, rank) => {
    const workspaceName = source.workspaceName(target.workspaceId);
    const title = target.title?.trim() || source.labels.untitled;
    return {
      id: `attach-agent:${target.id}`,
      group: "attach-agent",
      groupRank: 2,
      rank,
      keywords: [...groupKeywords, target.id, ...(workspaceName ? [workspaceName] : [])],
      visibility: "query",
      run: () => source.attach(target.id),
      presentation: {
        kind: "choice",
        path: [
          source.labels.group,
          workspaceName && workspaceName !== title ? `${title} · ${workspaceName}` : title,
        ],
        icon: source.icon,
        selected: false,
        testId: `command-center-attach-agent-${target.id}`,
      },
    };
  });
}

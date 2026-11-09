import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  compareByRecency,
  joinSubtitleParts,
  type CommandCenterAgentResult,
  type CommandCenterSearchFields,
  type CommandCenterWorkspaceResult,
} from "./results";

export interface ArchivedSearchRowsInput {
  /** Agents History search returned for the query, archived or not. */
  historyAgents: readonly AggregatedAgent[];
  /** `serverId:workspaceId` of every workspace the command center already lists. */
  listedWorkspaceKeys: ReadonlySet<string>;
  /** `serverId:agentId` of every agent the command center already lists. */
  listedAgentKeys: ReadonlySet<string>;
  showHost: boolean;
  agentTitle(agent: AggregatedAgent): string;
  openWorkspace(serverId: string, workspaceId: string): () => void;
  openAgent(serverId: string, agentId: string): () => void;
}

export interface ArchivedSearchRows {
  workspaces: CommandCenterWorkspaceResult[];
  agents: CommandCenterAgentResult[];
}

function branchOf(agent: AggregatedAgent): string | null {
  return agent.projectPlacement?.checkout.currentBranch ?? null;
}

function archivedWorkspaceRow(
  input: ArchivedSearchRowsInput,
  agent: AggregatedAgent,
  workspaceId: string,
): CommandCenterWorkspaceResult | null {
  const placement = agent.projectPlacement;
  if (!placement) return null;
  return {
    kind: "workspace",
    id: `workspace:${agent.serverId}:${workspaceId}`,
    title: placement.workspaceName ?? input.agentTitle(agent),
    subtitle: joinSubtitleParts([
      input.showHost ? agent.serverLabel : null,
      placement.projectName,
      branchOf(agent),
    ]),
    serverId: agent.serverId,
    workspaceId,
    project: { viewKey: placement.projectKey, name: placement.projectName, iconDataUri: null },
    changeRequestNumber: null,
    activityAt: agent.lastActivityAt,
    archived: true,
    run: input.openWorkspace(agent.serverId, workspaceId),
  };
}

function archivedAgentRow(
  input: ArchivedSearchRowsInput,
  agent: AggregatedAgent,
): CommandCenterAgentResult {
  const placement = agent.projectPlacement;
  return {
    kind: "agent",
    id: `agent:${agent.serverId}:${agent.id}`,
    agent,
    title: input.agentTitle(agent),
    subtitle: joinSubtitleParts([
      input.showHost ? agent.serverLabel : null,
      placement?.workspaceName ?? placement?.projectName,
    ]),
    activityAt: agent.lastActivityAt,
    archived: true,
    run: input.openAgent(agent.serverId, agent.id),
  };
}

/**
 * Rows for what History search found that the command center does not already list: archived
 * agents, and the archived workspaces they belong to. The live lists hold only active
 * workspaces and agents, so without these an archived workspace cannot be found from Cmd+K.
 *
 * A workspace is archived when it is missing from the live list; its row takes its title, branch
 * and recency from its most recent matching agent, and opens the workspace route, which offers
 * to restore it.
 */
export function buildArchivedSearchRows(input: ArchivedSearchRowsInput): ArchivedSearchRows {
  const workspaces = new Map<string, CommandCenterWorkspaceResult>();
  const agents: CommandCenterAgentResult[] = [];

  for (const agent of input.historyAgents) {
    // History also returns live agents the command center hides on purpose (background ones).
    if (!agent.archivedAt) continue;

    const workspaceKey = agent.workspaceId ? `${agent.serverId}:${agent.workspaceId}` : null;
    if (agent.workspaceId && workspaceKey && !input.listedWorkspaceKeys.has(workspaceKey)) {
      const existing = workspaces.get(workspaceKey);
      const row = archivedWorkspaceRow(input, agent, agent.workspaceId);
      if (row && (!existing || compareByRecency(row, existing) <= 0)) {
        workspaces.set(workspaceKey, row);
      }
    }

    if (!input.listedAgentKeys.has(`${agent.serverId}:${agent.id}`)) {
      agents.push(archivedAgentRow(input, agent));
    }
  }

  return { workspaces: [...workspaces.values()], agents };
}

/**
 * Text an agent row matches on. None of the hidden fields are rendered, so a match there never
 * outranks one on text the user can see. An archived row also hides the project, branch and
 * workspace name History search matched it on, or rescoring here could drop a row History found.
 */
export function agentSearchFields(result: CommandCenterAgentResult): CommandCenterSearchFields {
  const placement = result.agent.projectPlacement;
  const hidden = [result.agent.cwd];
  if (result.archived && placement) {
    hidden.push(
      placement.projectName,
      placement.checkout.currentBranch ?? "",
      placement.workspaceName ?? "",
    );
  }
  return { visible: [result.title, result.subtitle], hidden };
}

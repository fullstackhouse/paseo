import type { AgentAddress } from "@getpaseo/protocol/addresses";
import {
  getDetachedFromAddressFromLabels,
  getParentAddressFromLabels,
} from "@getpaseo/protocol/agent-labels";
import equal from "fast-deep-equal";
import type { Agent, useSessionStore } from "@/stores/session-store";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

/**
 * One agent in a lineage. `missing` means a label points at an agent this client hasn't loaded;
 * `detached` means the link between this node and its neighbour toward the focus agent was detached.
 */
export interface LineageNode {
  address: AgentAddress;
  workspaceId: string | null;
  archived: boolean;
  missing: boolean;
  detached: boolean;
}

export interface Lineage {
  /** Root first, ending with the focus agent's parent. */
  ancestors: LineageNode[];
  /** Live children, oldest first. */
  children: LineageNode[];
}

/** A cycle in parent labels would otherwise walk forever; real chains are a handful deep. */
export const MAX_LINEAGE_DEPTH = 10;

const EMPTY_LINEAGE: Lineage = { ancestors: [], children: [] };

function findAgent(state: SessionStoreSnapshot, address: AgentAddress): Agent | null {
  const session = state.sessions[address.serverId];
  return session?.agents.get(address.agentId) ?? session?.agentDetails.get(address.agentId) ?? null;
}

function toNode(address: AgentAddress, agent: Agent | null, detached: boolean): LineageNode {
  return {
    address,
    workspaceId: agent?.workspaceId ?? null,
    archived: Boolean(agent?.archivedAt),
    missing: agent === null,
    detached,
  };
}

/** Who started an agent: its parent, or the parent it was detached from. */
function startedBy(
  agent: Agent,
  serverId: string,
): { address: AgentAddress; detached: boolean } | null {
  const parent = getParentAddressFromLabels(agent.labels, serverId);
  if (parent) return { address: parent, detached: false };
  const former = getDetachedFromAddressFromLabels(agent.labels, serverId);
  return former ? { address: former, detached: true } : null;
}

function sameAddress(left: AgentAddress, right: AgentAddress): boolean {
  return left.serverId === right.serverId && left.agentId === right.agentId;
}

export function deriveLineage(state: SessionStoreSnapshot, focus: AgentAddress): Lineage {
  const ancestors: LineageNode[] = [];
  const seen: AgentAddress[] = [focus];
  let current = findAgent(state, focus);
  let currentServerId = focus.serverId;
  while (current && ancestors.length < MAX_LINEAGE_DEPTH) {
    const link = startedBy(current, currentServerId);
    if (!link || seen.some((address) => sameAddress(address, link.address))) break;
    seen.push(link.address);
    current = findAgent(state, link.address);
    currentServerId = link.address.serverId;
    ancestors.unshift(toNode(link.address, current, link.detached));
  }

  const children: Array<{ node: LineageNode; createdAt: number }> = [];
  for (const [serverId, session] of Object.entries(state.sessions)) {
    for (const agent of session.agents.values()) {
      if (agent.archivedAt) continue;
      const link = startedBy(agent, serverId);
      if (!link || !sameAddress(link.address, focus)) continue;
      children.push({
        node: toNode({ serverId, agentId: agent.id }, agent, link.detached),
        createdAt: agent.createdAt.getTime(),
      });
    }
  }
  children.sort((left, right) => left.createdAt - right.createdAt);

  if (ancestors.length === 0 && children.length === 0) return EMPTY_LINEAGE;
  return { ancestors, children: children.map((child) => child.node) };
}

/**
 * Session-store selectors run on every stream tick. Recompute only when an agent map changes, and
 * keep the previous result when the new one is equal so the hook's equality check stays O(1).
 */
export function createLineageSelector(
  focus: AgentAddress | null,
): (state: SessionStoreSnapshot) => Lineage {
  let previousMaps: unknown[] = [];
  let previous: Lineage | null = null;
  return (state) => {
    if (!focus) return EMPTY_LINEAGE;
    const maps = Object.values(state.sessions).flatMap((session) => [
      session.agents,
      session.agentDetails,
    ]);
    if (
      previous &&
      maps.length === previousMaps.length &&
      maps.every((map, index) => map === previousMaps[index])
    ) {
      return previous;
    }
    const next = deriveLineage(state, focus);
    previousMaps = maps;
    if (!previous || !equal(previous, next)) previous = next;
    return previous;
  };
}

export function isInWorkspace(
  node: LineageNode,
  workspace: { serverId: string; workspaceId: string },
): boolean {
  return (
    node.address.serverId === workspace.serverId &&
    normalizeWorkspaceOpaqueId(node.workspaceId) ===
      normalizeWorkspaceOpaqueId(workspace.workspaceId)
  );
}

/** Whether a loaded relative runs in a workspace other than this one. */
export function lineageCrossesWorkspace(
  lineage: Lineage,
  workspace: { serverId: string; workspaceId: string },
): boolean {
  return [...lineage.ancestors, ...lineage.children].some(
    (node) => !node.missing && !isInWorkspace(node, workspace),
  );
}

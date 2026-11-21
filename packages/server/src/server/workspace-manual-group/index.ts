import type { Logger } from "pino";
import type { AgentManager, AgentManagerEvent } from "../agent/agent-manager.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";

export interface WorkspaceManualGroupClearerOptions {
  agentManager: Pick<AgentManager, "subscribe">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "update">;
  logger: Logger;
  now?: () => number;
}

export interface WorkspaceManualGroupClearer {
  close: () => void;
  /** Settles once every clear started so far is written. */
  flush: () => Promise<void>;
}

/** Drops the sidebar group a user moved the workspace to. Returns whether there was one. */
export async function clearWorkspaceManualGroup(input: {
  registry: Pick<WorkspaceRegistry, "get" | "update">;
  workspaceId: string;
  nowIso: string;
}): Promise<boolean> {
  // Every turn start lands here; most workspaces have no move, and an update would still notify
  // every observing session.
  if (!(await input.registry.get(input.workspaceId))?.manualGroup) return false;
  let cleared = false;
  await input.registry.update(input.workspaceId, (existing) => {
    if (!existing.manualGroup) return existing;
    cleared = true;
    return { ...existing, manualGroup: null, updatedAt: input.nowIso };
  });
  return cleared;
}

/**
 * A move by hand holds until something new happens. A turn starting in the workspace is that
 * something, so the move ends there and the workspace goes back to its own group.
 */
export function setupWorkspaceManualGroupClearer(
  options: WorkspaceManualGroupClearerOptions,
): WorkspaceManualGroupClearer {
  const log = options.logger.child({ module: "workspace-manual-group" });
  const now = options.now ?? Date.now;
  const runningAgentIds = new Set<string>();
  let queue: Promise<void> = Promise.resolve();

  async function clearForTurn(workspaceId: string, agentId: string): Promise<void> {
    try {
      const cleared = await clearWorkspaceManualGroup({
        registry: options.workspaceRegistry,
        workspaceId,
        nowIso: new Date(now()).toISOString(),
      });
      if (cleared) log.info({ workspaceId, agentId }, "turn started, manual group cleared");
    } catch (err) {
      log.warn({ err, workspaceId }, "failed to clear manual group");
    }
  }

  const onEvent = (event: AgentManagerEvent) => {
    if (event.type === "agent_removed") {
      runningAgentIds.delete(event.agentId);
      return;
    }
    if (event.type !== "agent_state") return;
    const { agent } = event;
    if (agent.lifecycle !== "running") {
      runningAgentIds.delete(agent.id);
      return;
    }
    if (runningAgentIds.has(agent.id)) return;
    runningAgentIds.add(agent.id);
    const workspaceId = agent.workspaceId;
    if (!workspaceId) return;
    queue = queue.then(() => clearForTurn(workspaceId, agent.id));
  };

  const unsubscribe = options.agentManager.subscribe(onEvent, { replayState: false });
  return { close: unsubscribe, flush: () => queue };
}

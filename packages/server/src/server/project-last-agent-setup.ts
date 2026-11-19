import type { Logger } from "pino";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { ProjectLastAgentSetup } from "@getpaseo/protocol/messages";
import type { AgentManager, ManagedAgent } from "./agent/agent-manager.js";
import type { FileBackedProjectRegistry, WorkspaceRegistry } from "./workspace-registry.js";
import type { ProjectUpdate } from "./workspace-reconciliation-service.js";

export interface ProjectLastAgentSetupRecorderOptions {
  agentManager: Pick<AgentManager, "subscribe">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  projectRegistry: Pick<FileBackedProjectRegistry, "recordLastAgentSetup">;
  logger: Logger;
  onProjectUpdate: (update: ProjectUpdate) => void;
}

export interface ProjectLastAgentSetupRecorder {
  close: () => void;
  /** Settles once every prompt seen so far is written. */
  flush: () => Promise<void>;
}

export function toProjectLastAgentSetup(agent: ManagedAgent): ProjectLastAgentSetup | null {
  if (!agent.lastUserMessageAt) return null;
  const featureValues: ProjectLastAgentSetup["featureValues"] = {};
  for (const feature of agent.features ?? []) featureValues[feature.id] = feature.value;
  return {
    provider: agent.provider,
    model: agent.config.model ?? null,
    modeId: agent.currentModeId ?? null,
    thinkingOptionId: agent.config.thinkingOptionId ?? null,
    featureValues,
    promptedAt: agent.lastUserMessageAt.toISOString(),
  };
}

/**
 * Saves the setup of each project's most recently prompted top-level agent on the project record,
 * so "Recent projects" can offer it after the agent and its workspace are archived.
 */
export function setupProjectLastAgentSetupRecorder(
  options: ProjectLastAgentSetupRecorderOptions,
): ProjectLastAgentSetupRecorder {
  const { workspaceRegistry, projectRegistry, logger } = options;
  const recordedPromptMsByAgentId = new Map<string, number>();
  let queue: Promise<void> = Promise.resolve();

  async function record(workspaceId: string, setup: ProjectLastAgentSetup): Promise<void> {
    const workspace = await workspaceRegistry.get(workspaceId);
    // Background workspaces (heartbeats, workers) are hidden from Recent projects.
    if (!workspace || workspace.background) return;
    const project = await projectRegistry.recordLastAgentSetup(workspace.projectId, setup);
    if (project) options.onProjectUpdate({ kind: "upsert", project });
  }

  const unsubscribe = options.agentManager.subscribe(
    (event) => {
      if (event.type === "agent_removed") {
        recordedPromptMsByAgentId.delete(event.agentId);
        return;
      }
      if (event.type !== "agent_state") return;
      const { agent } = event;
      if (agent.internal || agent.labels[PARENT_AGENT_ID_LABEL] || !agent.workspaceId) return;
      const promptMs = agent.lastUserMessageAt?.getTime();
      if (promptMs === undefined) return;
      if (promptMs <= (recordedPromptMsByAgentId.get(agent.id) ?? -1)) return;
      recordedPromptMsByAgentId.set(agent.id, promptMs);
      const setup = toProjectLastAgentSetup(agent);
      if (!setup) return;
      const workspaceId = agent.workspaceId;
      queue = queue
        .then(() => record(workspaceId, setup))
        .catch((error: unknown) => {
          logger.warn({ err: error, agentId: agent.id }, "Failed to record project agent setup");
        });
    },
    { replayState: false },
  );

  return {
    close: unsubscribe,
    flush: () => queue,
  };
}

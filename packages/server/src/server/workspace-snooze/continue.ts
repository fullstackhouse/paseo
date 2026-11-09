import type { Logger } from "pino";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { formatSystemNotificationPrompt } from "../agent/agent-messages/envelope.js";
import { sendPreparedPromptToAgent } from "../agent/agent-prompt.js";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "../agent/agent-storage.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";

export interface ContinueSnoozedWorkspaceInput {
  workspace: Pick<PersistedWorkspaceRecord, "workspaceId" | "snoozeWakePrompt">;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}

/**
 * The agent a wake prompt goes to: the workspace's most recently active top-level agent.
 * Subagents, internal agents and archived agents never receive it.
 */
export function pickWakeAgent(records: readonly StoredAgentRecord[]): StoredAgentRecord | null {
  let picked: StoredAgentRecord | null = null;
  let pickedAt = "";
  for (const record of records) {
    if (record.archivedAt || record.internal || record.labels?.[PARENT_AGENT_ID_LABEL]) continue;
    const activityAt = record.lastActivityAt ?? record.updatedAt;
    if (!picked || activityAt > pickedAt) {
      picked = record;
      pickedAt = activityAt;
    }
  }
  return picked;
}

export function formatWakePrompt(wakePrompt: string): string {
  return formatSystemNotificationPrompt(
    `The user snoozed this workspace and asked you to pick it up when the snooze ended. It has ended.\n\n${wakePrompt}`,
  );
}

/** Sends a timed snooze's wake prompt to the workspace's agent. No agent means nothing to continue. */
export async function continueSnoozedWorkspace(
  input: ContinueSnoozedWorkspaceInput,
): Promise<void> {
  const { workspace, logger } = input;
  if (!workspace.snoozeWakePrompt) return;
  const agent = pickWakeAgent(await input.agentStorage.listByWorkspace(workspace.workspaceId));
  if (!agent) {
    logger.info({ workspaceId: workspace.workspaceId }, "snooze ended with no agent to continue");
    return;
  }
  await sendPreparedPromptToAgent({
    agentManager: input.agentManager,
    agentStorage: input.agentStorage,
    agentId: agent.id,
    prompt: formatWakePrompt(workspace.snoozeWakePrompt),
    unarchive: false,
    // An agent still working when the snooze ends hears the prompt mid-turn rather than losing it.
    activeTurnBehavior: "steer",
    logger,
  });
  logger.info({ workspaceId: workspace.workspaceId, agentId: agent.id }, "sent snooze wake prompt");
}

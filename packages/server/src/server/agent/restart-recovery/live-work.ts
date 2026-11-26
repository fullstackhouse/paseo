import {
  isDaemonBackgroundWorkItem,
  type AgentBackgroundWorkItem,
} from "../background-work/index.js";
import type { ProviderSubagentDescriptor } from "../provider-subagents/store.js";

interface LiveWorkSource {
  getAgent(agentId: string): { internal?: boolean } | null;
  listProviderSubagents(agentId: string): ProviderSubagentDescriptor[];
  listAgentBackgroundWork(agentId: string): AgentBackgroundWorkItem[];
}

const BACKGROUND_KIND_LABELS: Record<string, string> = {
  shell: "Background shell",
  monitor: "Monitor",
};

/**
 * FSH fork: one label per piece of work that dies with the agent's provider process: its running
 * top-level subagents (a nested child stops with its parent) and its background shells and
 * monitors. Daemon-owned items (heartbeats) survive a restart, so they are not listed. Empty for an
 * agent that isn't loaded, and for a private one.
 */
export function describeLiveWork(source: LiveWorkSource, agentId: string): string[] {
  const agent = source.getAgent(agentId);
  if (!agent || agent.internal) return [];
  const subagents = source
    .listProviderSubagents(agentId)
    .filter((subagent) => subagent.status === "running" && subagent.parentSubagentId === null)
    .map((subagent) => `Subagent: ${subagent.title ?? subagent.description ?? subagent.id}`);
  const background = source
    .listAgentBackgroundWork(agentId)
    .filter((item) => !isDaemonBackgroundWorkItem(item))
    .map(
      (item) =>
        `${BACKGROUND_KIND_LABELS[item.kind] ?? "Background job"}: ${item.description ?? item.id}`,
    );
  return [...subagents, ...background];
}

// FSH fork: one way to nudge stopped agents back to work, shared by the restart and failure callouts.
import { useCallback } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-api-context";
import { i18n } from "@/i18n/i18next";
import { formatInterruptedAgentNames } from "@/interrupted-agents/select";
import { DEFAULT_RESUME_PROMPT } from "@/screens/settings/restart-recovery-card";
import { useSessionStore } from "@/stores/session-store";

export interface AgentRef {
  serverId: string;
  id: string;
}

export type ResumeClient = Pick<DaemonClient, "getDaemonConfig" | "sendAgentMessage">;

/**
 * Sends each agent its host's restart recovery prompt (Host settings → Agents), the one
 * auto-resume uses. Resolves to the agents it couldn't reach: their host has no client, or the
 * host refused the message.
 */
export async function resumeAgentsWith<T extends AgentRef>(
  agents: readonly T[],
  getClient: (serverId: string) => ResumeClient | null,
): Promise<T[]> {
  const byServer = new Map<string, T[]>();
  for (const agent of agents) {
    byServer.set(agent.serverId, [...(byServer.get(agent.serverId) ?? []), agent]);
  }
  const unreached = await Promise.all(
    [...byServer].map(([serverId, group]) => resumeOnHost(getClient(serverId), group)),
  );
  return unreached.flat();
}

async function resumeOnHost<T extends AgentRef>(
  client: ResumeClient | null,
  agents: readonly T[],
): Promise<T[]> {
  if (!client) return [...agents];
  const prompt = await client
    .getDaemonConfig()
    .then((result) => result.config.resumePrompt ?? DEFAULT_RESUME_PROMPT)
    .catch(() => DEFAULT_RESUME_PROMPT);
  const unreached: T[] = [];
  await Promise.all(
    agents.map(async (agent) => {
      try {
        // Resuming isn't coming back to a snoozed workspace.
        await client.sendAgentMessage(agent.id, prompt, { keepSnoozed: true });
      } catch (error) {
        console.error("[ResumeAgents] Failed to resume agent", agent.id, error);
        unreached.push(agent);
      }
    }),
  );
  return unreached;
}

function getSessionClient(serverId: string): ResumeClient | null {
  return useSessionStore.getState().sessions[serverId]?.client ?? null;
}

function getAgentTitle(agent: AgentRef): string | null {
  return useSessionStore.getState().sessions[agent.serverId]?.agents.get(agent.id)?.title ?? null;
}

/** The error toast naming agents a resume couldn't reach, given their titles; null when it reached all. */
export function formatUnreachedMessage(titles: readonly (string | null)[]): string | null {
  if (titles.length === 0) return null;
  const names = formatInterruptedAgentNames(titles, {
    untitled: i18n.t("interruptedAgents.untitled"),
    more: (count) => i18n.t("interruptedAgents.more", { count }),
  });
  return i18n.t("resumeAgents.unreached", { count: titles.length, names });
}

/** Resumes agents and names the ones it couldn't reach in an error toast. */
export function useResumeAgents(): (agents: readonly AgentRef[]) => void {
  const toast = useToast();
  return useCallback(
    (agents) => {
      const report = async () => {
        const unreached = await resumeAgentsWith(agents, getSessionClient);
        const message = formatUnreachedMessage(unreached.map(getAgentTitle));
        if (message) toast.error(message);
      };
      void report();
    },
    [toast],
  );
}

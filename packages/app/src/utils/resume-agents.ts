// FSH fork: one way to nudge stopped agents back to work, shared by the restart and failure callouts.
import { DEFAULT_RESUME_PROMPT } from "@/screens/settings/restart-recovery-card";
import { useSessionStore } from "@/stores/session-store";

/** Sends the host's restart recovery prompt (Host settings → Agents), the one auto-resume uses. */
export async function sendResumePrompt(
  serverId: string,
  agentIds: readonly string[],
): Promise<void> {
  const client = useSessionStore.getState().sessions[serverId]?.client;
  if (!client) return;
  const prompt = await client
    .getDaemonConfig()
    .then((result) => result.config.resumePrompt ?? DEFAULT_RESUME_PROMPT)
    .catch(() => DEFAULT_RESUME_PROMPT);
  await Promise.all(
    agentIds.map((agentId) =>
      // Resuming isn't coming back to a snoozed workspace.
      client.sendAgentMessage(agentId, prompt, { keepSnoozed: true }).catch((error) => {
        console.error("[ResumeAgents] Failed to resume agent", agentId, error);
      }),
    ),
  );
}

/** Groups agents by host and resumes each group. */
export function resumeAgents(agents: readonly { serverId: string; id: string }[]): void {
  const byServer = new Map<string, string[]>();
  for (const agent of agents) {
    byServer.set(agent.serverId, [...(byServer.get(agent.serverId) ?? []), agent.id]);
  }
  for (const [serverId, agentIds] of byServer) {
    void sendResumePrompt(serverId, agentIds);
  }
}

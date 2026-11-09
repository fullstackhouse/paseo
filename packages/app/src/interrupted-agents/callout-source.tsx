import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  formatInterruptedAgentNames,
  interruptedAgentsDismissalKey,
  selectInterruptedAgents,
} from "@/interrupted-agents/select";
import { DEFAULT_RESUME_PROMPT } from "@/screens/settings/restart-recovery-card";
import { useSessionStore, type Agent } from "@/stores/session-store";

const CALLOUT_ID = "interrupted-agents";

/** Sends the host's restart recovery prompt (Host settings → Agents), the one auto-resume uses. */
async function resumeOnServer(serverId: string, agents: readonly Agent[]): Promise<void> {
  const client = useSessionStore.getState().sessions[serverId]?.client;
  if (!client) return;
  const prompt = await client
    .getDaemonConfig()
    .then((result) => result.config.resumePrompt ?? DEFAULT_RESUME_PROMPT)
    .catch(() => DEFAULT_RESUME_PROMPT);
  await Promise.all(
    agents.map((agent) =>
      client.sendAgentMessage(agent.id, prompt).catch((error) => {
        console.error("[InterruptedAgents] Failed to resume agent", agent.id, error);
      }),
    ),
  );
}

/** After a daemon restart, offers to resume every agent whose turn it cut short. */
export function InterruptedAgentsCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const agents = useSessionStore(useShallow((state) => selectInterruptedAgents(state.sessions)));

  const resumeAll = useStableEvent(() => {
    callouts.dismiss(CALLOUT_ID);
    const byServer = new Map<string, Agent[]>();
    for (const agent of agents) {
      byServer.set(agent.serverId, [...(byServer.get(agent.serverId) ?? []), agent]);
    }
    for (const [serverId, serverAgents] of byServer) {
      void resumeOnServer(serverId, serverAgents);
    }
  });

  const descriptor = useMemo(() => {
    if (agents.length === 0) return null;
    return {
      dismissalKey: interruptedAgentsDismissalKey(agents),
      title: t("interruptedAgents.title", { count: agents.length }),
      description: t("interruptedAgents.description", {
        names: formatInterruptedAgentNames(
          agents.map((agent) => agent.title),
          {
            untitled: t("interruptedAgents.untitled"),
            more: (count) => t("interruptedAgents.more", { count }),
          },
        ),
      }),
    };
  }, [agents, t]);

  useEffect(() => {
    if (!descriptor) return;
    return callouts.show({
      id: CALLOUT_ID,
      dismissalKey: descriptor.dismissalKey,
      priority: 250,
      title: descriptor.title,
      description: descriptor.description,
      actions: [
        { label: t("interruptedAgents.resumeAll"), onPress: resumeAll, variant: "primary" },
      ],
      testID: "interrupted-agents-callout",
    });
  }, [callouts, descriptor, resumeAll, t]);

  return null;
}

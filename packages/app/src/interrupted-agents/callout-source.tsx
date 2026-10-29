import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  RESUME_INTERRUPTED_PROMPT,
  formatInterruptedAgentNames,
  interruptedAgentsDismissalKey,
  selectInterruptedAgents,
} from "@/interrupted-agents/select";
import { useSessionStore } from "@/stores/session-store";

const CALLOUT_ID = "interrupted-agents";

/** After a daemon restart, offers to resume every agent whose turn it cut short. */
export function InterruptedAgentsCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const agents = useSessionStore(useShallow((state) => selectInterruptedAgents(state.sessions)));

  const resumeAll = useStableEvent(() => {
    const { sessions } = useSessionStore.getState();
    callouts.dismiss(CALLOUT_ID);
    for (const agent of agents) {
      const client = sessions[agent.serverId]?.client;
      if (!client) continue;
      client.sendAgentMessage(agent.id, RESUME_INTERRUPTED_PROMPT).catch((error) => {
        console.error("[InterruptedAgents] Failed to resume agent", agent.id, error);
      });
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

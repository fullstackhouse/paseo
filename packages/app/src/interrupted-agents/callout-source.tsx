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
import { useSessionStore } from "@/stores/session-store";
import { useResumeAgents } from "@/utils/resume-agents";

const CALLOUT_ID = "interrupted-agents";

/** After a daemon restart, offers to resume every agent whose turn it cut short. */
export function InterruptedAgentsCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const resumeAgents = useResumeAgents();
  const agents = useSessionStore(useShallow((state) => selectInterruptedAgents(state.sessions)));

  const resumeAll = useStableEvent(() => {
    callouts.dismiss(CALLOUT_ID);
    resumeAgents(agents);
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

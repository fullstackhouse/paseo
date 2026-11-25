import { useEffect, useMemo } from "react";
import { RotateCcw } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import type {
  CommandCenterContribution,
  CommandCenterIconProps,
} from "@/command-center/contributions";
import { useCommandCenterActions } from "@/command-center/provider";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  failedAgentsDismissalKey,
  selectFailedAgents,
  selectRetryableFailedAgents,
} from "@/failed-agents/select";
import { formatInterruptedAgentNames } from "@/interrupted-agents/select";
import { useSessionStore } from "@/stores/session-store";
import { resumeAgents } from "@/utils/resume-agents";

const CALLOUT_ID = "failed-agents";

const ThemedRotateCcw = withUnistyles(RotateCcw);

function RetryIcon({ size }: CommandCenterIconProps) {
  return <ThemedRotateCcw size={size} strokeWidth={2.2} />;
}

/**
 * After a network or provider outage, the callout offers to retry every agent whose turn it failed.
 * The palette retries every failed agent, usage limits included, since the user asks for it.
 */
export function FailedAgentsCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const agents = useSessionStore(
    useShallow((state) => selectRetryableFailedAgents(state.sessions)),
  );

  const failedAgents = useSessionStore(useShallow((state) => selectFailedAgents(state.sessions)));

  const retryAll = useStableEvent(() => {
    callouts.dismiss(CALLOUT_ID);
    resumeAgents(agents);
  });

  const retryAllFailed = useStableEvent(() => {
    callouts.dismiss(CALLOUT_ID);
    resumeAgents(failedAgents);
  });

  const descriptor = useMemo(() => {
    if (agents.length === 0) return null;
    return {
      dismissalKey: failedAgentsDismissalKey(agents),
      title: t("failedAgents.title", { count: agents.length }),
      description: t("failedAgents.description", {
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
      priority: 240,
      title: descriptor.title,
      description: descriptor.description,
      actions: [{ label: t("failedAgents.retryAll"), onPress: retryAll, variant: "primary" }],
      testID: "failed-agents-callout",
    });
  }, [callouts, descriptor, retryAll, t]);

  const actions = useMemo<CommandCenterContribution[]>(
    () => [
      {
        id: "retry-failed-agents",
        group: "actions",
        groupRank: 0,
        rank: 11,
        keywords: [
          "retry",
          "continue",
          "resume",
          "failed",
          "network",
          "offline",
          "limit",
          "agents",
        ],
        visibility: "query",
        run: retryAllFailed,
        presentation: {
          kind: "action",
          title: t("failedAgents.retryAllAction", { count: failedAgents.length }),
          sectionTitle: t("shell.commandCenter.actions"),
          icon: RetryIcon,
        },
      },
    ],
    [failedAgents.length, retryAllFailed, t],
  );
  useCommandCenterActions({
    sourceId: "failed-agents",
    enabled: failedAgents.length > 0,
    actions,
  });

  return null;
}

import { Link } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getCommandCenterIcon } from "@/command-center/icon";
import { useCommandCenterActions } from "@/command-center/provider";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildAttachAgentContributions } from "./attach-agent";

const AttachIcon = getCommandCenterIcon(Link);
const NO_AGENTS = new Map();

/**
 * Lists "Attach to agent › <agent>" in the command center for a root agent. Attaching makes it a
 * subagent of the chosen agent, which hides its workspace from the sidebar, then opens the parent.
 */
export function useAttachAgentCommandCenterActions(input: {
  serverId: string;
  agentId: string;
  enabled: boolean;
}): void {
  const { serverId, agentId } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentAttach === true,
  );
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents ?? NO_AGENTS);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const agent = agents.get(agentId);

  const attach = useCallback(
    async (parentAgentId: string) => {
      const client = useSessionStore.getState().sessions[serverId]?.client;
      try {
        if (!client) throw new Error(t("workspaceSetup.errors.hostDisconnected"));
        await client.attachAgent(agentId, parentAgentId);
        toast.show(t("subagents.attachedToast"), { variant: "success" });
        navigateToAgent({ serverId, agentId: parentAgentId });
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    },
    [agentId, serverId, t, toast],
  );

  const actions = useMemo(
    () =>
      agent && supported
        ? buildAttachAgentContributions({
            agent,
            agents,
            workspaceName: (workspaceId) =>
              (workspaceId && workspaces?.get(workspaceId)?.name) || null,
            labels: {
              group: t("subagents.attachGroupLabel"),
              keywords: t("subagents.attachSearchKeywords"),
              untitled: t("subagents.attachUntitledAgent"),
            },
            icon: AttachIcon,
            attach,
          })
        : [],
    [agent, agents, attach, supported, t, workspaces],
  );

  useCommandCenterActions({
    sourceId: `attach-agent:${serverId}:${agentId}`,
    enabled: input.enabled,
    actions,
  });
}

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { getForgePresentation, type Forge } from "@/git/forge";
import { DELIVERY_PROMPT, pickDeliveryAgentId } from "@/git/delivery-agent";
import { getFocusedAgentId } from "@/plugins/command-center/context";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

function findFocusedAgentId(serverId: string, workspaceId: string): string | null {
  const layoutKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const layout = layoutKey
    ? (useWorkspaceLayoutStore.getState().layoutByWorkspace[layoutKey] ?? null)
    : null;
  return getFocusedAgentId(layout);
}

/** Opens a new agent tab in the workspace with the delivery prompt ready to send. */
function openDeliveryDraft(serverId: string, workspaceId: string): void {
  const draftId = generateDraftId();
  useDraftStore.getState().saveDraftInput({
    draftKey: buildDraftStoreKey({ serverId, agentId: draftId, draftId }),
    draft: { text: DELIVERY_PROMPT, attachments: [] },
  });
  navigateToWorkspace({ serverId, workspaceId, target: { kind: "draft", draftId } });
}

/**
 * "Create PR & Merge": hands the branch to the workspace's agent with
 * {@link DELIVERY_PROMPT} and shows its tab. Without an agent, opens a new
 * agent tab with the prompt filled in.
 */
export function useCreatePrAndMerge(input: {
  serverId: string;
  workspace: Pick<WorkspaceDescriptor, "id"> | null;
  forge: Forge;
}): () => void {
  const { serverId, forge } = input;
  const workspaceId = input.workspace?.id ?? null;
  const { t } = useTranslation();
  const toast = useToast();

  return useCallback(() => {
    if (!workspaceId) {
      toast.error(t("workspace.git.actions.toasts.failedCreatePrAndMerge"));
      return;
    }
    const session = useSessionStore.getState().sessions[serverId];
    const agentId = pickDeliveryAgentId({
      agents: session?.agents.values() ?? [],
      workspaceId,
      focusedAgentId: findFocusedAgentId(serverId, workspaceId),
    });
    if (!agentId) {
      openDeliveryDraft(serverId, workspaceId);
      return;
    }
    if (!session?.client) {
      toast.error(t("common.errors.daemonClientUnavailable"));
      return;
    }
    const context = getForgePresentation(forge).changeRequestContext;
    void session.client
      .sendAgentMessage(agentId, DELIVERY_PROMPT)
      .then(() => {
        navigateToWorkspace({ serverId, workspaceId, target: { kind: "agent", agentId } });
        toast.show(t("workspace.git.actions.createPrAndMerge.sent", { context }), {
          variant: "success",
        });
        return;
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : t("workspace.git.actions.toasts.failedCreatePrAndMerge"),
        );
      });
  }, [forge, serverId, t, toast, workspaceId]);
}

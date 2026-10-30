import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { getForgePresentation, type Forge } from "@/git/forge";
import { pickDeliveryAgentId } from "@/git/delivery-agent";
import { getFocusedAgentId } from "@/plugins/command-center/context";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

// The agent takes minutes to open the PR and the button stays enabled meanwhile, so a repeat
// click within this window would queue the same request twice.
const REPEAT_SEND_WINDOW_MS = 60_000;
const lastSendAtByWorkspace: Record<string, number> = {};

function findFocusedAgentId(serverId: string, workspaceId: string): string | null {
  const layoutKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const layout = layoutKey
    ? (useWorkspaceLayoutStore.getState().layoutByWorkspace[layoutKey] ?? null)
    : null;
  return getFocusedAgentId(layout);
}

/** Opens a new agent tab in the workspace with the prompt ready to send. */
function openPromptDraft(serverId: string, workspaceId: string, prompt: string): void {
  const draftId = generateDraftId();
  useDraftStore.getState().saveDraftInput({
    draftKey: buildDraftStoreKey({ serverId, agentId: draftId, draftId }),
    draft: { text: prompt, attachments: [] },
  });
  navigateToWorkspace({ serverId, workspaceId, target: { kind: "draft", draftId } });
}

/**
 * "Create PR" and "Create PR & Merge": asks the daemon for the PR prompt (base
 * branch, PR template, project PR preferences), sends it to the workspace's
 * agent and shows its tab. Without an agent, opens a new agent tab with the
 * prompt filled in.
 */
export function useAgentPr(input: {
  serverId: string;
  cwd: string;
  workspace: Pick<WorkspaceDescriptor, "id"> | null;
  forge: Forge;
  merge: boolean;
}): () => void {
  const { serverId, cwd, forge, merge } = input;
  const workspaceId = input.workspace?.id ?? null;
  const { t } = useTranslation();
  const toast = useToast();

  return useCallback(() => {
    const failedMessage = t("workspace.git.actions.toasts.failedCreatePrAndMerge");
    const session = useSessionStore.getState().sessions[serverId];
    if (!workspaceId) {
      toast.error(failedMessage);
      return;
    }
    if (!session?.client) {
      toast.error(t("common.errors.daemonClientUnavailable"));
      return;
    }
    // COMPAT(checkoutPrAgentPrompt): added in FSH v0.13.0-beta.1, remove gate after 2027-04-30.
    if (session.serverInfo?.features?.checkoutPrAgentPrompt !== true) {
      toast.error(t("workspace.git.actions.toasts.updateHostForAgentPr"));
      return;
    }
    const sendKey = `${serverId}:${workspaceId}`;
    const lastSendAt = lastSendAtByWorkspace[sendKey];
    if (lastSendAt !== undefined && Date.now() - lastSendAt < REPEAT_SEND_WINDOW_MS) {
      toast.show(t("workspace.git.actions.createPr.alreadySent"));
      return;
    }
    lastSendAtByWorkspace[sendKey] = Date.now();
    const client = session.client;
    const context = getForgePresentation(forge).changeRequestContext;
    const sentMessage = merge
      ? t("workspace.git.actions.createPrAndMerge.sent", { context })
      : t("workspace.git.actions.createPr.sent", { context });

    void (async () => {
      const payload = await client.checkoutPrAgentPrompt(cwd, { merge });
      if (payload.error || payload.prompt === null) {
        throw new Error(payload.error?.message ?? failedMessage);
      }
      const agentId = pickDeliveryAgentId({
        agents: session.agents.values(),
        workspaceId,
        focusedAgentId: findFocusedAgentId(serverId, workspaceId),
      });
      if (!agentId) {
        delete lastSendAtByWorkspace[sendKey];
        openPromptDraft(serverId, workspaceId, payload.prompt);
        return;
      }
      await client.sendAgentMessage(agentId, payload.prompt);
      navigateToWorkspace({ serverId, workspaceId, target: { kind: "agent", agentId } });
      toast.show(sentMessage, { variant: "success" });
    })().catch((error: unknown) => {
      delete lastSendAtByWorkspace[sendKey];
      toast.error(error instanceof Error ? error.message : failedMessage);
    });
  }, [cwd, forge, merge, serverId, t, toast, workspaceId]);
}

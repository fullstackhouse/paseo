import type { DraftRecord } from "@/stores/draft-store/state";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { collectAllTabs, type WorkspaceLayout } from "@/stores/workspace-layout-store";

function isUnsent(record: DraftRecord | undefined): boolean {
  if (record?.lifecycle !== "active") return false;
  return record.input.text.trim().length > 0 || record.input.attachments.length > 0;
}

/**
 * Whether a chat tab open in the workspace holds a message the user started and did not send.
 * Only open tabs count: a draft left in a closed chat has nowhere in the workspace to be found,
 * so marking the workspace for it would point at nothing.
 */
export function workspaceHasUnsentDraft(input: {
  serverId: string;
  layout: WorkspaceLayout | undefined;
  drafts: Record<string, DraftRecord>;
}): boolean {
  if (!input.layout) return false;
  for (const tab of collectAllTabs(input.layout.root)) {
    if (tab.target.kind === "agent") {
      const key = buildDraftStoreKey({ serverId: input.serverId, agentId: tab.target.agentId });
      if (isUnsent(input.drafts[key])) return true;
    } else if (tab.target.kind === "draft") {
      const key = buildDraftStoreKey({
        serverId: input.serverId,
        agentId: tab.tabId,
        draftId: tab.target.draftId,
      });
      if (isUnsent(input.drafts[key])) return true;
    }
  }
  return false;
}

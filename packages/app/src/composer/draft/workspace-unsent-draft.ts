import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { workspaceHasUnsentDraft } from "./workspace-unsent-draft-core";

export function useWorkspaceHasUnsentDraft(serverId: string, workspaceId: string): boolean {
  const layoutKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const layout = useWorkspaceLayoutStore((state) =>
    layoutKey ? state.layoutByWorkspace[layoutKey] : undefined,
  );
  return useDraftStore((state) =>
    workspaceHasUnsentDraft({ serverId, layout, drafts: state.drafts }),
  );
}

import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabPlacement } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";

/**
 * Shows a workspace's Explorer sidebar and returns a placement that opens a tab there, moving an
 * existing tab in. Undefined while the workspace isn't loaded, so the tab opens in the workspace,
 * and on compact layouts, where Explorer would cover the chat: the tab opens in a sheet instead.
 */
export function showWorkspaceExplorer(
  serverId: string,
  workspaceId: string,
): WorkspaceTabPlacement | undefined {
  const layout = useWorkspaceLayoutStore.getState();
  if (layout.layoutMode === "compact") return undefined;
  const resolvedWorkspaceId = resolveWorkspaceMapKeyByIdentity({
    workspaces: useSessionStore.getState().sessions[serverId]?.workspaces,
    workspaceId,
  });
  if (!resolvedWorkspaceId) return undefined;
  const paneId = layout.showExplorerSidebar(`${serverId}:${resolvedWorkspaceId}`);
  return paneId ? { mode: "pane", paneId } : undefined;
}

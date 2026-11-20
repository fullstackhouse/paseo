import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";
import { noteExplicitExplorerReveal } from "@/workspace-attention/explicit-reveal";

/**
 * Reveals the actual destination after placement and deduplication, including existing tabs.
 * `entering` marks a navigation into the workspace from outside it: an Explorer tab it reveals then
 * stays selected through the workspace's entry decision. Tab clicks inside the workspace leave it off.
 */
export function revealWorkspaceTab(
  workspaceKey: string,
  tabId: string | null,
  options?: { entering?: boolean },
): string | null {
  if (!tabId) return null;
  const store = useWorkspaceLayoutStore.getState();
  const destination = store.getTabDestination(workspaceKey, tabId);
  // Opening a sheet already reveals it, preserving the surface underneath.
  if (!destination) return null;
  if (destination.kind === "sheet") return tabId;
  store.focusTab(workspaceKey, tabId);
  if (options?.entering && destination.host === "explorer")
    noteExplicitExplorerReveal(workspaceKey);
  if (store.layoutMode === "compact") {
    const panels = usePanelStore.getState();
    if (destination.host === "explorer") panels.showMobileFileExplorer();
    else panels.showMobileAgent();
  }
  return tabId;
}

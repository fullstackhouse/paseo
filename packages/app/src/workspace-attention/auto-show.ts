import { useCallback, useEffect, useRef } from "react";
import { useSettings } from "@/hooks/use-settings";
import {
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import { openExplorerSidebarView, showExplorerSidebar } from "@/workspace-tabs/explorer-sidebar";
import { useWorkspaceAttention } from "./attention";
import { decideExplorerAutoShow, type AttentionItem } from "./model";

/** Shows Explorer on the tab that belongs to an attention item. */
export function showExplorerForAttention(workspaceKey: string, item: AttentionItem): void {
  switch (item.kind) {
    case "plugin": {
      const paneId = showExplorerSidebar({ isCompact: false, workspaceKey });
      const panelId = item.item.panelId;
      if (!panelId || !paneId) return;
      useWorkspaceLayoutStore.getState().openTab({
        workspaceKey,
        target: { kind: "plugin", pluginId: item.item.pluginId, panelId, context: "workspace" },
        intent: "reveal",
        placement: { mode: "pane", paneId },
      });
      return;
    }
    case "pr-checks-failed":
    case "pr-ready":
    case "pr-merged":
      openExplorerSidebarView({ isCompact: false, workspaceKey, view: "pr" });
      return;
    case "permission":
    case "failed":
      // The agent tab lives in the main pane, and entering a workspace already focuses the agent
      // that needs attention, so Explorer keeps the tab it last showed.
      showExplorerSidebar({ isCompact: false, workspaceKey });
      return;
  }
}

/** Shows Explorer on its Overview tab when the workspace still has one; closing it is respected. */
function showExplorerOnOverview(workspaceKey: string): void {
  const paneId = showExplorerSidebar({ isCompact: false, workspaceKey });
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[workspaceKey];
  const hasOverview =
    layout && collectAllTabs(layout.root).some((tab) => tab.target.kind === "overview");
  if (!paneId || !hasOverview) return;
  store.openTab({
    workspaceKey,
    target: { kind: "overview" },
    intent: "reveal",
    placement: { mode: "pane", paneId },
  });
}

/**
 * Desktop: shows Explorer on entering a workspace, per the "Open Explorer when entering a workspace"
 * setting. Returns the handler the Explorer toggle calls, so hiding it is remembered.
 */
export function useExplorerAutoShow(input: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string | null;
  workspaceActive: boolean;
  isCompact: boolean;
}): { onExplorerToggled: (nowOpen: boolean) => void } {
  const { serverId, workspaceId, workspaceKey, workspaceActive, isCompact } = input;
  const hydrated = useWorkspaceLayoutStoreHydrated();
  const setting = useSettings((settings) => settings.explorerOnWorkspaceEnter);
  const items = useWorkspaceAttention(serverId, workspaceId);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const decidedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceActive) {
      decidedForRef.current = null;
      return;
    }
    if (!hydrated || isCompact || !workspaceKey || decidedForRef.current === workspaceKey) return;
    decidedForRef.current = workspaceKey;
    const store = useWorkspaceLayoutStore.getState();
    store.autoOpenOverviewTab(workspaceKey);
    const decision = decideExplorerAutoShow({
      setting,
      items: itemsRef.current,
      record: store.explorerAttentionByWorkspace[workspaceKey] ?? null,
    });
    if (decision.kind === "show") {
      showExplorerOnOverview(workspaceKey);
    } else if (decision.kind === "item") {
      showExplorerForAttention(workspaceKey, decision.item);
      store.setExplorerAttention(workspaceKey, {
        hidden: false,
        seenKeys: itemsRef.current.map((item) => item.key),
      });
    }
  }, [hydrated, isCompact, setting, workspaceActive, workspaceKey]);

  const onExplorerToggled = useCallback(
    (nowOpen: boolean) => {
      if (isCompact || !workspaceKey) return;
      useWorkspaceLayoutStore.getState().setExplorerAttention(workspaceKey, {
        hidden: !nowOpen,
        seenKeys: itemsRef.current.map((item) => item.key),
      });
    },
    [isCompact, workspaceKey],
  );
  return { onExplorerToggled };
}

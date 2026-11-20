import { beforeEach, describe, expect, it } from "vitest";
import {
  collectAllPanes,
  collectAllTabs,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { applyExplorerEntryDecision } from "./auto-show";
import { takeExplicitExplorerReveal } from "./explicit-reveal";
import type { AttentionItem } from "./model";

const workspaceKey = "server:workspace";
const merged: AttentionItem = { kind: "pr-merged", key: "pr-merged:1" };
const entry = {
  serverId: "server",
  workspaceId: "workspace",
  workspaceKey,
  setting: "needed",
  tabSetting: "overview",
  items: [merged],
} as const;

function explorerFocus(): string | undefined {
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[workspaceKey];
  const paneId = store.explorerSidebarPaneIdByWorkspace[workspaceKey];
  const pane = layout && collectAllPanes(layout.root).find((candidate) => candidate.id === paneId);
  const focused =
    pane && collectAllTabs(layout.root).find((tab) => tab.tabId === pane.focusedTabId);
  return focused?.target.kind;
}

/** Opens a plugin screen in Explorer the way plugin navigation does when it enters the workspace. */
function enterWithExplorerScreen(): void {
  const store = useWorkspaceLayoutStore.getState();
  const paneId = store.showExplorerSidebar(workspaceKey);
  const tabId = store.openTab({
    workspaceKey,
    target: { kind: "plugin_screen", pluginId: "inbox", screenId: "review", params: {} },
    intent: "reveal",
    placement: paneId ? { mode: "pane", paneId } : undefined,
  });
  revealWorkspaceTab(workspaceKey, tabId, { entering: true });
}

describe("applyExplorerEntryDecision", () => {
  beforeEach(() => {
    takeExplicitExplorerReveal(workspaceKey);
    useWorkspaceLayoutStore.setState({
      layoutMode: "split-panes",
      layoutByWorkspace: {},
      sheetsByWorkspace: {},
      explorerSidebarPaneIdByWorkspace: {},
      explorerAttentionByWorkspace: {},
      overviewTabAutoOpenedByWorkspace: {},
    });
  });

  it("keeps the Explorer tab the entering navigation revealed, and still adds Overview", () => {
    enterWithExplorerScreen();
    applyExplorerEntryDecision(entry);
    expect(explorerFocus()).toBe("plugin_screen");
    const tabs = collectAllTabs(
      useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]!.root,
    );
    expect(tabs.some((tab) => tab.target.kind === "overview")).toBe(true);
    // The skipped item stays unseen, so it still decides the next entry.
    expect(
      useWorkspaceLayoutStore.getState().explorerAttentionByWorkspace[workspaceKey],
    ).toBeUndefined();
  });

  it("switches Explorer to the attention item's tab on an ordinary entry", () => {
    enterWithExplorerScreen();
    takeExplicitExplorerReveal(workspaceKey);
    applyExplorerEntryDecision(entry);
    expect(explorerFocus()).toBe("overview");
  });
});

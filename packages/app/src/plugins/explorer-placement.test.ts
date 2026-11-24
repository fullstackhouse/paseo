import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { usePanelStore } from "@/stores/panel-store";
import { type WorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { showWorkspaceExplorer } from "./explorer-placement";

beforeEach(() => {
  const workspaces = new Map([["workspace-1", { id: "workspace-1" } as WorkspaceDescriptor]]);
  useSessionStore.setState({
    sessions: { "server-1": { workspaces } },
  } as unknown as Partial<ReturnType<typeof useSessionStore.getState>>);
  usePanelStore.setState({ mobilePanel: { target: "agent", revision: 0 } });
  useWorkspaceLayoutStore.setState({
    layoutMode: "compact",
    sheetsByWorkspace: {},
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
  });
});

describe("showWorkspaceExplorer", () => {
  it("shows Explorer and places the tab there on wide layouts", () => {
    useWorkspaceLayoutStore.getState().setLayoutMode("split-panes");
    expect(showWorkspaceExplorer("server-1", "workspace-1")).toMatchObject({ mode: "pane" });
  });

  it("leaves the chat in view on compact layouts, so the tab opens in a sheet", () => {
    expect(showWorkspaceExplorer("server-1", "workspace-1")).toBeUndefined();
    expect(usePanelStore.getState().mobilePanel.target).toBe("agent");
  });
});

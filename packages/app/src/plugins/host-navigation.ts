import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useMemo } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { showWorkspaceExplorer } from "./explorer-placement";
import { createPluginHostNavigation } from "./host-navigation-model";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { pluginRegistry } from "./registry";
import { buildPluginSurfaceRoute } from "./routes";
import { router } from "expo-router";

export function usePluginHostNavigation(
  serverId: string,
): NonNullable<PluginSurfaceProps["navigation"]> {
  return useMemo(
    () =>
      createPluginHostNavigation(serverId, {
        browserAvailable: getIsElectron(),
        isHostRegistered: (targetServerId) =>
          getHostRuntimeStore()
            .getHosts()
            .some((host) => host.serverId === targetServerId),
        openAgent: navigateToAgent,
        openWorkspace: navigateToWorkspace,
        createBrowser: createWorkspaceBrowser,
        focusHost: (targetServerId) => useSidebarViewStore.getState().focusHost(targetServerId),
        findPlugin: ({ serverId: targetServerId, pluginId }) =>
          pluginRegistry
            .getSnapshot()
            .find((plugin) => plugin.serverId === targetServerId && plugin.id === pluginId) ?? null,
        openScreen: ({ serverId: targetServerId, pluginId, screenId, params }) =>
          router.push(
            buildPluginSurfaceRoute(
              targetServerId,
              pluginId,
              { kind: "surface", id: screenId },
              params,
            ),
          ),
        resolveWorkspace: ({ serverId: targetServerId, workspaceId }) =>
          resolveWorkspaceMapKeyByIdentity({
            workspaces: useSessionStore.getState().sessions[targetServerId]?.workspaces,
            workspaceId,
          }),
        showExplorer: ({ serverId: targetServerId, workspaceId }) =>
          showWorkspaceExplorer(targetServerId, workspaceId),
      }),
    [serverId],
  );
}

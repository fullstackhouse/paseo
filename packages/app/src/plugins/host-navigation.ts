import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useMemo } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";

import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { createPluginHostNavigation } from "./host-navigation-model";
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
        openAgent: navigateToAgent,
        openWorkspace: navigateToWorkspace,
        createBrowser: createWorkspaceBrowser,
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
      }),
    [serverId],
  );
}

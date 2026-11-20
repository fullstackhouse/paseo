import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { NavigateToWorkspaceInput } from "@/stores/navigation-active-workspace-store";
import { parseServerIdFromPathname } from "@/utils/host-routes";
import type { WorkspaceTabPlacement } from "@/stores/workspace-layout-actions";
import { isHttpUrl } from "@/utils/http-url";
import { parsePluginOpenScreenInput } from "./surface-contribution";
import type { InstalledPlugin } from "./types";

interface HostNavigationOwner {
  browserAvailable: boolean;
  isHostRegistered(serverId: string): boolean;
  openAgent(input: { serverId: string; agentId: string }): string;
  openWorkspace(input: NavigateToWorkspaceInput): string;
  resolveWorkspace(input: { serverId: string; workspaceId: string }): string | null;
  /** Shows the workspace's Explorer sidebar; the placement opens a tab in it. */
  showExplorer(input: { serverId: string; workspaceId: string }): WorkspaceTabPlacement | undefined;
  createBrowser(input: { initialUrl: string }): { browserId: string };
  focusHost(serverId: string): void;
  findPlugin(input: { serverId: string; pluginId: string }): InstalledPlugin | null;
  openScreen(input: {
    serverId: string;
    pluginId: string;
    screenId: string;
    params: Record<string, string>;
  }): void;
}

export function createPluginHostNavigation(
  serverId: string,
  owner: HostNavigationOwner,
): NonNullable<PluginSurfaceProps["navigation"]> {
  function findScreen(input: { pluginId: string; screenId: string; serverId?: string }) {
    const plugin = owner.findPlugin({
      serverId: input.serverId ?? serverId,
      pluginId: input.pluginId,
    });
    if (!plugin?.surfaces.some((surface) => surface.id === input.screenId)) return null;
    return plugin;
  }
  const focusRouteHost = (route: string) => {
    const destinationServerId = parseServerIdFromPathname(route);
    if (destinationServerId && owner.isHostRegistered(destinationServerId)) {
      owner.focusHost(destinationServerId);
    }
  };

  return {
    openPluginScreen: (input) => {
      const plugin = findScreen(input);
      if (!plugin)
        throw new Error(`Plugin screen is unavailable: ${input.pluginId}/${input.screenId}`);
      const { screenId, params, workspaceId, location } = parsePluginOpenScreenInput(plugin, input);
      if (workspaceId) {
        const placement =
          location === "explorer"
            ? owner.showExplorer({ serverId: plugin.serverId, workspaceId })
            : undefined;
        owner.openWorkspace({
          serverId: plugin.serverId,
          workspaceId,
          target: { kind: "plugin_screen", pluginId: plugin.id, screenId, params },
          ...(placement ? { placement } : {}),
        });
        return;
      }
      owner.openScreen({ serverId: plugin.serverId, pluginId: plugin.id, screenId, params });
    },
    hasPluginScreen: (input) => findScreen(input) !== null,
    supportsFocusHost: true,
    openAgent: ({ agentId, serverId: targetServerId, focusHost }) => {
      const route = owner.openAgent({ serverId: targetServerId ?? serverId, agentId });
      if (focusHost) focusRouteHost(route);
    },
    openWorkspace: ({ workspaceId, serverId: targetServerId, focusHost }) => {
      const route = owner.openWorkspace({ serverId: targetServerId ?? serverId, workspaceId });
      if (focusHost) focusRouteHost(route);
    },
    openBrowser: owner.browserAvailable
      ? ({ url, workspaceId, serverId: targetServerId }) => {
          if (!isHttpUrl(url)) throw new Error("Only absolute HTTP(S) URLs are supported.");
          if (!workspaceId.trim()) throw new Error("workspaceId is required.");
          const destinationServerId = targetServerId ?? serverId;
          const destinationWorkspaceId = owner.resolveWorkspace({
            serverId: destinationServerId,
            workspaceId,
          });
          if (!destinationWorkspaceId)
            throw new Error("Workspace is unavailable on the requested host.");
          const { browserId } = owner.createBrowser({ initialUrl: url });
          owner.openWorkspace({
            serverId: destinationServerId,
            workspaceId: destinationWorkspaceId,
            target: { kind: "browser", browserId },
          });
        }
      : undefined,
  };
}

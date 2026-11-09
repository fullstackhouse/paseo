import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { NavigateToWorkspaceInput } from "@/stores/navigation-active-workspace-store";
import { isHttpUrl } from "@/utils/http-url";
import { parsePluginOpenScreenInput } from "./surface-contribution";
import type { InstalledPlugin } from "./types";

interface HostNavigationOwner {
  browserAvailable: boolean;
  openAgent(input: { serverId: string; agentId: string }): void;
  openWorkspace(input: NavigateToWorkspaceInput): void;
  resolveWorkspace(input: { serverId: string; workspaceId: string }): string | null;
  createBrowser(input: { initialUrl: string }): { browserId: string };
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
  return {
    openPluginScreen: (input) => {
      const plugin = findScreen(input);
      if (!plugin)
        throw new Error(`Plugin screen is unavailable: ${input.pluginId}/${input.screenId}`);
      const { screenId, params } = parsePluginOpenScreenInput(plugin, input);
      owner.openScreen({ serverId: plugin.serverId, pluginId: plugin.id, screenId, params });
    },
    hasPluginScreen: (input) => findScreen(input) !== null,
    openAgent: ({ agentId, serverId: targetServerId }) =>
      owner.openAgent({ serverId: targetServerId ?? serverId, agentId }),
    openWorkspace: ({ workspaceId, serverId: targetServerId }) =>
      owner.openWorkspace({ serverId: targetServerId ?? serverId, workspaceId }),
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

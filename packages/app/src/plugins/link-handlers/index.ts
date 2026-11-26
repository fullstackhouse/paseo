import { useCallback, useMemo } from "react";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { openExternalUrl } from "@/utils/open-external-url";
import { createPluginCapabilities } from "../actions";
import { createPluginNavigation } from "../navigation";
import { useInstalledPlugins } from "../registry";
import { matchPluginLinkHandler } from "./model";

/** A link a plugin opens inside Paseo: its menu title and the action a click runs. */
export interface ResolvedPluginLink {
  url: string;
  title: string;
  open(): void;
}

export interface PluginLinkResolver {
  /** Whether any installed plugin handles links; surfaces skip their link menus otherwise. */
  active: boolean;
  resolve(url: string): ResolvedPluginLink | null;
}

/**
 * Resolves links to the plugin that opens them. `serverId` is the host whose content shows the
 * link; without one, the active workspace's host is preferred.
 */
export function usePluginLinkResolver(serverId?: string | null): PluginLinkResolver {
  const installed = useInstalledPlugins();
  const plugins = useMemo(
    () => installed.filter((plugin) => plugin.linkHandlers.length > 0),
    [installed],
  );
  const selection = useActiveWorkspaceSelection();
  const hostId = serverId ?? selection?.serverId ?? null;
  const selectedServerId = selection?.serverId ?? null;
  const selectedWorkspaceId = selection?.workspaceId ?? null;
  const resolve = useCallback(
    (url: string): ResolvedPluginLink | null => {
      if (plugins.length === 0) return null;
      const match = matchPluginLinkHandler(plugins, hostId, url);
      if (!match) return null;
      const { plugin, handler } = match;
      const workspaceId = selectedServerId === plugin.serverId ? selectedWorkspaceId : null;
      return {
        url,
        title: plugin.i18n.resolve(handler.title, plugin.locale),
        open() {
          const navigation = createPluginNavigation({ serverId: plugin.serverId, workspaceId });
          void (async () => {
            try {
              await handler.open({
                ...createPluginCapabilities(plugin, navigation),
                url,
                workspaceId,
              });
            } catch (error) {
              // The link still has to go somewhere.
              console.error(`[plugin ${plugin.id}] link handler ${handler.id} failed`, error);
              await openExternalUrl(url);
            }
          })();
        },
      };
    },
    [plugins, hostId, selectedServerId, selectedWorkspaceId],
  );
  const active = plugins.length > 0;
  return useMemo(() => ({ active, resolve }), [active, resolve]);
}

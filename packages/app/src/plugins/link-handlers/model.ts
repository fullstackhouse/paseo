import { isHttpUrl } from "@/utils/http-url";
import type { InstalledPlugin, PluginLinkHandlerContribution } from "../types";

export interface PluginLinkHandlerMatch {
  plugin: InstalledPlugin;
  handler: PluginLinkHandlerContribution;
}

/**
 * The first handler that claims `url`. Plugins on `serverId` win over the others, so a link in a
 * host's chat opens with that host's plugin when several hosts install it.
 */
export function matchPluginLinkHandler(
  plugins: readonly InstalledPlugin[],
  serverId: string | null,
  url: string,
): PluginLinkHandlerMatch | null {
  if (!isHttpUrl(url)) return null;
  const ordered = serverId
    ? [
        ...plugins.filter((plugin) => plugin.serverId === serverId),
        ...plugins.filter((plugin) => plugin.serverId !== serverId),
      ]
    : plugins;
  for (const plugin of ordered) {
    for (const handler of plugin.linkHandlers) {
      if (safeMatch(plugin, handler, url)) return { plugin, handler };
    }
  }
  return null;
}

function safeMatch(
  plugin: InstalledPlugin,
  handler: PluginLinkHandlerContribution,
  url: string,
): boolean {
  try {
    return handler.match(url) === true;
  } catch (error) {
    console.error(`[plugin ${plugin.id}] link handler ${handler.id} failed to match`, error);
    return false;
  }
}

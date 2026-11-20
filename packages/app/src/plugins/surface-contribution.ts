import type {
  PluginPanelLocation,
  PluginScreenLocation,
  PluginScreenParams,
} from "@getpaseo/plugin/client";
import {
  parsePluginScreenParams,
  parsePluginSurfaceRoute,
  pluginScreenParamsFromRoute,
} from "./routes";
import type { InstalledPlugin } from "./types";
import type { PluginCatalogStatus } from "./registry";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

export type PluginSurfacePlaceholderStatus = "loading" | "offline" | "error" | "unavailable";

interface PluginSurfacePlaceholderInput {
  connectionStatus: HostRuntimeConnectionStatus;
  catalogStatus: PluginCatalogStatus;
}

export function resolvePluginSurfacePlaceholder({
  connectionStatus,
  catalogStatus,
}: PluginSurfacePlaceholderInput): PluginSurfacePlaceholderStatus {
  if (connectionStatus === "offline" || connectionStatus === "error") return "offline";
  if (connectionStatus !== "online") return "loading";
  if (catalogStatus === "loading") return "loading";
  if (catalogStatus === "error") return "error";
  return "unavailable";
}

export type PluginSurfaceContributionIdentity =
  | { kind: "sidebar"; id: string }
  | { kind: "surface"; id: string };

/**
 * A `sidebar` identity is a legacy `addSidebarItem` route: it resolves to that item and its screen,
 * or, once the plugin has moved that item to `addScreen` under the same id, to that screen.
 */
export function resolvePluginSurfaceContribution(
  plugin: InstalledPlugin | null,
  identity: PluginSurfaceContributionIdentity | null,
): {
  sidebarItem: InstalledPlugin["legacySidebarItems"][number] | null;
  surface: InstalledPlugin["surfaces"][number] | null;
} {
  if (!identity || !plugin) return { sidebarItem: null, surface: null };
  const sidebarItem =
    identity.kind === "sidebar"
      ? (plugin.legacySidebarItems.find((contribution) => contribution.id === identity.id) ?? null)
      : null;
  const surfaceId = sidebarItem ? sidebarItem.surface : identity.id;
  const surface = surfaceId
    ? (plugin.surfaces.find((contribution) => contribution.id === surfaceId) ?? null)
    : null;
  return { sidebarItem, surface };
}

/**
 * The screen header's title. A legacy `addSidebarItem` pointing at the screen lends its title, as
 * before screens had one. A title function that throws or returns an empty string falls back to the
 * screen id, so a bad title never takes the screen down.
 */
export function resolvePluginScreenTitle(
  screen: InstalledPlugin["surfaces"][number],
  legacySidebarItem: InstalledPlugin["legacySidebarItems"][number] | null,
  params: PluginScreenParams,
  resolve: (text: import("@getpaseo/plugin/client").PluginText) => string,
): string {
  if (legacySidebarItem) return resolve(legacySidebarItem.title);
  if (typeof screen.title !== "function") return resolve(screen.title);
  try {
    const title = resolve(screen.title(params));
    if (typeof title === "string" && title.trim()) return title.trim();
  } catch (error) {
    console.warn(`[Plugins] Screen ${screen.id} title failed`, error);
  }
  return screen.id;
}

/**
 * The installation's screen open at `pathname` with the route's search params, or null when the
 * route shows anything else.
 */
export function currentPluginScreen(
  plugin: InstalledPlugin,
  pathname: string,
  routeParams: Readonly<Record<string, string | string[] | undefined>>,
): PluginScreenLocation | null {
  const route = parsePluginSurfaceRoute(pathname);
  if (!route || route.serverId !== plugin.serverId || route.pluginId !== plugin.id) return null;
  const screenId = resolvePluginSurfaceContribution(plugin, route.identity).surface?.id;
  return screenId ? { screenId, params: pluginScreenParamsFromRoute(routeParams) } : null;
}

/** An `openScreen` input past validation; `workspaceId` is set when the screen opens as a tab. */
export interface PluginOpenScreenRequest extends PluginScreenLocation {
  workspaceId: string | null;
  /** Which part of the workspace the tab opens in; meaningless without `workspaceId`. */
  location: PluginPanelLocation;
}

/** Checks an `openScreen` input against the installation's screens. Throws when it is invalid. */
export function parsePluginOpenScreenInput(
  plugin: InstalledPlugin,
  input: unknown,
): PluginOpenScreenRequest {
  if (typeof input !== "object" || input === null || !("screenId" in input)) {
    throw new Error("openScreen takes { screenId, params?, workspaceId?, location? }");
  }
  const { screenId } = input;
  if (typeof screenId !== "string" || !plugin.surfaces.some((surface) => surface.id === screenId)) {
    throw new Error(`Plugin screen is unavailable: ${String(screenId)}`);
  }
  const params = "params" in input ? input.params : undefined;
  const workspaceId = "workspaceId" in input ? input.workspaceId : undefined;
  if (workspaceId !== undefined && typeof workspaceId !== "string") {
    throw new Error("Plugin screen workspaceId must be a string");
  }
  const location = "location" in input ? input.location : undefined;
  if (location !== undefined && location !== "workspace" && location !== "explorer") {
    throw new Error('Plugin screen location must be "workspace" or "explorer"');
  }
  return {
    screenId,
    params: parsePluginScreenParams(params),
    workspaceId: workspaceId?.trim() || null,
    location: location ?? "workspace",
  };
}

export function getPluginSurfaceContributionServerIds(
  installations: readonly InstalledPlugin[],
  pluginId: string,
  identity: PluginSurfaceContributionIdentity,
): string[] {
  return installations
    .filter(
      (installation) =>
        installation.id === pluginId &&
        resolvePluginSurfaceContribution(installation, identity).surface !== null,
    )
    .map((installation) => installation.serverId);
}

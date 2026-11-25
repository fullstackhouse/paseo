import { PluginClientStateProvider } from "@getpaseo/plugin/client/host";
import type { PluginWorkspaceSummaryEntryProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useCallback, useMemo, type ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { createPluginClientStateSource } from "../client-state/source";
import { usePluginHostNavigation } from "../host-navigation";
import { PluginInstallationProvider } from "../installation-provider";
import { resolvePluginPlatform } from "../platform";
import { useInstalledPlugin } from "../registry";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { toPluginTheme } from "../theme";
import type { WorkspaceSummaryItem } from "./store";

const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });

interface EntryViewProps {
  item: WorkspaceSummaryItem;
  entryId: string;
  defaultExpanded: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** For an `inProgress` entry: its In progress row says nothing moves it. */
  nothingMoving?: boolean;
  /** Shown instead when the plugin is gone or its component throws. */
  children: ReactElement;
}

function EntryBody({
  item,
  entryId,
  defaultExpanded,
  expanded,
  onExpandedChange,
  nothingMoving,
  children: fallback,
  theme,
}: EntryViewProps & { theme: PluginTheme }) {
  const plugin = useInstalledPlugin(item.serverId, item.pluginId);
  const compact = useIsCompactFormFactor();
  const hostLabel =
    useHosts().find((host) => host.serverId === item.serverId)?.label ?? item.serverId;
  const stateSource = useMemo(() => createPluginClientStateSource(item.serverId), [item.serverId]);
  const navigation = usePluginHostNavigation(item.serverId);
  const props = useMemo<PluginWorkspaceSummaryEntryProps>(
    () => ({
      theme,
      host: { id: item.serverId, label: hostLabel },
      layout: { compact, platform: resolvePluginPlatform() },
      navigation,
      workspaceId: item.workspaceId,
      entryId,
      defaultExpanded,
      expanded,
      onExpandedChange,
      ...(nothingMoving === undefined ? {} : { nothingMoving }),
    }),
    [
      compact,
      defaultExpanded,
      entryId,
      expanded,
      hostLabel,
      item.serverId,
      item.workspaceId,
      navigation,
      nothingMoving,
      onExpandedChange,
      theme,
    ],
  );
  const renderFallback = useCallback(() => fallback, [fallback]);
  const Entry = item.EntryComponent;
  if (!plugin || !Entry) return fallback;
  return (
    <SurfaceErrorBoundary installation={plugin} Surface={Entry} renderError={renderFallback}>
      <PluginInstallationProvider plugin={plugin}>
        <PluginClientStateProvider source={stateSource}>
          <Entry {...props} />
        </PluginClientStateProvider>
      </PluginInstallationProvider>
    </SurfaceErrorBoundary>
  );
}

const ThemedEntryBody = withUnistyles(EntryBody);

/** One plugin summary entry, rendered by the plugin itself so it can be acted on in place. */
export function WorkspaceSummaryEntryView(props: EntryViewProps): ReactElement {
  return <ThemedEntryBody {...props} uniProps={pluginThemeMapping} />;
}

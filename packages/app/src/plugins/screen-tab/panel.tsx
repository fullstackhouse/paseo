import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenRuntimeTitle } from "@getpaseo/plugin/client";
import { PluginClientStateProvider } from "@getpaseo/plugin/client/host";
import { AppWindow, CircleAlert } from "lucide-react-native";
import { useCallback, useMemo, useRef } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePaneContext } from "@/panels/pane-context";
import {
  definePanel,
  type PanelDescriptor,
  type PanelDescriptorContext,
} from "@/panels/panel-registry";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import type { PluginScreenWorkspaceTabTarget } from "@/workspace-tabs/model";
import { createPluginClientStateSource } from "../client-state/source";
import { usePluginHostNavigation } from "../host-navigation";
import { PluginInstallationProvider } from "../installation-provider";
import { resolvePluginPlatform } from "../platform";
import { useInstalledPlugin } from "../registry";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { resolvePluginScreenTitle } from "../surface-contribution";
import { toPluginTheme } from "../theme";
import { nextPluginScreenTabState, readPluginScreenTabTitle } from "./runtime-title";

const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });

function usePluginScreen(serverId: string, target: PluginScreenWorkspaceTabTarget) {
  const plugin = useInstalledPlugin(serverId, target.pluginId);
  const screen = plugin?.surfaces.find((surface) => surface.id === target.screenId) ?? null;
  return { plugin, screen };
}

/** A plugin screen in a workspace tab: the same component and params as its full-screen route. */
function PluginScreenTabBody({ theme }: { theme: PluginTheme }) {
  const { serverId, target, state, setCurrentTabState } = usePaneContext();
  invariant(target.kind === "plugin_screen", "PluginScreenTab requires a plugin screen target");
  // Stable for the plugin's effects; reads the latest state so repeated titles write nothing.
  const stateRef = useRef(state);
  stateRef.current = state;
  const setTitle = useCallback(
    (title: PluginScreenRuntimeTitle | null) => {
      const next = nextPluginScreenTabState(stateRef.current, title);
      if (next === null) return;
      stateRef.current = next;
      setCurrentTabState(next);
    },
    [setCurrentTabState],
  );
  const { plugin, screen } = usePluginScreen(serverId, target);
  const client = useHostRuntimeClient(serverId);
  const compact = useIsCompactFormFactor();
  const hosts = useHosts();
  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const host = useMemo(() => ({ id: serverId, label: hostLabel }), [hostLabel, serverId]);
  const layout = useMemo(() => ({ compact, platform: resolvePluginPlatform() }), [compact]);
  const stateSource = useMemo(() => createPluginClientStateSource(serverId), [serverId]);
  const navigation = usePluginHostNavigation(serverId);

  if (!plugin || !screen) return <Unavailable message="This plugin screen is unavailable." />;
  if (!client) return <Unavailable message="Plugin host is offline." />;
  const Screen = screen.Component;
  return (
    <View style={styles.root} testID="plugin-screen-tab">
      <SurfaceErrorBoundary
        key={`${serverId}/${target.pluginId}/${target.screenId}`}
        installation={plugin}
        Surface={Screen}
      >
        <PluginInstallationProvider plugin={plugin}>
          <PluginClientStateProvider source={stateSource}>
            <Screen
              theme={theme}
              host={host}
              layout={layout}
              navigation={navigation}
              params={target.params}
              setTitle={setTitle}
            />
          </PluginClientStateProvider>
        </PluginInstallationProvider>
      </SurfaceErrorBoundary>
    </View>
  );
}

const ThemedPluginScreenTabBody = withUnistyles(PluginScreenTabBody);

function PluginScreenTab() {
  return <ThemedPluginScreenTabBody uniProps={pluginThemeMapping} />;
}

function Unavailable({ message }: { message: string }) {
  return (
    <View style={styles.unavailable}>
      <Text style={styles.unavailableText}>{message}</Text>
    </View>
  );
}

function usePluginScreenTabDescriptor(
  target: PluginScreenWorkspaceTabTarget,
  context: PanelDescriptorContext,
): PanelDescriptor {
  const { plugin, screen } = usePluginScreen(context.serverId, target);
  const runtimeTitle = readPluginScreenTabTitle(context.state);
  const title = useMemo(
    () =>
      plugin && screen
        ? resolvePluginScreenTitle(screen, null, target.params, (text) =>
            plugin.i18n.resolve(text, plugin.locale),
          )
        : null,
    [plugin, screen, target.params],
  );
  if (!title) {
    return {
      label: "Plugin unavailable",
      subtitle: target.pluginId,
      tooltip: "This plugin screen is unavailable",
      titleState: "ready",
      icon: CircleAlert,
      statusBucket: null,
    };
  }
  return {
    label: runtimeTitle?.label ?? title,
    subtitle: target.pluginId,
    tooltip: runtimeTitle?.tooltip ?? title,
    titleState: "ready",
    icon: AppWindow,
    statusBucket: null,
  };
}

export const pluginScreenTabRegistration = definePanel("plugin_screen", {
  component: PluginScreenTab,
  useDescriptor: usePluginScreenTabDescriptor,
});

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
  unavailable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  unavailableText: { color: theme.colors.foregroundMuted },
}));

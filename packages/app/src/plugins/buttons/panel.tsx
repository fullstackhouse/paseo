import { useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CircleAlert } from "lucide-react-native";
import invariant from "tiny-invariant";
import { ScrollView } from "@/components/ui/scroll-view";
import { usePaneContext } from "@/panels/pane-context";
import {
  definePanel,
  type PanelDescriptorContext,
  type PanelIconProps,
} from "@/panels/panel-registry";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { pluginButtonStore } from "./store";
import { PluginButtonPanelContent, PluginButtonPanelIcon } from "./view";

type ButtonTarget = Extract<WorkspaceTabTarget, { kind: "plugin_button" }>;

function usePanelButton(
  target: ButtonTarget,
  context: Pick<PanelDescriptorContext, "serverId" | "workspaceId">,
) {
  const entries = useSyncExternalStore(
    pluginButtonStore.subscribe,
    pluginButtonStore.getSnapshot,
    pluginButtonStore.getSnapshot,
  );
  return entries.find(
    (entry) =>
      entry.installation.serverId === context.serverId &&
      entry.installation.id === target.pluginId &&
      entry.id === target.buttonId &&
      entry.placement === "composer" &&
      entry.context.workspaceId === context.workspaceId &&
      entry.context.context === "agent" &&
      entry.context.agentId === target.agentId &&
      entry.button.visible &&
      !entry.button.disabled &&
      entry.button.behavior.kind === "popover",
  );
}

function PluginButtonPanel() {
  const context = usePaneContext();
  invariant(context.target.kind === "plugin_button", "PluginButtonPanel requires a button target");
  const entry = usePanelButton(context.target, context);
  return (
    <View style={styles.root} testID="plugin-button-panel">
      {entry ? (
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          <PluginButtonPanelContent entry={entry} onClose={context.closeCurrentTab} />
        </ScrollView>
      ) : (
        <Text style={styles.unavailable}>This plugin button is unavailable.</Text>
      )}
    </View>
  );
}

function useButtonPanelDescriptor(target: ButtonTarget, context: PanelDescriptorContext) {
  const entry = usePanelButton(target, context);
  const icon = useMemo(() => {
    if (!entry) return CircleAlert;
    return function ButtonPanelIcon(props: PanelIconProps) {
      return <PluginButtonPanelIcon entry={entry} {...props} />;
    };
  }, [entry]);
  return {
    label: entry?.button.title ?? "Plugin unavailable",
    subtitle: target.pluginId,
    tooltip: entry?.button.title ?? "This plugin button is unavailable",
    titleState: "ready" as const,
    icon,
    statusBucket: null,
  };
}

export const pluginButtonPanelRegistration = definePanel("plugin_button", {
  component: PluginButtonPanel,
  useDescriptor: useButtonPanelDescriptor,
});

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
  scroll: { flex: 1 },
  unavailable: { padding: theme.spacing[4], color: theme.colors.foregroundMuted },
}));

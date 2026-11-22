import React, { useCallback } from "react";
import { Alert, Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { SettingsRevealText } from "@/components/settings/reveal-text";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

export const BROWSER_LIVE_VIEW_TITLE = "Browser live view (experimental)";
export const BROWSER_LIVE_VIEW_HINT =
  "Lets your phone view an agent's browser tab. Off by default.";

// COMPAT(browserLiveViewFlag): experimental opt-in added after v0.15.4, remove once live view ships on by default.
export function BrowserLiveViewCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ browserLiveView: next }).catch((error) => {
        console.error("[HostPage] Failed to update browser live view", error);
        Alert.alert(
          "Unable to update browser live view",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-browser-live-view-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <SettingsRevealText style={settingsStyles.rowTitle}>
            {BROWSER_LIVE_VIEW_TITLE}
          </SettingsRevealText>
          <Text style={settingsStyles.rowHint}>{BROWSER_LIVE_VIEW_HINT}</Text>
        </View>
        <Switch
          value={config?.browserLiveView === true}
          onValueChange={handleValueChange}
          accessibilityLabel={BROWSER_LIVE_VIEW_TITLE}
          testID="host-page-browser-live-view-switch"
        />
      </View>
    </View>
  );
}

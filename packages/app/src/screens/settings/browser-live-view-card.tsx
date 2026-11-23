import React, { useCallback } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { SettingsRevealText } from "@/components/settings/reveal-text";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

// COMPAT(browserLiveViewFlag): experimental opt-in added after v0.15.4, remove once live view ships on by default.
export function BrowserLiveViewCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ browserLiveView: next }).catch((error) => {
        console.error("[HostPage] Failed to update browser live view", error);
        Alert.alert(
          t("settings.host.agents.browserLiveView.updateFailed"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, t],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-browser-live-view-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <SettingsRevealText style={settingsStyles.rowTitle}>
            {t("settings.host.agents.browserLiveView.title")}
          </SettingsRevealText>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.agents.browserLiveView.hint")}
          </Text>
        </View>
        <Switch
          value={config?.browserLiveView === true}
          onValueChange={handleValueChange}
          accessibilityLabel={t("settings.host.agents.browserLiveView.title")}
          testID="host-page-browser-live-view-switch"
        />
      </View>
    </View>
  );
}

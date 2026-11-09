import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import type { SnoozedPermissionBehavior } from "@getpaseo/protocol/messages";
import { SettingsCard, SettingsSelect } from "@/components/settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";

const BEHAVIORS: readonly SnoozedPermissionBehavior[] = ["wake", "badge", "silent"];

// Host-wide: the daemon decides at the moment an agent blocks, whichever client is open.
export function SnoozedPermissionCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useHostFeature(serverId, "workspaceSnooze");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const options = useMemo(
    () =>
      BEHAVIORS.map((value) => ({
        value,
        label: t(`settings.host.workspaces.snoozedPermission.options.${value}`),
      })),
    [t],
  );
  const handleChange = useCallback(
    (value: SnoozedPermissionBehavior) => {
      void patchConfig({ snoozedPermission: value }).catch((error) => {
        Alert.alert(
          t("settings.host.workspaces.snoozedPermission.updateFailed"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, t],
  );

  if (!isConnected || !isSupported || !config) return null;

  return (
    <SettingsCard testID="host-page-snoozed-permission-card">
      <SettingsSelect
        label={t("settings.host.workspaces.snoozedPermission.title")}
        hint={t("settings.host.workspaces.snoozedPermission.hint")}
        value={config.snoozedPermission ?? "wake"}
        options={options}
        onValueChange={handleChange}
        testID="host-page-snoozed-permission-select"
      />
    </SettingsCard>
  );
}

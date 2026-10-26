import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { SettingsCard, SettingsSection, SettingsSelect } from "@/components/settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";

const PROVIDER_DEFAULT = "";

function getImplementationModes(entry: ProviderSnapshotEntry) {
  return (entry.modes ?? []).filter((mode) => mode.id !== "plan");
}

export function PlanApprovalModesSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries } = useProvidersSnapshot(serverId);

  const providers = (entries ?? []).filter(
    (entry) => entry.enabled && getImplementationModes(entry).length > 0,
  );
  if (!isConnected || providers.length === 0) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.host.planApprovalMode.title")}>
      <SettingsCard>
        {providers.map((entry) => (
          <PlanApprovalModeRow key={entry.provider} serverId={serverId} entry={entry} />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

function PlanApprovalModeRow({
  serverId,
  entry,
}: {
  serverId: string;
  entry: ProviderSnapshotEntry;
}) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const { provider } = entry;

  const options = useMemo(
    () => [
      { value: PROVIDER_DEFAULT, label: t("settings.host.planApprovalMode.providerDefault") },
      ...getImplementationModes(entry).map((mode) => ({ value: mode.id, label: mode.label })),
    ],
    [entry, t],
  );

  const changeMode = useCallback(
    (modeId: string) => {
      void patchConfig({
        providers: { [provider]: { planApprovalModeId: modeId || null } },
      }).catch((error) => {
        console.error("[HostPage] Failed to update plan approval mode", error);
        Alert.alert(
          t("settings.host.planApprovalMode.updateFailed"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, provider, t],
  );

  return (
    <SettingsSelect
      label={entry.label ?? provider}
      hint={t("settings.host.planApprovalMode.description")}
      value={config?.providers[provider]?.planApprovalModeId ?? PROVIDER_DEFAULT}
      options={options}
      onValueChange={changeMode}
    />
  );
}

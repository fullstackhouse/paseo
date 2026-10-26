import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { SettingsCard, SettingsSection, SettingsSelect } from "@/components/settings";
import { useAppSettings } from "@/hooks/use-settings";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHosts } from "@/runtime/host-runtime";

const PROVIDER_DEFAULT = "";

function getImplementationModes(entry: ProviderSnapshotEntry) {
  return (entry.modes ?? []).filter((mode) => mode.id !== "plan");
}

export function PlanApprovalSection() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { entries } = useProvidersSnapshot(hosts[0]?.serverId ?? null);

  const providers = (entries ?? []).filter(
    (entry) => entry.enabled && getImplementationModes(entry).length > 0,
  );
  if (providers.length === 0) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.general.planApprovalMode.title")}>
      <SettingsCard>
        {providers.map((entry) => (
          <PlanApprovalModeRow key={entry.provider} entry={entry} />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

function PlanApprovalModeRow({ entry }: { entry: ProviderSnapshotEntry }) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const { provider } = entry;

  const options = useMemo(
    () => [
      { value: PROVIDER_DEFAULT, label: t("settings.general.planApprovalMode.providerDefault") },
      ...getImplementationModes(entry).map((mode) => ({ value: mode.id, label: mode.label })),
    ],
    [entry, t],
  );

  const changeMode = useCallback(
    (modeId: string) => {
      const { [provider]: _previous, ...rest } = settings.planApprovalModes;
      void updateSettings({
        planApprovalModes: modeId === PROVIDER_DEFAULT ? rest : { ...rest, [provider]: modeId },
      });
    },
    [provider, settings.planApprovalModes, updateSettings],
  );

  return (
    <SettingsSelect
      label={entry.label ?? provider}
      hint={t("settings.general.planApprovalMode.description")}
      value={settings.planApprovalModes[provider] ?? PROVIDER_DEFAULT}
      options={options}
      onValueChange={changeMode}
    />
  );
}

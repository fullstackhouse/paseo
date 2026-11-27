import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import type { ChatTitleMode } from "@getpaseo/protocol/messages";
import { SettingsCard, SettingsSelect } from "@/components/settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";

const MODES: readonly ChatTitleMode[] = ["first-prompt", "generated", "agent"];

// Host-wide: the daemon titles a chat when it is created, whichever client created it.
export function ChatTitlesCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useHostFeature(serverId, "chatTitles");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const options = useMemo(
    () =>
      MODES.map((value) => ({
        value,
        label: t(`settings.host.agents.chatTitles.options.${value}`),
      })),
    [t],
  );
  const handleChange = useCallback(
    (value: ChatTitleMode) => {
      void patchConfig({ chatTitles: value }).catch((error) => {
        Alert.alert(
          t("settings.host.agents.chatTitles.updateFailed"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, t],
  );

  if (!isConnected || !isSupported || !config) return null;

  const mode = config.chatTitles ?? "first-prompt";
  return (
    <SettingsCard testID="host-page-chat-titles-card">
      <SettingsSelect
        label={t("settings.host.agents.chatTitles.title")}
        hint={`${t(`settings.host.agents.chatTitles.hints.${mode}`)} ${t("settings.host.agents.chatTitles.renameWins")}`}
        value={mode}
        options={options}
        onValueChange={handleChange}
        testID="host-page-chat-titles-select"
      />
    </SettingsCard>
  );
}

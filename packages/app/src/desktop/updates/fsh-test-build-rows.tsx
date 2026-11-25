// FSH fork: Settings → About rows for test builds (fsh-test-builds.ts): the test build this app
// runs, with Back to stable, and the test builds you can install.
import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsRevealText } from "@/components/settings/reveal-text";
import { Button } from "@/components/ui/button";
import {
  formatTestBuildLabel,
  type FshRelease,
  type FshTestBuild,
} from "@/desktop/updates/fsh-test-builds";
import {
  useConfirmFshRelease,
  type FshReleaseChoice,
} from "@/desktop/updates/use-confirm-fsh-release";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useFshTestBuilds } from "@/desktop/updates/use-fsh-test-builds";
import { settingsStyles } from "@/styles/settings";

export function FshTestBuildRows({
  busy,
  installUpdate,
}: {
  busy: boolean;
  installUpdate: (fshRelease: FshRelease) => unknown;
}) {
  const { t } = useTranslation();
  const { info, refetch } = useFshTestBuilds();
  const confirm = useConfirmFshRelease(installUpdate);
  useFocusEffect(useCallback(() => refetch(), [refetch]));
  const backToStable = useStableEvent(() => confirm({ kind: "stable" }));

  if (!info) return null;
  const installed = info.installedTestBuild;

  return (
    <>
      {installed ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]} testID="fsh-on-test-build">
          <View style={settingsStyles.rowContent}>
            <SettingsRevealText style={settingsStyles.rowTitle}>
              {t("desktop.updates.testBuilds.onTestBuild", {
                build: formatTestBuildLabel(installed),
              })}
            </SettingsRevealText>
            <Text style={settingsStyles.rowHint}>
              {t("desktop.updates.testBuilds.onTestBuildHint")}
            </Text>
          </View>
          <Button
            variant="default"
            onPress={backToStable}
            disabled={busy}
            testID="fsh-back-to-stable"
          >
            {t("desktop.updates.testBuilds.backToStable")}
          </Button>
        </View>
      ) : null}
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <SettingsRevealText style={settingsStyles.rowTitle}>
            {t("desktop.updates.testBuilds.title")}
          </SettingsRevealText>
          <Text style={settingsStyles.rowHint}>
            {info.testBuilds.length > 0
              ? t("desktop.updates.testBuilds.description")
              : t("desktop.updates.testBuilds.none")}
          </Text>
          {info.errorMessage ? <Text style={styles.errorText}>{info.errorMessage}</Text> : null}
        </View>
      </View>
      {info.testBuilds.map((build) => (
        <TestBuildRow
          key={build.tag}
          build={build}
          isInstalled={build.tag === info.installedTag}
          busy={busy}
          confirm={confirm}
        />
      ))}
    </>
  );
}

function TestBuildRow({
  build,
  isInstalled,
  busy,
  confirm,
}: {
  build: FshTestBuild;
  isInstalled: boolean;
  busy: boolean;
  confirm: (choice: FshReleaseChoice) => void;
}) {
  const { t } = useTranslation();
  const install = useStableEvent(() => confirm({ kind: "test", build }));
  return (
    <View
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      testID={`fsh-test-build-${build.tag}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={styles.buildLabel}>{formatTestBuildLabel(build)}</Text>
        {build.publishedAt ? (
          <Text style={settingsStyles.rowHint}>{new Date(build.publishedAt).toLocaleString()}</Text>
        ) : null}
      </View>
      <Button variant="outline" onPress={install} disabled={busy || isInstalled}>
        {isInstalled
          ? t("desktop.updates.testBuilds.installed")
          : t("desktop.updates.testBuilds.install")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  buildLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
}));

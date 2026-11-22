import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { LiveViewSurface } from "./live-view-surface";

interface BrowserPaneProps {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive?: boolean;
  onFocusPane?: () => void;
}

export function BrowserPane({ browserId, serverId, isInteractive = false }: BrowserPaneProps) {
  const supportsLiveView = useHostFeature(serverId, "browserLiveView");
  if (supportsLiveView) {
    return (
      <LiveBrowserPane browserId={browserId} serverId={serverId} isInteractive={isInteractive} />
    );
  }
  return <UnavailableBrowserPane browserId={browserId} serverId={serverId} />;
}

function LiveBrowserPane(props: { browserId: string; serverId: string; isInteractive: boolean }) {
  const client = useHostRuntimeClient(props.serverId);
  const isConnected = useHostRuntimeIsConnected(props.serverId);
  const isPanelActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const isOnScreen = props.isInteractive && isPanelActive && isAppVisible;
  return (
    <LiveViewSurface
      client={client}
      browserId={props.browserId}
      active={isOnScreen && isConnected}
    />
  );
}

function UnavailableBrowserPane(props: { browserId: string; serverId: string }) {
  const { t } = useTranslation();
  const { config } = useDaemonConfig(props.serverId);
  const hint = config ? getLiveViewHint(config.browserLiveView) : null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("workspace.browser.unavailable.title")}</Text>
      {hint ? (
        <Text style={styles.subtitle} testID="browser-live-view-hint">
          {hint}
        </Text>
      ) : null}
      <Text style={styles.subtitle}>
        {t("workspace.browser.session", { browserId: props.browserId })}
      </Text>
    </View>
  );
}

// COMPAT(browserLiveViewFlag): hosts that know the setting report false while it is off; older hosts omit it.
function getLiveViewHint(browserLiveView: boolean | undefined): string {
  if (browserLiveView === false) {
    return "Turn on Browser live view in Host settings → Agents to watch this tab here";
  }
  return "Update Paseo on this host to watch this tab here";
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

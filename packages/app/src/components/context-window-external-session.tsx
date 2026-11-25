import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Check, Copy, ExternalLink } from "lucide-react-native";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore } from "@/stores/session-store";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { openExternalUrl } from "@/utils/open-external-url";

const ThemedCheck = withUnistyles(Check);
const ThemedCopy = withUnistyles(Copy);
const ThemedExternalLink = withUnistyles(ExternalLink);

/**
 * The vendor's session behind an agent, when its provider reports one (a cloud agent's session):
 * its ID with Copy, and a link to the vendor's console. Surfaces that take no presses show the ID only.
 */
export function ContextWindowExternalSession({
  serverId,
  agentId,
  interactive,
}: {
  serverId: string;
  agentId: string;
  interactive: boolean;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const iconSize = paneContentToolbarIconSize(compact);
  const session = useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.runtimeInfo?.externalSession ?? null,
  );
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );
  const id = session?.id;
  const url = session?.url;
  const copy = useCallback(() => {
    if (!id) return;
    void copyToClipboard(id);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [id]);
  const open = useCallback(() => {
    if (url) void openExternalUrl(url);
  }, [url]);

  if (!id) return null;
  const label = t("contextWindow.externalSession", { id });
  if (!interactive) {
    return (
      <Text style={styles.text} selectable numberOfLines={1}>
        {label}
      </Text>
    );
  }
  return (
    <View style={styles.row}>
      <Text style={styles.text} selectable numberOfLines={1}>
        {label}
      </Text>
      <ToolbarButton
        label={t("contextWindow.copyExternalSession")}
        compact={compact}
        tooltipSide="top"
        onPress={copy}
        testID="context-window-external-session-copy"
      >
        {copied ? (
          <ThemedCheck size={iconSize} uniProps={extraMutedIconColorMapping} />
        ) : (
          <ThemedCopy size={iconSize} uniProps={extraMutedIconColorMapping} />
        )}
      </ToolbarButton>
      {url ? (
        <ToolbarButton
          label={t("contextWindow.openExternalSession")}
          compact={compact}
          tooltipSide="top"
          onPress={open}
          testID="context-window-external-session-open"
        >
          <ThemedExternalLink size={iconSize} uniProps={extraMutedIconColorMapping} />
        </ToolbarButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  text: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));

// FSH fork: a failed turn gets a retry above the composer instead of typing "continue".
import { memo, useCallback, type ReactElement } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ComposerTrackActions, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { useResumeAgents } from "@/utils/resume-agents";

const ThemedRotateCcw = withUnistyles(RotateCcw);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ROW_ICON_SIZE = 14;

export function useIsAgentFailed(serverId: string, agentId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.status === "error",
  );
}

/** The failed turn's error, with Retry above it: the error says whether retrying can help. */
export const RetryFailedTurnPill = memo(function RetryFailedTurnPill({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const isFailed = useIsAgentFailed(serverId, agentId);
  const lastError = useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.lastError ?? null,
  );
  const resumeAgents = useResumeAgents();
  const handleRetry = useCallback(() => {
    resumeAgents([{ serverId, id: agentId }]);
  }, [agentId, resumeAgents, serverId]);
  const renderRetryRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <ThemedRotateCcw
          size={ROW_ICON_SIZE}
          uniProps={active ? foregroundColorMapping : foregroundMutedColorMapping}
        />
        <Text style={styles.rowLabel} numberOfLines={1}>
          {t("failedAgents.retry")}
        </Text>
      </>
    ),
    [t],
  );
  if (!isFailed) {
    return null;
  }
  return (
    <ComposerTrackPill
      testID="composer-failed-turn-pill"
      segments={[{ bucket: "failed", text: t("failedAgents.pill") }]}
      panelTitle={t("failedAgents.panelTitle")}
    >
      <ComposerTrackActions divided={Boolean(lastError)}>
        <ComposerTrackRow
          accessibilityLabel={t("failedAgents.retryAccessibilityLabel")}
          testID="composer-failed-turn-retry"
          onPress={handleRetry}
        >
          {renderRetryRow}
        </ComposerTrackRow>
      </ComposerTrackActions>
      {lastError ? (
        <ComposerTrackRow>
          <Text style={styles.errorText} selectable>
            {lastError}
          </Text>
        </ComposerTrackRow>
      ) : null}
    </ComposerTrackPill>
  );
});

const styles = StyleSheet.create((theme) => ({
  rowLabel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  errorText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));

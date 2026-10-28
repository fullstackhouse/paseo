import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { composerPillStyles } from "@/composer/pill-styles";
import {
  useVisibleWorkspaceChanges,
  type WorkspaceChangesSummary,
} from "@/composer/workspace-diff-stat";

interface ComposerDiffStatPillProps {
  changes: WorkspaceChangesSummary;
  onPress: () => void;
}

export function ComposerDiffStatPill({ changes, onPress }: ComposerDiffStatPillProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const bodyStyle = useMemo(
    () => [composerPillStyles.body, isHovered && composerPillStyles.bodyActive],
    [isHovered],
  );
  const { diffStat, ahead, behind, currentBranch, baseRef } = changes;
  const comparison =
    currentBranch && baseRef && currentBranch !== baseRef ? `${currentBranch} → ${baseRef}` : null;
  const hasTooltip = comparison !== null || ahead > 0 || behind > 0;

  return (
    <Tooltip enabledOnDesktop={hasTooltip}>
      <TooltipTrigger
        testID="composer-diff-stat-pill"
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.diff.openChangesTab")}
        onPress={onPress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={bodyStyle}
      >
        {diffStat ? (
          <DiffStat additions={diffStat.additions} deletions={diffStat.deletions} />
        ) : null}
        {ahead > 0 || behind > 0 ? (
          <Text style={styles.sync} testID="composer-diff-stat-pill-sync">
            {[ahead > 0 ? `↑${ahead}` : null, behind > 0 ? `↓${behind}` : null]
              .filter(Boolean)
              .join(" ")}
          </Text>
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="top">
        {comparison ? <Text style={styles.tooltipLabel}>{comparison}</Text> : null}
        {ahead > 0 ? (
          <Text style={styles.tooltipDetail}>
            {t("workspace.git.diff.toPush", { count: ahead })}
          </Text>
        ) : null}
        {behind > 0 ? (
          <Text style={styles.tooltipDetail}>
            {t("workspace.git.diff.toPull", { count: behind })}
          </Text>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export const WorkspaceDiffStatPill = memo(function WorkspaceDiffStatPill({
  serverId,
  workspaceId,
  onPress,
}: {
  serverId: string;
  workspaceId: string;
  onPress: () => void;
}): ReactElement | null {
  const changes = useVisibleWorkspaceChanges(serverId, workspaceId);
  if (!changes) {
    return null;
  }
  return <ComposerDiffStatPill changes={changes} onPress={onPress} />;
});

const styles = StyleSheet.create((theme) => ({
  sync: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  tooltipLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  tooltipDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));

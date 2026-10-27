import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { composerPillStyles } from "@/composer/pill-styles";
import {
  useVisibleWorkspaceDiffStat,
  useWorkspaceGitSyncSummary,
} from "@/composer/workspace-diff-stat";

interface ComposerDiffStatPillProps {
  additions: number;
  deletions: number;
  syncSummary?: string[];
  onPress: () => void;
}

export function ComposerDiffStatPill({
  additions,
  deletions,
  syncSummary = [],
  onPress,
}: ComposerDiffStatPillProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const bodyStyle = useMemo(
    () => [composerPillStyles.body, isHovered && composerPillStyles.bodyActive],
    [isHovered],
  );

  const pill = (
    <Pressable
      testID="composer-diff-stat-pill"
      accessibilityRole="button"
      accessibilityLabel={t("workspace.git.diff.openChangesTab")}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={bodyStyle}
    >
      <DiffStat additions={additions} deletions={deletions} />
    </Pressable>
  );
  if (syncSummary.length === 0) {
    return pill;
  }
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top">
        <Text style={styles.tooltipText} testID="composer-diff-stat-sync-summary">
          {syncSummary.join("\n")}
        </Text>
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
  const diffStat = useVisibleWorkspaceDiffStat(serverId, workspaceId);
  const syncSummary = useWorkspaceGitSyncSummary(serverId, workspaceId);
  if (!diffStat) {
    return null;
  }
  return (
    <ComposerDiffStatPill
      additions={diffStat.additions}
      deletions={diffStat.deletions}
      syncSummary={syncSummary}
      onPress={onPress}
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));

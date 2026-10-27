import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { composerPillStyles } from "@/composer/pill-styles";
import { useVisibleWorkspaceDiffStat, useWorkspaceGitSync } from "@/composer/workspace-diff-stat";
import { GitSyncCountsText, GitSyncSummaryText } from "@/git/sync-indicator";
import type { GitSyncModel } from "@/git/sync-summary";

interface ComposerDiffStatPillProps {
  additions: number;
  deletions: number;
  sync?: GitSyncModel | null;
  onPress: () => void;
}

export function ComposerDiffStatPill({
  additions,
  deletions,
  sync = null,
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
      accessibilityLabel={[t("workspace.git.diff.openChangesTab"), ...(sync?.summary ?? [])].join(
        ", ",
      )}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={bodyStyle}
    >
      <DiffStat additions={additions} deletions={deletions} />
      {sync?.counts ? <GitSyncCountsText counts={sync.counts} /> : null}
    </Pressable>
  );
  if (!sync) {
    return pill;
  }
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top">
        <GitSyncSummaryText summary={sync.summary} testID="composer-diff-stat-sync-summary" />
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
  const sync = useWorkspaceGitSync(serverId, workspaceId);
  if (!diffStat) {
    return null;
  }
  return (
    <ComposerDiffStatPill
      additions={diffStat.additions}
      deletions={diffStat.deletions}
      sync={sync}
      onPress={onPress}
    />
  );
});

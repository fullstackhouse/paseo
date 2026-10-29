import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { composerPillStyles } from "@/composer/pill-styles";
import {
  useVisibleWorkspaceDiffStat,
  useWorkspaceGitSync,
  type WorkspaceGitSync,
} from "@/composer/workspace-diff-stat";
import { GitSyncCardContent, GitSyncCountsText } from "@/git/sync-indicator";
import { buildGitSyncAccessibilityLabel, getGitSyncCounts } from "@/git/sync-summary";

interface ComposerDiffStatPillProps {
  additions: number;
  deletions: number;
  serverId: string;
  sync?: WorkspaceGitSync | null;
  onPress: () => void;
}

export function ComposerDiffStatPill({
  additions,
  deletions,
  serverId,
  sync = null,
  onPress,
}: ComposerDiffStatPillProps) {
  const counts = sync ? getGitSyncCounts(sync.facts) : null;
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
      accessibilityLabel={[
        t("workspace.git.diff.openChangesTab"),
        sync ? buildGitSyncAccessibilityLabel(sync.facts, t) : null,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={bodyStyle}
    >
      <DiffStat additions={additions} deletions={deletions} />
      {counts ? <GitSyncCountsText counts={counts} /> : null}
    </Pressable>
  );
  if (!sync) {
    return pill;
  }
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <GitSyncCardContent serverId={serverId} cwd={sync.cwd} facts={sync.facts} side="top" />
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
      serverId={serverId}
      sync={sync}
      onPress={onPress}
    />
  );
});

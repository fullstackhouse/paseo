import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GitSyncCard } from "@/git/sync-card";
import {
  buildGitSyncAccessibilityLabel,
  type GitSyncCounts,
  type GitSyncFacts,
} from "@/git/sync-summary";

export function formatGitSyncCounts(counts: GitSyncCounts): string {
  return [
    counts.ahead > 0 ? `↑${counts.ahead}` : null,
    counts.behind > 0 ? `↓${counts.behind}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
}

export function GitSyncCountsText({ counts }: { counts: GitSyncCounts }) {
  return (
    <Text style={styles.counts} numberOfLines={1}>
      {formatGitSyncCounts(counts)}
    </Text>
  );
}

interface GitSyncCardContentProps {
  serverId: string;
  cwd: string;
  facts: GitSyncFacts;
  side: "top" | "bottom";
}

export function GitSyncCardContent({ serverId, cwd, facts, side }: GitSyncCardContentProps) {
  return (
    <TooltipContent side={side} style={styles.cardContent} maxWidth={320}>
      <GitSyncCard serverId={serverId} cwd={cwd} facts={facts} />
    </TooltipContent>
  );
}

interface GitSyncIndicatorProps {
  serverId: string;
  cwd: string;
  facts: GitSyncFacts;
  counts: GitSyncCounts;
  testID?: string;
}

// Opens on tap on mobile: hover doesn't exist there and the arrows alone don't explain themselves.
export function GitSyncIndicator({ serverId, cwd, facts, counts, testID }: GitSyncIndicatorProps) {
  const { t } = useTranslation();
  return (
    <Tooltip delayDuration={300} enabledOnMobile>
      <TooltipTrigger testID={testID} accessibilityLabel={buildGitSyncAccessibilityLabel(facts, t)}>
        <GitSyncCountsText counts={counts} />
      </TooltipTrigger>
      <GitSyncCardContent serverId={serverId} cwd={cwd} facts={facts} side="bottom" />
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  counts: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  cardContent: {
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
}));

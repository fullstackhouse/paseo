import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GitSyncCounts } from "@/git/sync-summary";

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

export function GitSyncSummaryText({ summary, testID }: { summary: string[]; testID?: string }) {
  return (
    <Text style={styles.tooltipText} testID={testID}>
      {summary.join("\n")}
    </Text>
  );
}

interface GitSyncIndicatorProps {
  counts: GitSyncCounts;
  summary: string[];
  testID?: string;
}

// Opens on tap on mobile: hover doesn't exist there and the arrows alone don't explain themselves.
export function GitSyncIndicator({ counts, summary, testID }: GitSyncIndicatorProps) {
  return (
    <Tooltip delayDuration={300} enabledOnMobile>
      <TooltipTrigger testID={testID} accessibilityLabel={summary.join(", ")}>
        <GitSyncCountsText counts={counts} />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <GitSyncSummaryText summary={summary} />
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  counts: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));

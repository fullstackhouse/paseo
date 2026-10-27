import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GitSyncCounts } from "@/git/sync-summary";

interface GitSyncIndicatorProps {
  counts: GitSyncCounts;
  summary: string[];
  testID?: string;
}

export function GitSyncIndicator({ counts, summary, testID }: GitSyncIndicatorProps) {
  const parts = [
    counts.ahead > 0 ? `↑${counts.ahead}` : null,
    counts.behind > 0 ? `↓${counts.behind}` : null,
  ].filter((part): part is string => part !== null);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        testID={testID}
        accessibilityRole="text"
        accessibilityLabel={summary.join(", ")}
      >
        <Text style={styles.counts} numberOfLines={1}>
          {parts.join(" ")}
        </Text>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{summary.join("\n")}</Text>
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

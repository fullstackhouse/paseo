import { useCallback, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useResolveScheduleRun } from "@/hooks/use-schedule-mutations";
import type { ScheduleAttentionItem } from "@/schedules/schedule-attention";
import { settingsStyles } from "@/styles/settings";
import { navigateToAgent } from "@/utils/navigate-to-agent";

/**
 * Scheduled runs waiting on you. Open goes to the run's agent, which a run that needs you keeps
 * instead of archiving; Dismiss takes the run off this list. Archiving the run's workspace
 * dismisses it too.
 */
export function SchedulesNeedsYou({
  items,
  showHost,
}: {
  items: ScheduleAttentionItem[];
  showHost: boolean;
}): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <View style={styles.section} testID="schedules-needs-you">
      <View style={settingsStyles.sectionHeader}>
        <Text style={settingsStyles.sectionHeaderTitle}>Needs you</Text>
      </View>
      <SettingsCard>
        {items.map((item) => (
          <NeedsYouRow key={item.key} item={item} showHost={showHost} />
        ))}
      </SettingsCard>
    </View>
  );
}

function NeedsYouRow({
  item,
  showHost,
}: {
  item: ScheduleAttentionItem;
  showHost: boolean;
}): ReactElement {
  const { resolveRun, isResolving } = useResolveScheduleRun();
  const open = useCallback(() => {
    if (!item.agentId) return;
    navigateToAgent({
      serverId: item.serverId,
      agentId: item.agentId,
      workspaceId: item.workspaceId,
      pin: true,
    });
  }, [item]);
  const dismiss = useCallback(() => {
    void resolveRun({
      serverId: item.serverId,
      scheduleId: item.scheduleId,
      runId: item.runId,
    }).catch((error) => console.warn("[Schedules] Failed to dismiss run", error));
  }, [item, resolveRun]);
  const meta = showHost ? `${item.startedLabel} · ${item.serverName}` : item.startedLabel;

  return (
    <View style={[settingsStyles.row, styles.row]} testID={`schedules-needs-you-${item.runId}`}>
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <Text style={[settingsStyles.rowTitle, styles.title]} numberOfLines={1}>
            {item.scheduleTitle}
          </Text>
          <StatusBadge label={item.reasonLabel} variant="warning" size="xs" />
        </View>
        {item.message ? (
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {item.message}
          </Text>
        ) : null}
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View style={styles.actions}>
        {item.agentId ? (
          <Button
            variant="outline"
            size="sm"
            onPress={open}
            testID={`schedules-needs-you-open-${item.runId}`}
          >
            Open
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onPress={dismiss}
          disabled={isResolving}
          testID={`schedules-needs-you-dismiss-${item.runId}`}
        >
          Dismiss
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  row: {
    gap: theme.spacing[3],
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

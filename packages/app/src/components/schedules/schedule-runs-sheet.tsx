import { ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { SettingsCard } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFetchQuery } from "@/data/query";
import { describeScheduleRuns, type ScheduleRunView } from "@/schedules/schedule-runs";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const ThemedChevron = withUnistyles(ChevronRight);
const hoveredIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

type HoverState = PressableStateCallbackType & { hovered?: boolean };

export interface ScheduleRunsTarget {
  serverId: string;
  scheduleId: string;
  title: string;
}

interface ScheduleRunsSheetProps {
  target: ScheduleRunsTarget | null;
  onClose: () => void;
}

async function fetchScheduleRuns(
  target: ScheduleRunsTarget,
  unavailableMessage: string,
): Promise<ScheduleRun[]> {
  const client = useSessionStore.getState().sessions[target.serverId]?.client ?? null;
  if (!client) {
    throw new Error(unavailableMessage);
  }
  const payload = await client.scheduleLogs({ id: target.scheduleId });
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.runs;
}

/**
 * A schedule's run history, newest first. Tapping a run opens its page in the sheet: the agent's
 * final report, which reads without opening the run's workspace — finished runs archive it.
 */
export function ScheduleRunsSheet({ target, onClose }: ScheduleRunsSheetProps): ReactElement {
  const { t } = useTranslation();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const query = useFetchQuery({
    queryKey: ["schedule-runs", target?.serverId, target?.scheduleId],
    queryFn: () =>
      target
        ? fetchScheduleRuns(target, t("common.errors.daemonClientUnavailable"))
        : Promise.resolve([]),
    enabled: target !== null,
    dataShape: "list",
    staleTimeMs: 5_000,
  });
  const runs = useMemo(
    () => (query.data ? describeScheduleRuns(query.data, new Date()) : null),
    [query.data],
  );
  const selectedRun = runs?.find((run) => run.id === selectedRunId) ?? null;

  // Each open starts on the list.
  useEffect(() => {
    setSelectedRunId(null);
  }, [target]);

  const showList = useCallback(() => setSelectedRunId(null), []);
  const showRun = useCallback((run: ScheduleRunView) => setSelectedRunId(run.id), []);

  const openAgent = useCallback(() => {
    if (!target || !selectedRun?.agentId) {
      return;
    }
    onClose();
    navigateToAgent({
      serverId: target.serverId,
      agentId: selectedRun.agentId,
      workspaceId: selectedRun.workspaceId,
      pin: true,
    });
  }, [onClose, selectedRun, target]);

  const header = useMemo<SheetHeader>(() => {
    const subtitle = target ? (
      <Text style={styles.subtitle} numberOfLines={1}>
        {target.title}
      </Text>
    ) : null;
    if (selectedRun) {
      return { title: selectedRun.startedLabel, subtitle, back: { onPress: showList } };
    }
    return { title: "Runs", subtitle };
  }, [selectedRun, showList, target]);

  const footer = useMemo(
    () =>
      selectedRun?.agentId ? (
        <View style={styles.footer}>
          <Button variant="outline" onPress={openAgent} testID="schedule-run-open-agent">
            Open agent
          </Button>
        </View>
      ) : undefined,
    [openAgent, selectedRun?.agentId],
  );

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  let body: ReactElement | null = null;
  if (target) {
    if (selectedRun) {
      body = <ScheduleRunPage run={selectedRun} />;
    } else if (query.isError) {
      body = (
        <View style={styles.centered}>
          <Text style={styles.message}>Unable to load runs</Text>
          <Button variant="ghost" onPress={retry} testID="schedule-runs-retry">
            Try again
          </Button>
        </View>
      );
    } else if (!runs) {
      body = (
        <View style={styles.centered}>
          <LoadingSpinner size="large" color={styles.spinner.color} />
        </View>
      );
    } else if (runs.length === 0) {
      body = (
        <View style={styles.centered} testID="schedule-runs-empty">
          <Text style={styles.message}>No runs yet</Text>
        </View>
      );
    } else {
      body = (
        <SettingsCard testID="schedule-runs-list">
          {runs.map((run) => (
            <ScheduleRunRow key={run.id} run={run} onOpen={showRun} />
          ))}
        </SettingsCard>
      );
    }
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={target !== null}
      onClose={onClose}
      footer={footer}
      testID="schedule-runs-sheet"
    >
      {body}
    </AdaptiveModalSheet>
  );
}

function ScheduleRunRow({
  run,
  onOpen,
}: {
  run: ScheduleRunView;
  onOpen: (run: ScheduleRunView) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(run), [onOpen, run]);
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={`${run.badge.label} run, ${run.startedLabel}`}
      onPress={handlePress}
      style={rowStyle}
      highlightStyle={styles.pressed}
      testID={`schedule-run-${run.id}`}
    >
      {({ hovered }: HoverState) => (
        <>
          <View style={styles.text}>
            <Text style={settingsStyles.rowTitle} numberOfLines={1}>
              {run.startedLabel}
            </Text>
            <Text style={settingsStyles.rowHint} numberOfLines={1}>
              {run.durationLabel}
            </Text>
            {run.error ? (
              <Text style={settingsStyles.rowError} numberOfLines={1}>
                {run.error}
              </Text>
            ) : null}
          </View>
          <StatusBadge label={run.badge.label} variant={run.badge.variant} />
          <ThemedChevron
            size={ICON_SIZE.sm}
            uniProps={hovered ? hoveredIconColorMapping : mutedIconColorMapping}
          />
        </>
      )}
    </PressHighlight>
  );
}

function rowStyle({ hovered, pressed }: HoverState) {
  return [settingsStyles.row, styles.row, hovered && styles.hovered, pressed && styles.pressed];
}

function emptyReportMessage(run: ScheduleRunView): string {
  if (run.status === "running") {
    return "The run is still going. Its report appears when it finishes.";
  }
  return "This run left no report.";
}

/** One run: status, duration, the error if it failed, and the agent's final report. */
function ScheduleRunPage({ run }: { run: ScheduleRunView }): ReactElement {
  return (
    <View style={styles.page} testID={`schedule-run-page-${run.id}`}>
      <View style={styles.pageMeta}>
        <StatusBadge label={run.badge.label} variant={run.badge.variant} />
        <Text style={styles.pageMetaText}>{run.durationLabel}</Text>
      </View>
      {run.error ? (
        <Text style={styles.pageError} selectable>
          {run.error}
        </Text>
      ) : null}
      {run.output ? (
        <MarkdownRenderer text={run.output} compact />
      ) : (
        <Text style={styles.pageMetaText}>{emptyReportMessage(run)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    gap: theme.spacing[3],
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  hovered: {
    backgroundColor: theme.colors.surface2,
  },
  pressed: {
    backgroundColor: theme.colors.surface3,
  },
  page: {
    gap: theme.spacing[4],
  },
  pageMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  pageMetaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  pageError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[8],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  // Static color holder read by the spinner; keeps the muted token without useUnistyles.
  spinner: {
    color: theme.colors.foregroundMuted,
  },
}));

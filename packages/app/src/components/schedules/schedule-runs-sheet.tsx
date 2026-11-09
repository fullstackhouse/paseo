import { ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
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

/** A schedule's run history, newest first. Tapping a run opens the agent it started. */
export function ScheduleRunsSheet({ target, onClose }: ScheduleRunsSheetProps): ReactElement {
  const header = useMemo<SheetHeader>(
    () => ({
      title: "Runs",
      subtitle: target ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {target.title}
        </Text>
      ) : null,
    }),
    [target],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible={target !== null}
      onClose={onClose}
      testID="schedule-runs-sheet"
    >
      {target ? <ScheduleRunsBody target={target} onClose={onClose} /> : null}
    </AdaptiveModalSheet>
  );
}

function ScheduleRunsBody({
  target,
  onClose,
}: {
  target: ScheduleRunsTarget;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const query = useFetchQuery({
    queryKey: ["schedule-runs", target.serverId, target.scheduleId],
    queryFn: () => fetchScheduleRuns(target, t("common.errors.daemonClientUnavailable")),
    dataShape: "list",
    staleTimeMs: 5_000,
  });
  const runs = useMemo(
    () => (query.data ? describeScheduleRuns(query.data, new Date()) : null),
    [query.data],
  );

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const openRun = useCallback(
    (run: ScheduleRunView) => {
      if (!run.agentId) {
        return;
      }
      onClose();
      navigateToAgent({
        serverId: target.serverId,
        agentId: run.agentId,
        workspaceId: run.workspaceId,
        pin: true,
      });
    },
    [onClose, target.serverId],
  );

  if (query.isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Unable to load runs</Text>
        <Button variant="ghost" onPress={retry} testID="schedule-runs-retry">
          Try again
        </Button>
      </View>
    );
  }

  if (!runs) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  }

  if (runs.length === 0) {
    return (
      <View style={styles.centered} testID="schedule-runs-empty">
        <Text style={styles.message}>No runs yet</Text>
      </View>
    );
  }

  return (
    <SettingsCard testID="schedule-runs-list">
      {runs.map((run) => (
        <ScheduleRunRow key={run.id} run={run} onOpen={openRun} />
      ))}
    </SettingsCard>
  );
}

function ScheduleRunRow({
  run,
  onOpen,
}: {
  run: ScheduleRunView;
  onOpen: (run: ScheduleRunView) => void;
}): ReactElement {
  const canOpen = run.agentId !== null;
  const handlePress = useCallback(() => onOpen(run), [onOpen, run]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: HoverState) => [
      settingsStyles.row,
      styles.row,
      canOpen && hovered && styles.hovered,
      canOpen && pressed && styles.pressed,
    ],
    [canOpen],
  );
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={`${run.badge.label} run, ${run.startedLabel}`}
      disabled={!canOpen}
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
              <Text style={settingsStyles.rowError} numberOfLines={3} selectable>
                {run.error}
              </Text>
            ) : null}
          </View>
          <StatusBadge label={run.badge.label} variant={run.badge.variant} />
          {canOpen ? (
            <ThemedChevron
              size={ICON_SIZE.sm}
              uniProps={hovered ? hoveredIconColorMapping : mutedIconColorMapping}
            />
          ) : null}
        </>
      )}
    </PressHighlight>
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

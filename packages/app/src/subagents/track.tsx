import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { useHosts } from "@/runtime/host-runtime";
import { Fragment, useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Archive, RotateCcw, Unlink } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LiveElapsed } from "@/components/message";
import { useProviderIcon } from "@/components/provider-icons";
import { ComposerTrackGroupHeader, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { Button } from "@/components/ui/button";
import { MenuSeparator } from "@/components/ui/menu";
import { useResumeAgents, type AgentRef } from "@/utils/resume-agents";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { useAgentFactsLine } from "@/panels/agent-facts-line";
import { getPanelManifest } from "@/panels/panel-manifest";
import { useSheetPanePage } from "@/screens/workspace/sheet-pane";
import { useSubagentsTrackOpen } from "./track-open-request";
import type { SheetTab } from "@/stores/workspace-layout-store";
import { formatDuration } from "@/utils/time";
import type { SubagentRow } from "./select";
import type { ArchiveFinishedStatus, ArchiveScope } from "./use-archive-finished";
import {
  buildSubagentPillPresentation,
  buildSubagentRowPresentationData,
  buildSubagentRunTime,
  distinctSubagentSubtitles,
  groupSubagentRows,
  type SubagentGroup,
  type SubagentGroupKey,
} from "./track-presentation";

const ThemedArchive = withUnistyles(Archive);
const ThemedUnlink = withUnistyles(Unlink);
const ThemedRotateCcw = withUnistyles(RotateCcw);

export interface SubagentsTrackProps {
  serverId: string;
  rows: SubagentRow[];
  onOpenSubagent: (address: AgentAddress) => void;
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void;
  /**
   * The sheet a row opens, or null when it opens as a tab. A sheet replaces the list in place and
   * Back returns to it; a tab replaces the list's pane, so choosing it ends the list.
   */
  sheetTabFor: (row: SubagentRow) => SheetTab | null;
  onArchiveSubagent: (address: AgentAddress) => void;
  /** Clears one group's finished children: Done's, or Failed's. */
  onArchiveFinished?: (scope: ArchiveScope) => void;
  archiveFinishedStatus?: ArchiveFinishedStatus;
  onDetachSubagent?: (address: AgentAddress) => void;
  /** The agent whose subagents these are; its list opens on `requestSubagentsTrackOpen`. */
  ownerAgentId?: string;
}

const IDLE_ARCHIVE_FINISHED_STATUS: ArchiveFinishedStatus = { kind: "idle" };

function useRowPresentation(row: SubagentRow, serverId: string): WorkspaceTabPresentation {
  const icon = useProviderIcon(row.provider, serverId);
  const data = buildSubagentRowPresentationData(row);
  return {
    ...data,
    tooltip: data.label,
    modified: false,
    showCloseButton: getPanelManifest(data.kind).showCloseButton,
    icon,
  };
}

function rowKey(row: SubagentRow): string {
  return row.kind === "paseo" ? `${row.address.serverId}:${row.id}` : row.id;
}

/** The scope a bulk clear is working on. An unscoped status predates scopes and meant done. */
function archiveStatusScope(status: ArchiveFinishedStatus): ArchiveScope | null {
  return status.kind === "idle" ? null : (status.scope ?? "done");
}

/** Failed managed children: a retry resumes each one on the daemon that runs it. */
function failedSubagentRefs(rows: readonly SubagentRow[]): AgentRef[] {
  const refs: AgentRef[] = [];
  for (const row of rows) {
    if (row.kind === "paseo" && row.status === "error") {
      refs.push({ serverId: row.address.serverId, id: row.id });
    }
  }
  return refs;
}

export function SubagentsTrack({
  serverId,
  rows,
  onOpenSubagent,
  onOpenProviderSubagent,
  sheetTabFor,
  onArchiveSubagent,
  onArchiveFinished,
  archiveFinishedStatus = IDLE_ARCHIVE_FINISHED_STATUS,
  onDetachSubagent,
  ownerAgentId,
}: SubagentsTrackProps): ReactElement | null {
  const { t } = useTranslation();
  const { open, onOpenChange } = useSubagentsTrackOpen(
    ownerAgentId ? { serverId, agentId: ownerAgentId } : null,
  );
  const sheetPanePage = useSheetPanePage();
  // Null until the user folds or unfolds Done, so the default can follow what the list holds.
  const [doneExpanded, setDoneExpanded] = useState<boolean | null>(null);
  const toggleDone = useCallback((folded: boolean) => () => setDoneExpanded(folded), []);

  const archivingScope = archiveStatusScope(archiveFinishedStatus);
  if (rows.length === 0 && archivingScope === null) {
    return null;
  }

  const pill = buildSubagentPillPresentation(t, rows);
  const groups = groupSubagentRows(rows);
  // A clear in flight keeps its heading, and its progress, after its last row has gone.
  if (archivingScope && !groups.some((group) => group.key === archivingScope)) {
    groups.push({ key: archivingScope, rows: [] });
  }
  const subtitles = distinctSubagentSubtitles(rows);
  const sheets = new Map(rows.map((row) => [rowKey(row), sheetTabFor(row)]));
  const pages = [...sheets.values()].flatMap((sheet) => (sheet ? [sheetPanePage(sheet)] : []));
  // Done folds when anything else is in the list: it asks nothing of you, and twenty finished
  // rows would push the one failure off the panel. Alone, it is the list.
  const doneFolded = doneExpanded === null ? groups.length > 1 : !doneExpanded;
  // One heading over a list that is all one kind of thing repeats the pill.
  const showHeadings = groups.length > 1 || groups.some((group) => group.key !== "working");

  return (
    <ComposerTrackPill
      pages={pages}
      testID="subagents-track-header"
      segments={pill.segments}
      accessibilityLabel={pill.accessibilityLabel}
      panelTitle={t("subagents.title")}
      open={open}
      onOpenChange={onOpenChange}
    >
      {groups.map((group, index) => {
        const folded = group.key === "done" && doneFolded;
        return (
          <Fragment key={group.key}>
            {index > 0 ? <MenuSeparator /> : null}
            {showHeadings ? (
              <SubagentGroupHeader
                group={group}
                collapsed={group.key === "done" ? folded : undefined}
                onToggle={group.key === "done" ? toggleDone(folded) : undefined}
                archiveStatus={archivingScope === group.key ? archiveFinishedStatus : null}
                archiveDisabled={
                  archivingScope !== null && archiveFinishedStatus.kind === "archiving"
                }
                onArchiveFinished={onArchiveFinished}
              />
            ) : null}
            {folded
              ? null
              : group.rows.map((row) => (
                  <SubagentsTrackRow
                    key={rowKey(row)}
                    row={row}
                    serverId={serverId}
                    subtitle={subtitles.get(row.id) ?? ""}
                    onOpenSubagent={onOpenSubagent}
                    onOpenProviderSubagent={onOpenProviderSubagent}
                    sheetTabId={sheets.get(rowKey(row))?.tab.tabId ?? null}
                    onArchiveSubagent={onArchiveSubagent}
                    onDetachSubagent={onDetachSubagent}
                  />
                ))}
          </Fragment>
        );
      })}
    </ComposerTrackPill>
  );
}

function groupLabel(t: TFunction, key: SubagentGroupKey, count: number): string {
  switch (key) {
    case "failed":
      return t("subagents.groups.failed", { count });
    case "needs_input":
      return t("subagents.groups.needsInput", { count });
    case "working":
      return t("subagents.groups.working", { count });
    case "done":
      return t("subagents.groups.done", { count });
  }
}

/**
 * A group's heading and the actions that apply to its rows. Failed offers Retry all and Clear;
 * Done offers Clear. They are separate presses on purpose: clearing finished work must never sweep
 * away a failure nobody has looked at.
 */
function SubagentGroupHeader({
  group,
  collapsed,
  onToggle,
  archiveStatus,
  archiveDisabled,
  onArchiveFinished,
}: {
  group: SubagentGroup;
  collapsed: boolean | undefined;
  onToggle: (() => void) | undefined;
  /** This group's bulk clear, while one is running or after it partly failed. */
  archiveStatus: ArchiveFinishedStatus | null;
  archiveDisabled: boolean;
  onArchiveFinished?: (scope: ArchiveScope) => void;
}): ReactElement {
  const { t } = useTranslation();
  const scope: ArchiveScope | null =
    group.key === "failed" || group.key === "done" ? group.key : null;
  const canRetry = group.key === "failed" && group.rows.some((row) => row.kind === "paseo");
  const resumeAgents = useResumeAgents();
  const handleRetry = useCallback(
    () => resumeAgents(failedSubagentRefs(group.rows)),
    [group.rows, resumeAgents],
  );
  const handleClear = useCallback(() => {
    if (scope) onArchiveFinished?.(scope);
  }, [onArchiveFinished, scope]);

  return (
    <ComposerTrackGroupHeader
      label={groupLabel(t, group.key, group.rows.length)}
      collapsed={collapsed}
      onToggle={onToggle}
      testID={`subagents-track-group-${group.key}`}
    >
      {archiveStatus?.kind === "archiving" ? (
        <Text style={styles.rowTrailing} testID={`subagents-track-archive-progress-${group.key}`}>
          {archiveStatus.completedCount}/{archiveStatus.totalCount}
        </Text>
      ) : null}
      {canRetry ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={handleRetry}
          testID="subagents-track-retry-failed"
        >
          {t("failedAgents.retryAll")}
        </Button>
      ) : null}
      {scope && onArchiveFinished && group.rows.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={archiveDisabled}
          onPress={handleClear}
          accessibilityLabel={t(
            scope === "failed" ? "subagents.clearFailedAction" : "subagents.clearDoneAction",
          )}
          testID={`subagents-track-clear-${scope}`}
        >
          {archiveStatus?.kind === "failed"
            ? t("subagents.archiveFinishedRetry", {
                failed: archiveStatus.failedCount,
                total: archiveStatus.totalCount,
              })
            : t("subagents.clear")}
        </Button>
      ) : null}
    </ComposerTrackGroupHeader>
  );
}

interface SubagentsTrackRowProps {
  serverId: string;
  row: SubagentRow;
  /** The row's facts minus what every sibling shares. Provider rows only. */
  subtitle: string;
  onOpenSubagent: (address: AgentAddress) => void;
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void;
  /** The sheet page the row opens in place of the list, when it opens in a sheet. */
  sheetTabId: string | null;
  onArchiveSubagent: (address: AgentAddress) => void;
  onDetachSubagent?: (address: AgentAddress) => void;
}

function SubagentsTrackRow({
  serverId,
  row,
  subtitle,
  onOpenSubagent,
  onOpenProviderSubagent,
  sheetTabId,
  onArchiveSubagent,
  onDetachSubagent,
}: SubagentsTrackRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const rowServerId = row.kind === "paseo" ? row.address.serverId : serverId;
  const hostLabel = useHosts().find((host) => host.serverId === rowServerId)?.label ?? rowServerId;
  const presentation = useRowPresentation(row, rowServerId);
  const displayLabel =
    presentation.titleState === "loading" ? t("common.states.loading") : presentation.label;
  const handlePress = useCallback(() => {
    if (row.kind === "provider") {
      onOpenProviderSubagent(row.parentAgentId, row.id);
    } else {
      onOpenSubagent(row.address);
    }
  }, [onOpenProviderSubagent, onOpenSubagent, row]);
  const handleArchivePress = useCallback(() => {
    if (row.kind === "paseo") onArchiveSubagent(row.address);
  }, [onArchiveSubagent, row]);
  const handleDetachPress = useCallback(() => {
    if (row.kind === "paseo") onDetachSubagent?.(row.address);
  }, [onDetachSubagent, row]);
  const resumeAgents = useResumeAgents();
  const handleRetryPress = useCallback(
    () => resumeAgents(failedSubagentRefs([row])),
    [resumeAgents, row],
  );
  const canRetry = row.kind === "paseo" && row.status === "error";
  const actionsAlwaysVisible = isNative || isCompact;

  const renderRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <WorkspaceTabIcon presentation={presentation} backdrop={active ? "surface2" : "surface1"} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {displayLabel}
          </Text>
          {row.kind === "paseo" ? (
            <>
              <SubagentFacts rowId={row.id} text={rowServerId !== serverId ? hostLabel : ""} />
              <PaseoSubagentFacts serverId={rowServerId} agentId={row.id} work={row.work} />
            </>
          ) : (
            <SubagentFacts rowId={row.id} text={subtitle} work={row.work} />
          )}
        </View>
        {row.kind === "paseo" ? (
          <SubagentRowActions
            rowId={row.id}
            displayLabel={displayLabel}
            compact={isCompact}
            visible={actionsAlwaysVisible || active}
            onRetryPress={canRetry ? handleRetryPress : undefined}
            onDetachPress={onDetachSubagent ? handleDetachPress : undefined}
            onArchivePress={handleArchivePress}
          />
        ) : null}
      </>
    ),
    [
      actionsAlwaysVisible,
      canRetry,
      displayLabel,
      handleArchivePress,
      handleRetryPress,
      subtitle,
      handleDetachPress,
      isCompact,
      onDetachSubagent,
      presentation,
      row.kind,
      row.id,
      row.work,
      serverId,
      rowServerId,
      hostLabel,
    ],
  );

  return (
    <ComposerTrackRow
      accessibilityLabel={displayLabel}
      testID={`subagents-track-row-${row.id}`}
      opensPage={sheetTabId ?? undefined}
      onPress={handlePress}
    >
      {renderRow}
    </ComposerTrackRow>
  );
}

/** The same facts line the agent's sheet shows when it opens without its composer. */
function PaseoSubagentFacts({
  serverId,
  agentId,
  work,
}: {
  serverId: string;
  agentId: string;
  work: SubagentRow["work"];
}) {
  const text = useAgentFactsLine(serverId, agentId);
  return <SubagentFacts rowId={agentId} text={text} work={work} />;
}

function SubagentFacts({
  rowId,
  text,
  work = null,
}: {
  rowId: string;
  text: string | null;
  work?: SubagentRow["work"];
}) {
  const runTime = useMemo(() => buildSubagentRunTime(work), [work]);
  if (!text && !runTime) return null;
  return (
    <View style={styles.rowFactsLine}>
      {text ? (
        <Text
          style={styles.rowFacts}
          numberOfLines={1}
          testID={`subagents-track-row-facts-${rowId}`}
        >
          {text}
        </Text>
      ) : null}
      {runTime ? (
        <Text style={styles.rowRunTime}>
          {text ? " · " : null}
          {runTime.kind === "running" ? (
            <LiveElapsed
              startedAt={runTime.since}
              testID={`subagents-track-row-run-time-${rowId}`}
            />
          ) : (
            <Text testID={`subagents-track-row-run-time-${rowId}`}>
              {formatDuration(runTime.workedMs)}
            </Text>
          )}
        </Text>
      ) : null}
    </View>
  );
}

function SubagentRowActions({
  rowId,
  displayLabel,
  compact,
  visible,
  onRetryPress,
  onDetachPress,
  onArchivePress,
}: {
  rowId: string;
  displayLabel: string;
  compact: boolean;
  visible: boolean;
  onRetryPress?: () => void;
  onDetachPress?: () => void;
  onArchivePress: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const iconSize = paneContentToolbarIconSize(compact);
  return (
    <View
      style={visible ? styles.actionClusterVisible : styles.actionClusterHidden}
      pointerEvents={visible ? "auto" : "none"}
    >
      {onRetryPress ? (
        <SubagentActionButton
          label={t("subagents.retryAction", { label: displayLabel })}
          tooltipLabel={t("failedAgents.retry")}
          compact={compact}
          onPress={onRetryPress}
          testID={`subagents-track-retry-${rowId}`}
        >
          <ThemedRotateCcw size={iconSize} uniProps={mutedIconColorMapping} />
        </SubagentActionButton>
      ) : null}
      {onDetachPress ? (
        <SubagentActionButton
          label={t("subagents.detachAction", { label: displayLabel })}
          tooltipLabel={t("subagents.detachTooltip")}
          compact={compact}
          onPress={onDetachPress}
          testID={`subagents-track-detach-${rowId}`}
        >
          <ThemedUnlink size={iconSize} uniProps={mutedIconColorMapping} />
        </SubagentActionButton>
      ) : null}
      <SubagentActionButton
        label={t("subagents.archiveAction", { label: displayLabel })}
        tooltipLabel={t("subagents.archiveTooltip")}
        compact={compact}
        onPress={onArchivePress}
        testID={`subagents-track-archive-${rowId}`}
      >
        <ThemedArchive size={iconSize} uniProps={mutedIconColorMapping} />
      </SubagentActionButton>
    </View>
  );
}

/** The standard icon action, with a tooltip that names the action without repeating the row. */
function SubagentActionButton({
  label,
  tooltipLabel,
  compact,
  onPress,
  testID,
  children,
}: {
  label: string;
  tooltipLabel: string;
  compact: boolean;
  onPress: () => void;
  testID: string;
  children: ReactNode;
}): ReactElement {
  const tooltip = useMemo(
    () => <Text style={styles.tooltipText}>{tooltipLabel}</Text>,
    [tooltipLabel],
  );
  return (
    <ToolbarButton
      label={label}
      tooltip={tooltip}
      tooltipSide="top"
      compact={compact}
      onPress={onPress}
      testID={testID}
    >
      {children}
    </ToolbarButton>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Title over facts. The facts sit under the title rather than beside it, so a long task name
  // keeps the row's full width and neither line truncates the other. `flexBasis: "auto"` rather
  // than `flex: 1`: a zero-basis label adds nothing to the row's intrinsic width, so the panel
  // would measure itself at its floor and truncate every label at once.
  rowText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  rowFactsLine: {
    flexDirection: "row",
  },
  rowFacts: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  // The time keeps its width and the facts truncate, so a long model name never hides it.
  rowRunTime: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
    color: theme.colors.foregroundMuted,
  },
  // Clear's progress. It shrinks before the heading does, so the count gives way first.
  rowTrailing: {
    flexShrink: 2,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  actionClusterVisible: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    opacity: 1,
  },
  actionClusterHidden: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    opacity: 0,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));

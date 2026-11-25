import { useCallback, useMemo, type ReactElement } from "react";
import {
  FlatList,
  RefreshControl,
  Text,
  View,
  type ListRenderItem,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DATE_SECTION_ORDER,
  deriveDateSectionKey,
  formatDateSectionLabel,
  type DateSectionKey,
} from "@/components/agent-list";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { PressHighlight } from "@/components/ui/press-highlight";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { ArchivedWorkspace } from "@/hooks/use-archived-workspaces";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

// Matches agent History search (agent-list), so both History views find the same names.
const HISTORY_MATCH_OPTIONS = { typoTolerant: true } as const;
const ThemedRefreshControl = withUnistyles(RefreshControl, (theme) => ({
  tintColor: theme.colors.foregroundMuted,
  colors: [theme.colors.foregroundMuted],
}));

type ListItem =
  | { type: "header"; key: string; section: DateSectionKey }
  | { type: "workspace"; key: string; workspace: ArchivedWorkspace };

function workspaceKey(workspace: ArchivedWorkspace): string {
  return `${workspace.serverId}:${workspace.workspaceId}`;
}

function ArchivedTime({ archivedAt, style }: { archivedAt: string; style: StyleProp<TextStyle> }) {
  const date = useMemo(() => new Date(archivedAt), [archivedAt]);
  const label = useTimeAgo(date);
  return (
    <Text style={style} numberOfLines={1}>
      {label}
    </Text>
  );
}

function ArchivedWorkspaceRow({
  workspace,
  search,
  isMobile,
  showHostColumn,
}: {
  workspace: ArchivedWorkspace;
  search?: string;
  isMobile: boolean;
  showHostColumn: boolean;
}) {
  const branch = workspace.branch ?? "";
  const ranges = useMemo(
    () => ({
      name: findHighlightRanges(search ?? "", workspace.name, HISTORY_MATCH_OPTIONS),
      project: findHighlightRanges(
        search ?? "",
        workspace.projectDisplayName,
        HISTORY_MATCH_OPTIONS,
      ),
      branch: findHighlightRanges(search ?? "", branch, HISTORY_MATCH_OPTIONS),
    }),
    [search, workspace.name, workspace.projectDisplayName, branch],
  );
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );
  // Opening on a tab is the explicit intent that makes the route offer Unarchive or Restore;
  // once recovered, the workspace opens on its Overview.
  const handlePress = useCallback(() => {
    navigateToWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      target: { kind: "overview" },
    });
  }, [workspace.serverId, workspace.workspaceId]);
  const testID = `archived-workspace-row-${workspace.serverId}-${workspace.workspaceId}`;

  return (
    <PressHighlight
      style={pressableStyle}
      highlightStyle={styles.rowPressed}
      onPress={handlePress}
      accessibilityRole="button"
      testID={testID}
    >
      <View style={styles.rowContent}>
        <HighlightedText
          text={workspace.name}
          ranges={ranges.name}
          style={styles.title}
          numberOfLines={1}
        />
        {isMobile ? (
          <View style={styles.metaRow}>
            <HighlightedText
              text={workspace.projectDisplayName}
              ranges={ranges.project}
              style={styles.metaText}
              numberOfLines={1}
            />
            {branch ? (
              <>
                <Text style={styles.metaSeparator}>·</Text>
                <HighlightedText
                  text={branch}
                  ranges={ranges.branch}
                  style={styles.metaText}
                  numberOfLines={1}
                />
              </>
            ) : null}
            <Text style={styles.metaSeparator}>·</Text>
            <ArchivedTime archivedAt={workspace.archivedAt} style={styles.metaText} />
            {showHostColumn ? (
              <>
                <Text style={styles.metaSeparator}>·</Text>
                <Text style={styles.metaText} numberOfLines={1}>
                  {workspace.serverLabel}
                </Text>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
      {!isMobile ? (
        <View style={styles.columns}>
          <HighlightedText
            text={workspace.projectDisplayName}
            ranges={ranges.project}
            style={styles.column}
            numberOfLines={1}
          />
          {showHostColumn ? (
            <Text style={styles.columnHost} numberOfLines={1}>
              {workspace.serverLabel}
            </Text>
          ) : null}
          <HighlightedText
            text={branch}
            ranges={ranges.branch}
            style={styles.column}
            numberOfLines={1}
          />
          <ArchivedTime archivedAt={workspace.archivedAt} style={styles.columnTime} />
        </View>
      ) : null}
    </PressHighlight>
  );
}

export function ArchivedWorkspaceList({
  workspaces,
  search,
  showHostColumn,
  isRefreshing,
  onRefresh,
  footerHint,
}: {
  workspaces: ArchivedWorkspace[];
  search?: string;
  showHostColumn: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** Shown under the list, e.g. when hosts held back older matches. */
  footerHint?: string;
}): ReactElement {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();

  // Grouped by when each workspace was archived, in the same buckets as History's agents.
  const items = useMemo((): ListItem[] => {
    const buckets = new Map<DateSectionKey, ArchivedWorkspace[]>();
    for (const workspace of workspaces) {
      const section = deriveDateSectionKey(new Date(workspace.archivedAt));
      const bucket = buckets.get(section);
      if (bucket) bucket.push(workspace);
      else buckets.set(section, [workspace]);
    }
    const result: ListItem[] = [];
    for (const section of DATE_SECTION_ORDER) {
      const data = buckets.get(section);
      if (!data) continue;
      result.push({ type: "header", key: `header:${section}`, section });
      for (const workspace of data) {
        result.push({ type: "workspace", key: workspaceKey(workspace), workspace });
      }
    }
    return result;
  }, [workspaces]);

  const renderItem: ListRenderItem<ListItem> = useCallback(
    ({ item }) => {
      if (item.type === "header") {
        return (
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>{formatDateSectionLabel(t, item.section)}</Text>
          </View>
        );
      }
      return (
        <ArchivedWorkspaceRow
          workspace={item.workspace}
          search={search}
          isMobile={isMobile}
          showHostColumn={showHostColumn}
        />
      );
    },
    [isMobile, search, showHostColumn, t],
  );
  const keyExtractor = useCallback((item: ListItem) => item.key, []);
  const footer = useMemo(
    () =>
      footerHint ? (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{footerHint}</Text>
        </View>
      ) : null,
    [footerHint],
  );
  const refreshControl = useMemo(
    () => <ThemedRefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />,
    [isRefreshing, onRefresh],
  );

  return (
    <FlatList
      data={items}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      ListFooterComponent={footer}
      testID="archived-workspace-list"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[1],
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  sectionHeading: {
    marginTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: {
      xs: theme.borderRadius.lg,
      md: 0,
    },
    marginBottom: {
      xs: theme.spacing[1],
      md: 0,
    },
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  title: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    marginTop: 2,
  },
  metaText: {
    maxWidth: "100%",
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  metaSeparator: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    opacity: 0.7,
  },
  columns: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[3],
  },
  column: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
    width: 132,
  },
  columnHost: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
    width: 120,
    marginLeft: theme.spacing[4],
    textAlign: "right",
  },
  columnTime: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
    width: 72,
    textAlign: "right",
  },
}));

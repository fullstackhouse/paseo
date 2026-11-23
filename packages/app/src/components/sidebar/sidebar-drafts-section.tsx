import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { SquarePen, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { paneContentToolbarIconSize, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import {
  type ListedNewWorkspaceDraft,
  restoreNewWorkspaceDraftSetup,
  useListedNewWorkspaceDrafts,
  useNewWorkspaceDraftsStore,
} from "@/stores/new-workspace-drafts-store";
import { density } from "@/styles/density";
import type { Theme } from "@/styles/theme";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";

const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedX = withUnistyles(X);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Unsent New workspace drafts (forks included), at the top of the sidebar, newest first.
 * The draft open on screen joins the list only once you leave it; after that it stays put.
 */
export function SidebarDraftsSection({
  onDraftPress,
}: {
  /** Runs after a row opens its draft; the left sidebar closes itself on compact layouts. */
  onDraftPress?: () => void;
}) {
  const { t } = useTranslation();
  const listed = useListedNewWorkspaceDrafts();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ draftId?: string }>();
  const openDraftId = pathname === "/new" ? (params.draftId ?? "") : null;
  const revealedDraftKeys = useNewWorkspaceDraftsStore((state) => state.revealedDraftKeys);
  const isOpen = useCallback(
    (draft: ListedNewWorkspaceDraft) => openDraftId === (draft.draftId ?? ""),
    [openDraftId],
  );
  // A draft you are typing in joins the list once you leave it, then stays put when you
  // come back to it, so the list never shifts under the pointer.
  const drafts = useMemo(
    () =>
      listed
        .filter((draft) => !isOpen(draft) || revealedDraftKeys[draft.draftKey] !== undefined)
        .sort(
          (left, right) =>
            (revealedDraftKeys[right.draftKey] ?? Infinity) -
            (revealedDraftKeys[left.draftKey] ?? Infinity),
        ),
    [isOpen, listed, revealedDraftKeys],
  );
  useEffect(() => {
    useNewWorkspaceDraftsStore.getState().revealDrafts(drafts.map((draft) => draft.draftKey));
  }, [drafts]);

  if (drafts.length === 0) return null;

  return (
    <View style={styles.section} testID="sidebar-drafts-section">
      <SidebarSectionHeader title={t("sidebar.drafts.title")} />
      {drafts.map((draft) => (
        <DraftRow
          key={draft.draftKey}
          draft={draft}
          selected={isOpen(draft)}
          onPress={onDraftPress}
        />
      ))}
    </View>
  );
}

function DraftRow({
  draft,
  selected,
  onPress,
}: {
  draft: ListedNewWorkspaceDraft;
  selected: boolean;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const alwaysShowDiscard = isNative || isCompact;
  // Hover lives on a wrapper, not the row's pressable: on web, moving onto the X counts as
  // leaving the pressable, which hid the X under the pointer.
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const handlePress = useCallback(() => {
    restoreNewWorkspaceDraftSetup(draft);
    router.push(
      buildNewWorkspaceRoute({
        serverId: draft.serverId,
        sourceDirectory: draft.sourceDirectory,
        displayName: draft.projectName,
        projectId: draft.projectId,
        draftId: draft.draftId,
      }),
    );
    onPress?.();
  }, [draft, onPress]);

  const handleDiscard = useCallback(() => {
    useNewWorkspaceDraftsStore.getState().discardDraft(draft.draftKey);
  }, [draft.draftKey]);

  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      isHovered && styles.rowHovered,
      selected && styles.rowSelected,
      pressed && styles.rowPressed,
    ],
    [isHovered, selected],
  );

  return (
    <View
      style={styles.rowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <PressHighlight
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={handlePress}
        style={rowStyle}
        highlightStyle={styles.rowPressed}
        testID={`sidebar-draft-row-${draft.draftKey}`}
      >
        <View style={styles.text}>
          <View style={styles.projectLine}>
            <ThemedSquarePen size={12} uniProps={foregroundMutedColorMapping} />
            <Text style={styles.projectName} numberOfLines={1}>
              {draft.projectName ?? t("sidebar.drafts.noProject")}
            </Text>
          </View>
          <Text style={styles.preview} numberOfLines={1}>
            {draft.preview || t("sidebar.drafts.attachmentsOnly")}
          </Text>
        </View>
      </PressHighlight>
      {/* A sibling laid over the row, not a child: a button may not sit inside a button. */}
      {isHovered || alwaysShowDiscard ? (
        <View style={styles.discard}>
          <ToolbarButton
            label={t("sidebar.drafts.discard")}
            onPress={handleDiscard}
            testID={`sidebar-draft-discard-${draft.draftKey}`}
          >
            <ThemedX
              size={paneContentToolbarIconSize(false)}
              uniProps={foregroundMutedColorMapping}
            />
          </ToolbarButton>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[1],
  },
  rowContainer: {
    position: "relative",
  },
  row: {
    minHeight: density.rowHeight,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    // Room for the discard button laid over the right edge.
    paddingRight: theme.spacing[8],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  discard: {
    position: "absolute",
    top: 0,
    bottom: theme.spacing[0.5],
    right: theme.spacing[1],
    justifyContent: "center",
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  projectLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  projectName: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  preview: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));

import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { SquarePen, X } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
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
type HoverState = PressableStateCallbackType & { hovered?: boolean };

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Unsent New workspace drafts (forks included), at the top of the sidebar, newest first. */
export function SidebarDraftsSection() {
  const { t } = useTranslation();
  const drafts = useListedNewWorkspaceDrafts();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ draftId?: string }>();
  const openDraftId = pathname === "/new" ? (params.draftId ?? "") : null;

  if (drafts.length === 0) return null;

  return (
    <View style={styles.section} testID="sidebar-drafts-section">
      <SidebarSectionHeader title={t("sidebar.drafts.title")} />
      {drafts.map((draft) => (
        <DraftRow
          key={draft.draftKey}
          draft={draft}
          selected={openDraftId !== null && openDraftId === (draft.draftId ?? "")}
        />
      ))}
    </View>
  );
}

function DraftRow({ draft, selected }: { draft: ListedNewWorkspaceDraft; selected: boolean }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const alwaysShowDiscard = isNative || isCompact;

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
  }, [draft]);

  // The button sits inside the row's own pressable; without this the press also opens the draft.
  const stopPropagation = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);
  const handleDiscard = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      useNewWorkspaceDraftsStore.getState().discardDraft(draft.draftKey);
    },
    [draft.draftKey],
  );

  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: HoverState) => [
      styles.row,
      hovered && styles.rowHovered,
      selected && styles.rowSelected,
      pressed && styles.rowPressed,
    ],
    [selected],
  );

  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={rowStyle}
      highlightStyle={styles.rowPressed}
      testID={`sidebar-draft-row-${draft.draftKey}`}
    >
      {({ hovered }: HoverState) => (
        <>
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
          {hovered || alwaysShowDiscard ? (
            <ToolbarButton
              label={t("sidebar.drafts.discard")}
              onPressIn={stopPropagation}
              onPress={handleDiscard}
              testID={`sidebar-draft-discard-${draft.draftKey}`}
            >
              <ThemedX
                size={paneContentToolbarIconSize(false)}
                uniProps={foregroundMutedColorMapping}
              />
            </ToolbarButton>
          ) : null}
        </>
      )}
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[1],
  },
  row: {
    minHeight: density.rowHeight,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    userSelect: "none",
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

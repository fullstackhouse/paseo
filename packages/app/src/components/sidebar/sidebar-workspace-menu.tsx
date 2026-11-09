import {
  useCallback,
  useMemo,
  type ComponentProps,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Archive,
  Circle,
  CircleCheck,
  Copy,
  MoreVertical,
  AlarmClock,
  AlarmClockOff,
  Pencil,
  Pin,
  PinOff,
  Tag,
} from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import { densityIconProps } from "@/styles/density";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { OpenInFileManagerMenuItem } from "@/workspace/open-in-file-manager/menu-item";
import { resolveSidebarWorkspaceAccessibilityLabel } from "@/components/sidebar/sidebar-workspace-title";
import {
  workspaceServiceLabelKey,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import {
  useWorkspaceLabelMenuPages,
  WORKSPACE_LABEL_PAGE_ID,
  type WorkspaceLabelTarget,
} from "@/workspace-labels/picker";
import {
  useSetWorkspaceSnooze,
  useWorkspaceSnoozeMenuPages,
  WORKSPACE_SNOOZE_PAGE_ID,
  type SnoozeTarget,
} from "@/workspace/snooze/menu";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedCopy = withUnistyles(Copy);
const ThemedArchive = withUnistyles(Archive);
const ThemedCircle = withUnistyles(Circle);
const ThemedPencil = withUnistyles(Pencil);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const ThemedTag = withUnistyles(Tag);
const ThemedAlarmClock = withUnistyles(AlarmClock);
const ThemedAlarmClockOff = withUnistyles(AlarmClockOff);

const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const markAsReadLeadingIcon = (
  <ThemedCircleCheck size={14} uniProps={foregroundMutedColorMapping} />
);
const markAsUnreadLeadingIcon = <ThemedCircle size={14} uniProps={foregroundMutedColorMapping} />;
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;
const pinLeadingIcon = <ThemedPin size={14} uniProps={foregroundMutedColorMapping} />;
const unpinLeadingIcon = <ThemedPinOff size={14} uniProps={foregroundMutedColorMapping} />;
const snoozeLeadingIcon = <ThemedAlarmClock size={14} uniProps={foregroundMutedColorMapping} />;
const wakeLeadingIcon = <ThemedAlarmClockOff size={14} uniProps={foregroundMutedColorMapping} />;

const triggerIconProps = densityIconProps("sm", foregroundMutedColorMapping);
const triggerIconHoveredProps = densityIconProps("sm", foregroundColorMapping);

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return <ThemedMoreVertical uniProps={hovered ? triggerIconHoveredProps : triggerIconProps} />;
}

export interface SidebarWorkspaceMenuProps {
  workspaceKey: string;
  serverId?: string;
  workspaceId?: string;
  workspaceLabels?: readonly string[];
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onMarkAsUnread?: () => void;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  isPinned?: boolean;
  onTogglePin?: () => void;
  openInFileManagerPath?: string | null;
  /**
   * Lifted so the row that reveals the kebab can keep it mounted while its menu is up. See
   * `useOpenKebabMenuVisibility`.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface SidebarWorkspaceMenuItemsProps extends Omit<
  SidebarWorkspaceMenuProps,
  "onArchive" | "open" | "onOpenChange"
> {
  onArchive?: () => void;
}

type MenuSurface = "context" | "dropdown";

// Read here rather than threaded through every row: the menu already knows which workspace it is.
function useWorkspaceSnoozeTarget(
  serverId: string | undefined,
  workspaceId: string | undefined,
): { target: SnoozeTarget | null; isSnoozed: boolean } {
  const supported = useHostFeature(serverId, "workspaceSnooze");
  const isSnoozed = useSessionStore((state) =>
    serverId && workspaceId
      ? state.sessions[serverId]?.workspaces?.get(workspaceId)?.snoozedAt != null
      : false,
  );
  const target = useMemo(
    () => (supported && serverId && workspaceId ? { serverId, workspaceId } : null),
    [supported, serverId, workspaceId],
  );
  return { target, isSnoozed };
}

function useWorkspaceMenuPages(
  serverId: string | undefined,
  workspaceId: string | undefined,
  labelTarget: WorkspaceLabelTarget | null,
) {
  const labelPages = useWorkspaceLabelMenuPages(labelTarget);
  const { target } = useWorkspaceSnoozeTarget(serverId, workspaceId);
  const snoozePages = useWorkspaceSnoozeMenuPages(target);
  return useMemo(() => [...labelPages, ...snoozePages], [labelPages, snoozePages]);
}

function WorkspaceMenuItem({
  surface,
  children,
  ...props
}: PropsWithChildren<
  Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & { surface: MenuSurface }
>) {
  if (surface === "context") {
    return <ContextMenuItem {...props}>{children}</ContextMenuItem>;
  }
  return <DropdownMenuItem {...props}>{children}</DropdownMenuItem>;
}

function SidebarWorkspaceMenuItems({
  surface,
  workspaceKey,
  serverId,
  workspaceId,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
}: SidebarWorkspaceMenuItemsProps & { surface: MenuSurface }): ReactNode {
  const { t } = useTranslation();
  const archiveTrailing = useMemo(
    () => (archiveShortcutKeys ? <Shortcut chord={archiveShortcutKeys} /> : null),
    [archiveShortcutKeys],
  );
  const labelLeading = useMemo(
    () => <ThemedTag size={14} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const { target: snoozeTarget, isSnoozed } = useWorkspaceSnoozeTarget(serverId, workspaceId);
  const setSnooze = useSetWorkspaceSnooze();
  const handleWake = useCallback(() => {
    if (snoozeTarget) setSnooze({ target: snoozeTarget, snoozed: false, until: null });
  }, [setSnooze, snoozeTarget]);

  return (
    <>
      {onCopyPath ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-copy-path-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyPath}
        >
          {t("sidebar.workspace.actions.copyPath")}
        </WorkspaceMenuItem>
      ) : null}
      {onCopyBranchName ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-copy-branch-name-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyBranchName}
        >
          {t("sidebar.workspace.actions.copyBranchName")}
        </WorkspaceMenuItem>
      ) : null}
      {onRename ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-rename-${workspaceKey}`}
          leading={renameLeadingIcon}
          onSelect={onRename}
        >
          {t("sidebar.workspace.actions.rename")}
        </WorkspaceMenuItem>
      ) : null}
      {onMarkAsRead ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-mark-as-read-${workspaceKey}`}
          leading={markAsReadLeadingIcon}
          onSelect={onMarkAsRead}
        >
          Mark as read
        </WorkspaceMenuItem>
      ) : null}
      {onMarkAsUnread ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-mark-as-unread-${workspaceKey}`}
          leading={markAsUnreadLeadingIcon}
          onSelect={onMarkAsUnread}
        >
          Mark as unread
        </WorkspaceMenuItem>
      ) : null}
      {/* A snoozed workspace cannot sit in Pinned; wake it first. */}
      {onTogglePin && !isSnoozed ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-pin-${workspaceKey}`}
          leading={isPinned ? unpinLeadingIcon : pinLeadingIcon}
          onSelect={onTogglePin}
        >
          {isPinned ? t("sidebar.workspace.actions.unpin") : t("sidebar.workspace.actions.pin")}
        </WorkspaceMenuItem>
      ) : null}
      {snoozeTarget && isSnoozed ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-wake-${workspaceKey}`}
          leading={wakeLeadingIcon}
          onSelect={handleWake}
        >
          {t("sidebar.workspace.snooze.wake")}
        </WorkspaceMenuItem>
      ) : null}
      {snoozeTarget && !isSnoozed ? (
        <DropdownMenuSubTrigger
          id={WORKSPACE_SNOOZE_PAGE_ID}
          leading={snoozeLeadingIcon}
          testID={`sidebar-workspace-menu-snooze-${workspaceKey}`}
        >
          {t("sidebar.workspace.snooze.title")}
        </DropdownMenuSubTrigger>
      ) : null}
      {serverId && workspaceId ? (
        <DropdownMenuSubTrigger
          id={WORKSPACE_LABEL_PAGE_ID}
          leading={labelLeading}
          testID={`sidebar-workspace-menu-labels-${workspaceKey}`}
        >
          {t("workspaceLabels.title")}
        </DropdownMenuSubTrigger>
      ) : null}
      <OpenInFileManagerMenuItem
        surface={surface}
        path={openInFileManagerPath}
        testID={`sidebar-workspace-menu-open-folder-${workspaceKey}`}
      />
      {onArchive ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-archive-${workspaceKey}`}
          leading={archiveLeadingIcon}
          trailing={archiveTrailing}
          status={archiveStatus}
          pendingLabel={archivePendingLabel}
          onSelect={onArchive}
        >
          {archiveLabel ?? t("sidebar.workspace.actions.archive")}
        </WorkspaceMenuItem>
      ) : null}
    </>
  );
}

export function SidebarWorkspaceMenu({
  workspaceKey,
  serverId,
  workspaceId,
  workspaceLabels,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  open,
  onOpenChange,
}: SidebarWorkspaceMenuProps) {
  const { t } = useTranslation();
  const workspaceTarget = useMemo<WorkspaceLabelTarget | null>(
    () =>
      serverId && workspaceId ? { serverId, workspaceId, labels: workspaceLabels ?? [] } : null,
    [serverId, workspaceId, workspaceLabels],
  );
  const pages = useWorkspaceMenuPages(serverId, workspaceId, workspaceTarget);
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.workspace.actions.menu")}
        testID={`sidebar-workspace-kebab-${workspaceKey}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={260}
        pages={pages}
        sheetTitle={t("sidebar.workspace.actions.menu")}
      >
        <SidebarWorkspaceMenuItems
          surface="dropdown"
          workspaceKey={workspaceKey}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceLabels={workspaceLabels}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onMarkAsRead={onMarkAsRead}
          onMarkAsUnread={onMarkAsUnread}
          onArchive={onArchive}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          openInFileManagerPath={openInFileManagerPath}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ContextTriggerProps = Omit<
  ComponentProps<typeof ContextMenuTrigger>,
  "children" | "enabledOnMobile" | "highlightStyle"
>;

export function SidebarWorkspaceContextMenu({
  children,
  contextMenuOpen,
  onContextMenuOpenChange,
  workspace,
  leadingProjectName,
  hostBadgeLabel,
  serviceSummary,
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  accessibilityLabel,
  highlightStyle,
  ...triggerProps
}: PropsWithChildren<
  SidebarWorkspaceMenuItemsProps &
    ContextTriggerProps & {
      contextMenuOpen: boolean;
      onContextMenuOpenChange: (open: boolean) => void;
      workspace: SidebarWorkspaceEntry;
      leadingProjectName?: string | null;
      hostBadgeLabel?: string | null;
      serviceSummary?: WorkspaceServiceSummary | null;
      highlightStyle: ComponentProps<typeof ContextMenuTrigger>["highlightStyle"];
    }
>) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const { t } = useTranslation();
  const pullRequestLabel = workspace.prHint
    ? t("workspace.git.pr.accessibility.pullRequest", {
        number: workspace.prHint.number,
        context: getForgePresentation(normalizeForge(workspace.prHint.forge)).changeRequestContext,
      })
    : null;
  const rowAccessibilityLabel = resolveSidebarWorkspaceAccessibilityLabel({
    workspace,
    workspaceTitleSource,
    leadingProjectName,
    hostBadgeLabel,
    pullRequestLabel,
    serviceLabel: serviceSummary
      ? t(workspaceServiceLabelKey(serviceSummary), { name: serviceSummary.name })
      : null,
    t,
  });
  const workspaceTarget = useMemo<WorkspaceLabelTarget>(
    () => ({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      labels: workspace.labels ?? [],
    }),
    [workspace],
  );
  const pages = useWorkspaceMenuPages(
    workspaceTarget.serverId,
    workspaceTarget.workspaceId,
    workspaceTarget,
  );

  return (
    <ContextMenu open={contextMenuOpen} onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger
        {...triggerProps}
        enabledOnMobile={false}
        accessibilityLabel={accessibilityLabel ?? rowAccessibilityLabel}
        highlightStyle={highlightStyle}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={260}
        testID={`sidebar-workspace-context-menu-${workspaceKey}`}
        pages={pages}
      >
        <SidebarWorkspaceMenuItems
          surface="context"
          workspaceKey={workspaceKey}
          serverId={workspaceTarget.serverId}
          workspaceId={workspaceTarget.workspaceId}
          workspaceLabels={workspaceTarget.labels}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onMarkAsRead={onMarkAsRead}
          onMarkAsUnread={onMarkAsUnread}
          onArchive={onArchive}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          openInFileManagerPath={openInFileManagerPath}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    // Larger on compact so the kebab is an easy tap target.
    width: { xs: 32, md: 18 },
    height: { xs: 32, md: 18 },
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    marginLeft: 2,
    // Center the compact box on the 20px title line it is anchored to.
    marginTop: { xs: -6, md: 0 },
    // MoreVertical paints only around the center of its SVG. Keep the padded hit box, but
    // pull the painted dots through that unused view-box space onto the trailing-content rail.
    marginRight: { xs: -14, md: -7 },
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));

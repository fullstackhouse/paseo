import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import type { WorkspaceManualGroupName } from "@getpaseo/protocol/messages";
import { MenuItem, type MenuPageDefinition } from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { markWorkspaceUnread } from "@/workspace/mark-unread";
import { useWorkspaceStatus } from "@/workspace-status";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { resolveMoveTarget, type MoveTarget } from "./target";

/** The `MenuSubTrigger` on a workspace's menu that opens the Move to choices. */
export const WORKSPACE_MOVE_PAGE_ID = "workspaceMove";

const GROUPS: readonly { group: WorkspaceManualGroupName; labelKey: string }[] = [
  { group: "attention", labelKey: "sidebar.statusBucket.readyToReview" },
  { group: "done", labelKey: "sidebar.statusBucket.done" },
  { group: "blocked", labelKey: "sidebar.statusBucket.blocked" },
];

export function useWorkspaceMoveTarget(
  serverId: string | undefined,
  workspaceId: string | undefined,
  supported: boolean,
): MoveTarget | null {
  const current = useWorkspaceStatus(serverId ?? "", workspaceId ?? "");
  const turnStatus = useWorkspaceFields(
    serverId ?? "",
    workspaceId ?? "",
    (workspace) => workspace.status,
  );
  const runningFromBackgroundWork = useWorkspaceFields(
    serverId ?? "",
    workspaceId ?? "",
    (workspace) => workspace.runningFromBackgroundWork,
  );
  return useMemo(
    () =>
      resolveMoveTarget({
        serverId,
        workspaceId,
        supported,
        turn: turnStatus
          ? { status: turnStatus, runningFromBackgroundWork: runningFromBackgroundWork === true }
          : null,
        current,
      }),
    [current, runningFromBackgroundWork, serverId, supported, turnStatus, workspaceId],
  );
}

/** The Move to page behind a workspace's menu, shared by the kebab and the context menu. */
export function useWorkspaceMoveMenuPages(
  target: MoveTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  const toast = useToast();
  // The move also sets the read state underneath, so agent tabs and notifications agree with the
  // group: Done reads it, Ready to review marks it unread. These replace Mark as read / unread.
  // Read from the raw turn status: a plugin report may decide the group, but the move overrides it.
  const rawStatus = useWorkspaceFields(
    target?.serverId ?? "",
    target?.workspaceId ?? "",
    (workspace) => workspace.status,
  );
  const supportsMarkUnread = useHostFeature(target?.serverId ?? "", "workspaceMarkUnread");
  const { mutate } = useMutation({
    mutationFn: async ({ group }: { group: WorkspaceManualGroupName }) => {
      if (!target) return;
      const client = getHostRuntimeStore().getClient(target.serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      await client.setWorkspaceGroup(target.workspaceId, group);
      // The move already landed; a read-state hiccup must not report it as failed.
      try {
        if (group === "done" && (rawStatus === "attention" || rawStatus === "failed")) {
          await client.clearWorkspaceAttention(target.workspaceId);
        }
        if (group === "attention" && rawStatus === "done" && supportsMarkUnread) {
          await markWorkspaceUnread(target.serverId, target.workspaceId);
        }
      } catch (error) {
        console.warn("[workspace-move] read state not updated", error);
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
  });
  const move = useCallback((group: WorkspaceManualGroupName) => mutate({ group }), [mutate]);
  return useMemo(() => {
    if (!target) return [];
    return [
      {
        id: WORKSPACE_MOVE_PAGE_ID,
        title: t("sidebar.workspace.move.title"),
        content: <WorkspaceMovePage current={target.current} onMove={move} />,
      },
    ];
  }, [move, t, target]);
}

function WorkspaceMovePage({
  current,
  onMove,
}: {
  current: SidebarStateBucket;
  onMove: (group: WorkspaceManualGroupName) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {GROUPS.map(({ group, labelKey }) => (
        <MoveRow
          key={group}
          group={group}
          label={t(labelKey)}
          selected={current === group}
          onMove={onMove}
        />
      ))}
    </>
  );
}

function MoveRow({
  group,
  label,
  selected,
  onMove,
}: {
  group: WorkspaceManualGroupName;
  label: string;
  selected: boolean;
  onMove: (group: WorkspaceManualGroupName) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onMove(group), [group, onMove]);
  return (
    <MenuItem
      selected={selected}
      showSelectedCheck
      disabled={selected}
      onSelect={handleSelect}
      testID={`workspace-move-${group}`}
    >
      {label}
    </MenuItem>
  );
}

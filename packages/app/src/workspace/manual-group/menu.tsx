import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import type { WorkspaceManualGroupName } from "@getpaseo/protocol/messages";
import { MenuItem, type MenuPageDefinition } from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { useWorkspaceReadState } from "@/hooks/use-workspace-read-state";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspaceStatus } from "@/workspace-status";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

/** The `MenuSubTrigger` on a workspace's menu that opens the Move to choices. */
export const WORKSPACE_MOVE_PAGE_ID = "workspaceMove";

const GROUPS: readonly { group: WorkspaceManualGroupName; labelKey: string }[] = [
  { group: "attention", labelKey: "sidebar.statusBucket.readyToReview" },
  { group: "done", labelKey: "sidebar.statusBucket.done" },
  { group: "blocked", labelKey: "sidebar.statusBucket.blocked" },
];

/** Live state decides the group by itself; a move can't change where it shows. */
const LIVE_STATUSES = new Set<SidebarStateBucket>(["running", "failed", "needs_input"]);

export interface MoveTarget {
  serverId: string;
  workspaceId: string;
  /** Where the workspace shows now, so the page can mark it. */
  current: SidebarStateBucket;
}

/**
 * The workspace to offer Move to for, or null: the host can't store a move, or the workspace is
 * in live state, where a move would change nothing.
 */
export function useWorkspaceMoveTarget(
  serverId: string | undefined,
  workspaceId: string | undefined,
  supported: boolean,
): MoveTarget | null {
  const current = useWorkspaceStatus(serverId ?? "", workspaceId ?? "");
  return useMemo(() => {
    if (!supported || !serverId || !workspaceId || !current || LIVE_STATUSES.has(current)) {
      return null;
    }
    return { serverId, workspaceId, current };
  }, [current, serverId, supported, workspaceId]);
}

/** The Move to page behind a workspace's menu, shared by the kebab and the context menu. */
export function useWorkspaceMoveMenuPages(
  target: MoveTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  const toast = useToast();
  // The move also sets the read state underneath, so agent tabs and notifications agree with the
  // group: Done reads it, Ready to review marks it unread. These replace Mark as read / unread.
  const { hasClearableAttention, canMarkUnread, clearAttention, markUnread } =
    useWorkspaceReadState({
      serverId: target?.serverId ?? "",
      workspaceId: target?.workspaceId ?? "",
    });
  const { mutate } = useMutation({
    mutationFn: async ({ group }: { group: WorkspaceManualGroupName }) => {
      if (!target) return;
      const client = getHostRuntimeStore().getClient(target.serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      await client.setWorkspaceGroup(target.workspaceId, group);
      if (group === "done" && hasClearableAttention) await clearAttention();
      if (group === "attention" && canMarkUnread) await markUnread();
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

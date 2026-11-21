import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { isOpenToRegrouping } from "@/workspace-status/reported-work";
import type { WorkspaceDescriptor } from "@/stores/session-store";

export interface MoveTarget {
  serverId: string;
  workspaceId: string;
  /** Where the workspace shows now, so the page can mark it. */
  current: SidebarStateBucket;
}

/**
 * The workspace to offer Move to for, or null: the host can't store a move, or the turn is live
 * (running, failed, waiting on a permission), where a move would change nothing. Decided on the
 * turn, not on where the workspace shows: an idle workspace held in Working by a plugin report or
 * by background work (a dev server) can be moved, and is where a move is most wanted.
 */
export function resolveMoveTarget(input: {
  serverId: string | undefined;
  workspaceId: string | undefined;
  supported: boolean;
  /** The workspace's own turn status, before plugin reports or a move. */
  turn: Pick<WorkspaceDescriptor, "status" | "runningFromBackgroundWork"> | null;
  current: SidebarStateBucket | null;
}): MoveTarget | null {
  const { serverId, workspaceId, supported, turn, current } = input;
  if (!supported || !serverId || !workspaceId || !turn || !current) return null;
  if (!isOpenToRegrouping(turn)) return null;
  return { serverId, workspaceId, current };
}

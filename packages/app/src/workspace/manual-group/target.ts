import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

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
export function resolveMoveTarget(input: {
  serverId: string | undefined;
  workspaceId: string | undefined;
  supported: boolean;
  current: SidebarStateBucket | null;
}): MoveTarget | null {
  const { serverId, workspaceId, supported, current } = input;
  if (!supported || !serverId || !workspaceId || !current || LIVE_STATUSES.has(current)) {
    return null;
  }
  return { serverId, workspaceId, current };
}

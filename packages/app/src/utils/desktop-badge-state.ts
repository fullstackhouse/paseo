import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { WorkspaceAgentActivity } from "@/utils/workspace-agent-activity";
import { deriveEffectiveWorkspaceStatus } from "@/workspace-status";
import type { ReportedWorkLookup } from "@/workspace-status/reported-work";
import { memoizeOnSessionMaps } from "./memoize-on-session-maps";

/** A workspace's status as the sidebar derives it (`deriveEffectiveWorkspaceStatus`): Blocked and Done never count. */
export type DesktopBadgeWorkspaceStatus = SidebarStateBucket;

interface WorkspaceStatusSession {
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  workspaceAgentActivity?: ReadonlyMap<string, WorkspaceAgentActivity>;
}

interface WorkspaceStatusSource {
  sessions: Record<string, WorkspaceStatusSession | undefined>;
}

export function isWorkspaceActionableForDesktopBadge(status: DesktopBadgeWorkspaceStatus): boolean {
  return status === "attention" || status === "needs_input" || status === "failed";
}

/**
 * The macOS dock badge only needs a count, so count here instead of materialising every
 * workspace status and comparing the whole list on every store write.
 */
export interface DockBadgeOptions {
  /** Count background workspaces too, as the sidebar shows them while Show background is on. */
  showBackground?: boolean;
  /** FSH: plugin reports regroup idle workspaces, as in the sidebar, so Blocked and Done stop counting. */
  reportedWork?: ReportedWorkLookup;
}

export function selectMacDockBadgeCount(
  state: WorkspaceStatusSource,
  options: DockBadgeOptions = {},
): number | undefined {
  let actionableCount = 0;
  for (const [serverId, session] of Object.entries(state.sessions)) {
    if (!session) continue;
    for (const workspace of session.workspaces.values()) {
      // A hidden background workspace would leave the badge pointing at nothing in the sidebar.
      if (workspace.background && !options.showBackground) continue;
      // The status as the sidebar derives it: a root agent mid-turn wins over a report.
      const { status } = deriveEffectiveWorkspaceStatus({
        serverId,
        workspace,
        workspaceAgentActivity: session.workspaceAgentActivity,
        reportedWork: options.reportedWork,
      });
      if (isWorkspaceActionableForDesktopBadge(status)) actionableCount += 1;
    }
  }
  return actionableCount > 0 ? actionableCount : undefined;
}

/** A session-store selector for the dock badge count that recounts only when a workspace map changes. */
export function createMacDockBadgeCountSelector(
  options: DockBadgeOptions = {},
): (state: WorkspaceStatusSource) => number | undefined {
  return memoizeOnSessionMaps<WorkspaceStatusSession, WorkspaceStatusSource, number | undefined>(
    (session) => [session.workspaces, session.workspaceAgentActivity],
    (state) => selectMacDockBadgeCount(state, options),
  );
}

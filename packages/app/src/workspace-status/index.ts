import { useShallow } from "zustand/shallow";
import { useCreateFlowStore, type PendingCreateAttempt } from "@/stores/create-flow-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceAgentActivity } from "@/utils/workspace-agent-activity";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import {
  applyManualGroup,
  applyReportedWork,
  useReportedWorkLookup,
  type InProgressTally,
  type ReportedWork,
  type ReportedWorkLookup,
} from "./reported-work";

/** What a workspace's in-progress entries say on its row. */
export interface WorkspaceInProgress {
  /** Entries nothing has moved for a while. */
  notMoving: number;
  /**
   * The group in-progress work put the workspace in, when it is the reason (without it the
   * workspace would sit elsewhere): working on machines, or blocked on a review.
   */
  reason: "working" | "blocked" | null;
  /** The entries behind `reason`: moving ones for working, awaiting review for blocked. */
  reasonCount: number;
}

interface EffectiveWorkspaceStatus {
  status: SidebarStateBucket;
  /** Running only because an idle agent's background shells or monitors are live. */
  runningFromBackgroundWork?: boolean;
  enteredAt: Date | null;
  /** Present while a plugin lists in-progress entries for the workspace. */
  inProgress?: WorkspaceInProgress;
}

export function deriveEffectiveWorkspaceStatus(input: {
  serverId: string;
  workspace: WorkspaceDescriptor;
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
  workspaceAgentActivity?: ReadonlyMap<string, WorkspaceAgentActivity>;
  /** Experimental: plugin-reported work regroups idle workspaces. */
  reportedWork?: ReportedWorkLookup;
}): EffectiveWorkspaceStatus {
  const { serverId, workspace, reportedWork } = input;
  const turn = deriveTurnWorkspaceStatus(input);
  const reportedAt = reportedWork?.updatedAt?.(serverId, workspace.id);
  const group = (reported: ReportedWork | null | undefined) =>
    applyManualGroup(turn, applyReportedWork(turn, reported), workspace.manualGroup, reportedAt);
  const status = group(reportedWork?.(serverId, workspace.id, turn));
  const tally = reportedWork?.inProgress?.(serverId, workspace.id, turn);
  if (!tally) return status;
  const statusWithout = () => group(reportedWork?.items?.(serverId, workspace.id)).status;
  return { ...status, inProgress: describeInProgress(tally, status.status, statusWithout) };
}

/** The row's view of in-progress work; `reason` only where it decided the group. */
function describeInProgress(
  tally: InProgressTally,
  status: SidebarStateBucket,
  statusWithout: () => SidebarStateBucket,
): WorkspaceInProgress {
  const asked = tally.work === "working" || tally.work === "blocked" ? tally.work : null;
  const decided =
    asked !== null &&
    status === (asked === "working" ? "running" : "blocked") &&
    statusWithout() !== status;
  const reason = decided ? asked : null;
  return {
    notMoving: tally.stuck,
    reason,
    reasonCount: reason === "blocked" ? tally.awaitingReview : tally.moving,
  };
}

function deriveTurnWorkspaceStatus(input: {
  serverId: string;
  workspace: WorkspaceDescriptor;
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
  workspaceAgentActivity?: ReadonlyMap<string, WorkspaceAgentActivity>;
}): EffectiveWorkspaceStatus {
  if (input.workspace.status !== "done") {
    return {
      status: input.workspace.status,
      runningFromBackgroundWork: input.workspace.runningFromBackgroundWork,
      enteredAt: input.workspace.statusEnteredAt,
    };
  }

  const pendingStartedAt = getPendingInitialAgentCreateStartedAt({
    serverId: input.serverId,
    workspaceId: input.workspace.id,
    pendingCreateAttempts: input.pendingCreateAttempts,
  });
  if (pendingStartedAt) {
    return { status: "running", enteredAt: pendingStartedAt };
  }

  const rootAgentActivity = input.workspaceAgentActivity?.get(input.workspace.id);
  if (rootAgentActivity && rootAgentActivity.status !== "done") {
    return rootAgentActivity;
  }

  return { status: input.workspace.status, enteredAt: input.workspace.statusEnteredAt };
}

function getPendingInitialAgentCreateStartedAt(input: {
  serverId: string;
  workspaceId: string;
  pendingCreateAttempts: Record<string, PendingCreateAttempt> | undefined;
}): Date | null {
  let latestStartedAt: Date | null = null;
  for (const pending of Object.values(input.pendingCreateAttempts ?? {})) {
    if (pending.serverId !== input.serverId) continue;
    if (pending.workspaceId !== input.workspaceId) continue;
    if (pending.lifecycle === "abandoned") continue;
    const startedAt = new Date(pending.timestamp);
    if (!latestStartedAt || startedAt > latestStartedAt) {
      latestStartedAt = startedAt;
    }
  }
  return latestStartedAt;
}

export function useWorkspaceStatus(serverId: string, workspaceId: string) {
  const pendingCreateAttempts = useCreateFlowStore((state) => state.pendingByDraftId);
  const reportedWork = useReportedWorkLookup();
  return useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      if (!session) return null;
      const key = resolveWorkspaceMapKeyByIdentity({ workspaces: session.workspaces, workspaceId });
      const workspace = key ? session.workspaces.get(key) : null;
      if (!workspace) return null;
      return deriveEffectiveWorkspaceStatus({
        serverId,
        workspace,
        pendingCreateAttempts,
        workspaceAgentActivity: session.workspaceAgentActivity,
        reportedWork,
      }).status;
    }),
  );
}

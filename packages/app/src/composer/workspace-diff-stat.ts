import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";

type DiffStat = NonNullable<WorkspaceDescriptor["diffStat"]>;

export interface WorkspaceChangesSummary {
  diffStat: DiffStat | null;
  /** Commits not pushed to / not pulled from the branch's upstream; 0 when there is none. */
  ahead: number;
  behind: number;
  currentBranch: string | null;
  baseRef: string | null;
}

export function useVisibleWorkspaceChanges(
  serverId: string,
  workspaceId: string,
): WorkspaceChangesSummary | null {
  const summary = useWorkspaceFields(serverId, workspaceId, summarizeWorkspaceChanges);
  return summary && hasVisibleChanges(summary) ? summary : null;
}

export function useWorkspaceHasChangesPill(serverId: string, workspaceId: string): boolean {
  return (
    useWorkspaceFields(serverId, workspaceId, (workspace) =>
      hasVisibleChanges(summarizeWorkspaceChanges(workspace)),
    ) ?? false
  );
}

function summarizeWorkspaceChanges(workspace: WorkspaceDescriptor): WorkspaceChangesSummary {
  const diffStat = workspace.diffStat;
  return {
    diffStat: diffStat && (diffStat.additions > 0 || diffStat.deletions > 0) ? diffStat : null,
    ahead: workspace.gitRuntime?.aheadOfOrigin ?? 0,
    behind: workspace.gitRuntime?.behindOfOrigin ?? 0,
    currentBranch: workspace.gitRuntime?.currentBranch ?? null,
    baseRef: workspace.gitRuntime?.baseRef ?? null,
  };
}

function hasVisibleChanges(summary: WorkspaceChangesSummary): boolean {
  return summary.diffStat !== null || summary.ahead > 0 || summary.behind > 0;
}

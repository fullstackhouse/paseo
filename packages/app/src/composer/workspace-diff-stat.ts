import { useMemo } from "react";
import { hasGitSyncDetails, type GitSyncFacts } from "@/git/sync-summary";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";

type DiffStat = NonNullable<WorkspaceDescriptor["diffStat"]>;

export function useVisibleWorkspaceDiffStat(
  serverId: string,
  workspaceId: string,
): DiffStat | null {
  const diffStat = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.diffStat);
  return hasDiffStatChanges(diffStat) ? diffStat : null;
}

export interface WorkspaceGitSync {
  cwd: string;
  facts: GitSyncFacts;
}

// The diff total mixes uncommitted work with unpushed commits; the sync card says which is which.
export function useWorkspaceGitSync(
  serverId: string,
  workspaceId: string,
): WorkspaceGitSync | null {
  const gitRuntime = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.gitRuntime);
  const cwd = useWorkspaceFields(
    serverId,
    workspaceId,
    (workspace) => workspace.workspaceDirectory,
  );
  return useMemo(
    () => (gitRuntime && cwd && hasGitSyncDetails(gitRuntime) ? { cwd, facts: gitRuntime } : null),
    [gitRuntime, cwd],
  );
}

export function useWorkspaceHasDiffStat(serverId: string, workspaceId: string): boolean {
  return (
    useWorkspaceFields(serverId, workspaceId, (workspace) =>
      hasDiffStatChanges(workspace.diffStat),
    ) ?? false
  );
}

function hasDiffStatChanges(diffStat: WorkspaceDescriptor["diffStat"]): diffStat is DiffStat {
  return Boolean(diffStat && (diffStat.additions > 0 || diffStat.deletions > 0));
}

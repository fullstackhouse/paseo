import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildGitSyncSummary } from "@/git/sync-summary";
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

// The diff total mixes uncommitted work with unpushed commits; this says which is which.
export function useWorkspaceGitSyncSummary(serverId: string, workspaceId: string): string[] {
  const { t } = useTranslation();
  const gitRuntime = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.gitRuntime);
  return useMemo(() => (gitRuntime ? buildGitSyncSummary(gitRuntime, t) : []), [gitRuntime, t]);
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

import { queryClient } from "@/data/query-client";

export const ARCHIVED_WORKSPACES_QUERY_ROOT = ["archivedWorkspaces"] as const;

/** Archiving, restoring or unarchiving changes the list; refetch it instead of waiting out the stale time. */
export function invalidateArchivedWorkspaces(): void {
  void queryClient.invalidateQueries({ queryKey: ARCHIVED_WORKSPACES_QUERY_ROOT });
}

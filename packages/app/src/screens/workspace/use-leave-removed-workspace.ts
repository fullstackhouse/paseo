import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  resolveRemovedWorkspaceRedirect,
  type WorkspaceRouteState,
} from "@/screens/workspace/workspace-route-state";

/**
 * The app's own archive buttons leave the workspace before archiving it. Archives from elsewhere
 * (a plugin's Post & archive, the CLI, an agent's `archive_workspace`) only remove it from the
 * host's list, which would leave this screen on "Workspace unavailable". This leaves for New
 * workspace instead, once the workspace this screen showed from the live list is gone.
 */
export function useLeaveRemovedWorkspace(input: {
  serverId: string;
  workspaceId: string;
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
  state: WorkspaceRouteState;
  isRouteFocused: boolean;
}): void {
  const { serverId, workspaceId, workspace, hasHydratedWorkspaces, state, isRouteFocused } = input;
  const router = useRouter();
  const lastLive = useRef<{ key: string; workspace: WorkspaceDescriptor } | null>(null);
  const key = `${serverId}\u0000${workspaceId}`;

  useEffect(() => {
    // Before the first live list the descriptor may be a cached copy of an archived workspace.
    if (workspace && hasHydratedWorkspaces) {
      lastLive.current = { key, workspace };
      return;
    }
    if (!isRouteFocused) return;
    const redirect = resolveRemovedWorkspaceRedirect({
      serverId,
      state,
      lastLiveWorkspace: lastLive.current?.key === key ? lastLive.current.workspace : null,
    });
    if (!redirect) return;
    lastLive.current = null;
    router.replace(redirect);
  }, [hasHydratedWorkspaces, isRouteFocused, key, router, serverId, state, workspace]);
}

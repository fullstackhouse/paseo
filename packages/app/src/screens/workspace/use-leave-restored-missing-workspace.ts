import { useEffect, useState } from "react";
import { useRouter, type Href } from "expo-router";
import {
  forgetRestoredWorkspaceSelection,
  useRestoredWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import {
  shouldLeaveRestoredMissingWorkspace,
  type WorkspaceRouteState,
} from "@/screens/workspace/workspace-route-state";

/**
 * Sends the user to the open-project screen when the workspace reopened at startup no longer
 * exists, and forgets it so the next launch does not reopen it. Returns the route state to
 * render: a loading state while leaving, so the "unavailable" screen never flashes.
 */
export function useLeaveRestoredMissingWorkspace(input: {
  serverId: string;
  workspaceId: string;
  state: WorkspaceRouteState;
  isRouteFocused: boolean;
  hasPendingOpenTarget: boolean;
}): WorkspaceRouteState {
  const router = useRouter();
  const restored = useRestoredWorkspaceSelection();
  // Forgetting the selection clears `restored`; keep rendering the loading state until the
  // replace lands instead of falling back to the "unavailable" screen for a frame.
  const [isLeaving, setIsLeaving] = useState(false);
  const shouldLeave = shouldLeaveRestoredMissingWorkspace({
    state: input.state,
    isRouteFocused: input.isRouteFocused,
    isRestoredSelection:
      restored?.serverId === input.serverId && restored.workspaceId === input.workspaceId,
    hasPendingOpenTarget: input.hasPendingOpenTarget,
  });
  const { serverId, workspaceId } = input;

  useEffect(() => {
    if (!shouldLeave) {
      return;
    }
    setIsLeaving(true);
    forgetRestoredWorkspaceSelection({ serverId, workspaceId });
    router.replace(buildOpenProjectRoute() as Href);
  }, [router, serverId, shouldLeave, workspaceId]);

  if ((shouldLeave || isLeaving) && input.state.kind === "missing") {
    return { kind: "loading", hostName: input.state.hostName };
  }
  return input.state;
}

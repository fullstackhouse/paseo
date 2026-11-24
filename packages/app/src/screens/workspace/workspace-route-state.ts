import type { Href } from "expo-router";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { buildWorkspaceArchiveRedirectRoute } from "@/utils/workspace-archive-navigation";
import type { WorkspaceRecoveryModel } from "@/workspace-recovery/model";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type WorkspaceRouteState =
  | { kind: "ready" }
  | {
      kind: "reconnecting";
      hostName: string;
      connectionStatus: Exclude<HostRuntimeConnectionStatus, "online">;
      lastError: string | null;
    }
  | {
      kind: "unreachable";
      hostName: string;
      connectionStatus: Exclude<HostRuntimeConnectionStatus, "online">;
      lastError: string | null;
    }
  | { kind: "loading"; hostName: string }
  | { kind: "missing"; hostName: string }
  | { kind: "needsHostUpgrade"; hostName: string }
  | {
      kind: "archived";
      hostName: string;
      recovery: Extract<WorkspaceRecoveryModel, { kind: "recoverable" }>;
    }
  | {
      kind: "recoveryUnavailable";
      hostName: string;
      message: string;
      recreate: Extract<WorkspaceRecoveryModel, { kind: "unavailable" }>["recreate"];
    }
  | { kind: "recoveryInspectionFailed"; hostName: string; error: string };

export function resolveWorkspaceRouteState(input: {
  hostName: string;
  connectionStatus: HostRuntimeConnectionStatus;
  lastError: string | null;
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
  recovery: WorkspaceRecoveryModel;
}): WorkspaceRouteState {
  if (input.workspace) {
    if (input.connectionStatus === "online") {
      if (input.recovery.kind === "recoverable" && input.recovery.phase === "restoring") {
        return { kind: "archived", hostName: input.hostName, recovery: input.recovery };
      }
      return { kind: "ready" };
    }

    return {
      kind: "reconnecting",
      hostName: input.hostName,
      connectionStatus: input.connectionStatus,
      lastError: input.lastError,
    };
  }

  if (input.connectionStatus !== "online") {
    return {
      kind: "unreachable",
      hostName: input.hostName,
      connectionStatus: input.connectionStatus,
      lastError: input.lastError,
    };
  }

  if (!input.hasHydratedWorkspaces) {
    return { kind: "loading", hostName: input.hostName };
  }
  if (input.recovery.kind === "idle") {
    return { kind: "missing", hostName: input.hostName };
  }

  switch (input.recovery.kind) {
    case "checking":
      return { kind: "loading", hostName: input.hostName };
    case "needsHostUpgrade":
      return { kind: "needsHostUpgrade", hostName: input.hostName };
    case "recoverable":
      return { kind: "archived", hostName: input.hostName, recovery: input.recovery };
    case "unavailable":
      return {
        kind: "recoveryUnavailable",
        hostName: input.hostName,
        message: input.recovery.recovery.message,
        recreate: input.recovery.recreate,
      };
    case "unsupportedAction":
      return {
        kind: "recoveryUnavailable",
        hostName: input.hostName,
        message: "Update Paseo to recover this workspace.",
        recreate: null,
      };
    case "inspectionFailed":
      return {
        kind: "recoveryInspectionFailed",
        hostName: input.hostName,
        error: input.recovery.error,
      };
  }
}

/**
 * The agent an archived workspace shows read-only under its recovery banner: the agent the
 * workspace was opened on (from History), while recovery is offered or unavailable.
 */
export function resolveArchivedPreviewAgentId(
  state: WorkspaceRouteState,
  pendingOpenTarget: WorkspaceTabTarget | null,
): string | null {
  if (pendingOpenTarget?.kind !== "agent") return null;
  if (state.kind !== "archived" && state.kind !== "recoveryUnavailable") return null;
  return pendingOpenTarget.agentId;
}

/**
 * Only an explicit open (a History agent row, an archived workspace row, or a paseo:// link) asks
 * the host about recovery; any other route to a missing workspace stays "missing".
 */
export function shouldInspectWorkspaceRecovery(
  hasHydratedWorkspaces: boolean,
  workspace: WorkspaceDescriptor | null,
  pendingOpenTarget: WorkspaceTabTarget | null,
  requestedFromLink = false,
): boolean {
  const explicit =
    pendingOpenTarget?.kind === "agent" ||
    pendingOpenTarget?.kind === "overview" ||
    requestedFromLink;
  return explicit && hasHydratedWorkspaces && workspace === null;
}

/**
 * Where to go when the workspace this screen showed is archived by something other than the app's
 * own archive buttons (a plugin, the CLI, an agent): the same New workspace route those buttons
 * open. `lastLiveWorkspace` is the descriptor last seen in the host's live list. A route that never
 * had one (a deep link, a reloaded URL, a cached workspace that turned out archived) keeps its
 * "Workspace unavailable" screen.
 */
export function resolveRemovedWorkspaceRedirect(input: {
  serverId: string;
  state: WorkspaceRouteState;
  lastLiveWorkspace: WorkspaceDescriptor | null;
}): Href | null {
  if (input.state.kind !== "missing" || !input.lastLiveWorkspace) return null;
  return buildWorkspaceArchiveRedirectRoute({
    serverId: input.serverId,
    archivedWorkspaceId: input.lastLiveWorkspace.id,
    workspaces: [input.lastLiveWorkspace],
  });
}

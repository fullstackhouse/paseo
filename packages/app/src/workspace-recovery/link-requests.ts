import { useSyncExternalStore } from "react";

// Opening a workspace from a `paseo://` link is an explicit request to see it, like opening
// an archived agent from History: a missing workspace then shows its recovery state
// ("Workspace archived · Unarchive") instead of "Workspace unavailable".
const requested = new Set<string>();
const listeners = new Set<() => void>();

function key(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

export function requestWorkspaceRecoveryFromLink(input: {
  serverId: string;
  workspaceId: string;
}): void {
  const requestKey = key(input.serverId, input.workspaceId);
  if (requested.has(requestKey)) return;
  requested.add(requestKey);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceRecoveryRequestedFromLink(
  serverId: string,
  workspaceId: string,
): boolean {
  const requestKey = key(serverId, workspaceId);
  const read = () => requested.has(requestKey);
  return useSyncExternalStore(subscribe, read, read);
}

import { useEffect, useSyncExternalStore } from "react";

// FSH: the background plugin updater waits while a Plugins screen is open. Those screens list
// each update with its own Update button, so applying it behind the user's back would race their
// click against a proposal the background run already consumed.
const openScreensByServer = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marks a host's plugin updates as the user's to apply while the calling screen is mounted. */
export function useManualPluginUpdateScreen(serverId: string): void {
  useEffect(() => {
    openScreensByServer.set(serverId, (openScreensByServer.get(serverId) ?? 0) + 1);
    notify();
    return () => {
      const remaining = (openScreensByServer.get(serverId) ?? 1) - 1;
      if (remaining > 0) openScreensByServer.set(serverId, remaining);
      else openScreensByServer.delete(serverId);
      notify();
    };
  }, [serverId]);
}

/** True while a Plugins screen for this host is open. */
export function useIsManualPluginUpdateScreenOpen(serverId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => openScreensByServer.has(serverId),
    () => false,
  );
}

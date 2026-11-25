import { useCallback, useEffect, useState } from "react";

/**
 * Asks an agent's subagents pill to open its list, from somewhere that only navigates to the agent
 * (the Overview's In progress section). The request waits until that agent's pill mounts or sees it,
 * and the first pill to see it consumes it.
 */
const pending = new Set<string>();
const listeners = new Set<() => void>();

function requestKey(serverId: string, agentId: string): string {
  return `${serverId}\0${agentId}`;
}

export function requestSubagentsTrackOpen(serverId: string, agentId: string): void {
  pending.add(requestKey(serverId, agentId));
  for (const listener of listeners) listener();
}

/**
 * Controlled open state for the pill of `agentId`'s subagents, opened by a pending request. Null
 * owner (a provider subagent's own list) never receives requests.
 */
export function useSubagentsTrackOpen(owner: { serverId: string; agentId: string } | null): {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} {
  const [open, setOpen] = useState(false);
  const key = owner ? requestKey(owner.serverId, owner.agentId) : null;
  useEffect(() => {
    if (!key) return undefined;
    const consume = () => {
      if (!pending.delete(key)) return;
      setOpen(true);
    };
    consume();
    listeners.add(consume);
    return () => {
      listeners.delete(consume);
    };
  }, [key]);
  const onOpenChange = useCallback((next: boolean) => setOpen(next), []);
  return { open, onOpenChange };
}

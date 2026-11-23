import { useEffect } from "react";
import { create } from "zustand";
import { isWeb } from "@/constants/platform";

export interface TimelineJumpTarget {
  epoch: string;
  seq: number;
}

interface PendingTimelineJumpState {
  // One request per agent; a newer request replaces an unconsumed one.
  byAgentKey: ReadonlyMap<string, TimelineJumpTarget>;
}

const usePendingTimelineJumpStore = create<PendingTimelineJumpState>(() => ({
  byAgentKey: new Map(),
}));

function agentKey(serverId: string, agentId: string): string {
  return `${serverId}\u0000${agentId}`;
}

/** Asks the agent's chat to scroll to a timeline position the next time it renders. */
export function requestTimelineJump(
  serverId: string,
  agentId: string,
  target: TimelineJumpTarget,
): void {
  usePendingTimelineJumpStore.setState((state) => {
    const byAgentKey = new Map(state.byAgentKey);
    byAgentKey.set(agentKey(serverId, agentId), { epoch: target.epoch, seq: target.seq });
    return { byAgentKey };
  });
}

export function usePendingTimelineJump(
  serverId: string,
  agentId: string,
): TimelineJumpTarget | null {
  return usePendingTimelineJumpStore(
    (state) => state.byAgentKey.get(agentKey(serverId, agentId)) ?? null,
  );
}

/** Clears the request only if it is still the one the caller read. */
export function consumeTimelineJump(
  serverId: string,
  agentId: string,
  target: TimelineJumpTarget,
): void {
  usePendingTimelineJumpStore.setState((state) => {
    const key = agentKey(serverId, agentId);
    if (state.byAgentKey.get(key) !== target) return state;
    const byAgentKey = new Map(state.byAgentKey);
    byAgentKey.delete(key);
    return { byAgentKey };
  });
}

/**
 * Runs the chat's jump for a plugin's `navigation.openAgent` position once the chat's epoch is
 * served. Only the web viewport can scroll to a message; native keeps the tail.
 */
export function useRequestedTimelineJump(input: {
  serverId: string;
  agentId: string;
  timelineEpoch: string | null;
  ready: boolean;
  jumpToSeq: (seq: number) => void;
}): void {
  const { serverId, agentId, timelineEpoch, ready, jumpToSeq } = input;
  const requested = usePendingTimelineJump(serverId, agentId);
  useEffect(() => {
    if (!requested || timelineEpoch === null || !ready) return;
    consumeTimelineJump(serverId, agentId, requested);
    if (!isWeb || requested.epoch !== timelineEpoch) return;
    jumpToSeq(requested.seq);
  }, [agentId, jumpToSeq, ready, requested, serverId, timelineEpoch]);
}

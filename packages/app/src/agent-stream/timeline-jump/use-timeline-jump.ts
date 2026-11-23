import { useEffect, useRef, useState, type RefObject } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";

const NO_STREAM_ITEMS: StreamItem[] = [];

interface PendingJump {
  requestId: number;
  seq: number;
  fetchSettled: boolean;
  hasScrolled: boolean;
}

export interface UseTimelineJumpInput {
  agentId: string;
  serverId: string;
  timelineEpoch: string | null;
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  viewportRef: RefObject<StreamViewportHandle | null>;
  onJumpError: () => void;
  // Message ids of the history the viewport has mounted. Live head messages are always mounted.
  mountedHistoryMessageIds?: ReadonlySet<string>;
  // Mounts a loaded message (opens its collapsed turn or widens the history window). Returns
  // true when the message mounts on a later render.
  revealLoadedMessage?: (messageId: string) => boolean;
}

export interface TimelineJump {
  /** Scrolls to the item at `seq` in the chat's current epoch, loading its window if needed. */
  jumpToSeq: (seq: number) => void;
}

function isSeqLoaded(serverId: string, agentId: string, epoch: string, seq: number): boolean {
  const cursor = useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId);
  if (!cursor || cursor.epoch !== epoch) return false;
  const ranges = [cursor, ...(cursor.retainedRanges ?? [])];
  return ranges.some((range) => seq >= range.startSeq && seq <= range.endSeq);
}

// A stream item carries the seq its row ended at, so an entry that spans several seqs (a tool
// call's lifecycle) is the first item at or after the entry's start. That holds only where the
// timeline around `seq` is loaded; elsewhere a later item past a gap would match.
function findItemAtSeq(input: {
  tail: StreamItem[];
  head: StreamItem[];
  epoch: string;
  seq: number;
  allowLater: boolean;
}): StreamItem | undefined {
  let later: StreamItem | undefined;
  for (const item of [...input.tail, ...input.head]) {
    const cursor = item.timelineCursor;
    if (cursor?.epoch !== input.epoch || cursor.seq < input.seq) continue;
    if (cursor.seq === input.seq) return item;
    if (input.allowLater && (!later || cursor.seq < (later.timelineCursor?.seq ?? Infinity))) {
      later = item;
    }
  }
  return later;
}

export function useTimelineJump({
  agentId,
  serverId,
  timelineEpoch,
  tail,
  head: providedHead,
  viewportRef,
  onJumpError,
  mountedHistoryMessageIds,
  revealLoadedMessage,
}: UseTimelineJumpInput): TimelineJump {
  const head = providedHead ?? NO_STREAM_ITEMS;
  const [pendingJump, setPendingJump] = useState<PendingJump | null>(null);
  const nextJumpRequestIdRef = useRef(0);

  useEffect(() => {
    nextJumpRequestIdRef.current += 1;
    setPendingJump(null);
  }, [agentId, timelineEpoch]);

  useEffect(() => {
    if (pendingJump === null || timelineEpoch === null) return;
    const target = findItemAtSeq({
      tail,
      head,
      epoch: timelineEpoch,
      seq: pendingJump.seq,
      allowLater:
        pendingJump.fetchSettled || isSeqLoaded(serverId, agentId, timelineEpoch, pendingJump.seq),
    });
    if (target) {
      if (pendingJump.hasScrolled) return;
      const isMounted =
        mountedHistoryMessageIds === undefined ||
        mountedHistoryMessageIds.has(target.id) ||
        head.includes(target);
      if (!isMounted) {
        revealLoadedMessage?.(target.id);
        return;
      }
      viewportRef.current?.scrollToMessage?.(target.id);
      setPendingJump((current) => {
        if (current?.requestId !== pendingJump.requestId) return current;
        return { ...current, hasScrolled: true };
      });
      return;
    }
    if (pendingJump.fetchSettled) setPendingJump(null);
  }, [
    agentId,
    head,
    mountedHistoryMessageIds,
    pendingJump,
    revealLoadedMessage,
    serverId,
    tail,
    timelineEpoch,
    viewportRef,
  ]);

  const jumpToSeq = useStableEvent((seq: number) => {
    nextJumpRequestIdRef.current += 1;
    setPendingJump(null);
    if (timelineEpoch === null) return;
    const loaded = findItemAtSeq({
      tail,
      head,
      epoch: timelineEpoch,
      seq,
      allowLater: isSeqLoaded(serverId, agentId, timelineEpoch, seq),
    });
    if (loaded) {
      if (revealLoadedMessage?.(loaded.id)) {
        const requestId = nextJumpRequestIdRef.current;
        setPendingJump({ requestId, seq, fetchSettled: true, hasScrolled: false });
        return;
      }
      viewportRef.current?.scrollToMessage?.(loaded.id);
      return;
    }
    const requestId = nextJumpRequestIdRef.current;
    setPendingJump({ requestId, seq, fetchSettled: false, hasScrolled: false });
    void getHostRuntimeStore()
      .fetchAgentTimeline(serverId, agentId, planTimelinePromptJump({ epoch: timelineEpoch, seq }))
      .catch((error: unknown) => {
        console.warn("Failed to load the timeline around a jump target", error);
        onJumpError();
      })
      .finally(() => {
        setPendingJump((current) => {
          if (current?.requestId !== requestId) return current;
          return { ...current, fetchSettled: true };
        });
      });
  });

  return { jumpToSeq };
}

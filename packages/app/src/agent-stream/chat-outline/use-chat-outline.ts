import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentTimelinePromptIndexPayload } from "@getpaseo/client/internal/daemon-client";
import { isWeb } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { StreamItem } from "@/types/stream";
import {
  createActivePromptPublisher,
  resolveActivePromptSeq,
  shouldAcceptPromptIndexEpoch,
  type ActivePromptSource,
  type ChatOutlinePrompt,
} from "./model";

const NO_PROMPTS: ChatOutlinePrompt[] = [];
const NO_STREAM_ITEMS: StreamItem[] = [];

export interface UseChatOutlineInput {
  agentId: string;
  serverId: string;
  timelineEpoch: string | null;
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  enabled: boolean;
  // The chat's timeline jump; the outline jumps to a prompt's seq.
  jumpToSeq: (seq: number) => void;
}

export interface ChatOutline {
  prompts: ChatOutlinePrompt[];
  activePrompt: ActivePromptSource;
  jumpToPrompt: (seq: number) => void;
  reportReadingPosition: (seq: number | null) => void;
}

function latestPromptSeqIn(items: StreamItem[], timelineEpoch: string | null): number {
  let latest = -1;
  for (const item of items) {
    if (item.kind === "user_message" && item.timelineCursor?.epoch === timelineEpoch) {
      latest = Math.max(latest, item.timelineCursor.seq);
    }
  }
  return latest;
}

export function useChatOutline({
  agentId,
  serverId,
  timelineEpoch,
  tail,
  head,
  enabled,
  jumpToSeq,
}: UseChatOutlineInput): ChatOutline {
  const [index, setIndex] = useState<AgentTimelinePromptIndexPayload | null>(null);
  const [activePrompt] = useState(createActivePromptPublisher);
  const readingSeqRef = useRef<number | null>(null);
  const nextIndexRequestIdRef = useRef(0);
  // A disabled outline (every native viewport) must not pay for the timeline per delta.
  const loadedTail = enabled ? tail : NO_STREAM_ITEMS;
  const loadedHead = enabled ? (head ?? NO_STREAM_ITEMS) : NO_STREAM_ITEMS;
  const prompts = enabled ? (index?.prompts ?? NO_PROMPTS) : NO_PROMPTS;

  // The viewed timeline already owns live delivery and reconnect catch-up. Its complete
  // loaded items (including rows outside the mounted window) invalidate the prompt index.
  // Only the head changes per streamed delta, so the tail's contribution is memoized.
  const tailPromptSeq = useMemo(
    () => latestPromptSeqIn(loadedTail, timelineEpoch),
    [loadedTail, timelineEpoch],
  );
  const latestPromptSeq = Math.max(tailPromptSeq, latestPromptSeqIn(loadedHead, timelineEpoch));

  useEffect(() => setIndex(null), [agentId, enabled, serverId, timelineEpoch]);

  // Only a timeline the daemon has served can be indexed. A draft's optimistic stream has no
  // epoch, and its id names no agent the daemon knows.
  useEffect(() => {
    if (!isWeb || !enabled || timelineEpoch === null) {
      setIndex(null);
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) return;
    let active = true;
    const refresh = () => {
      const requestId = ++nextIndexRequestIdRef.current;
      void client
        .listAgentTimelinePrompts(agentId)
        .then((payload) => {
          if (
            active &&
            requestId === nextIndexRequestIdRef.current &&
            shouldAcceptPromptIndexEpoch(timelineEpoch, payload.epoch)
          ) {
            setIndex(payload);
          }
          return undefined;
        })
        .catch(() => undefined);
    };
    refresh();
    return () => {
      active = false;
    };
  }, [agentId, enabled, serverId, timelineEpoch, latestPromptSeq]);

  // The transcript resolves display rows (including Markdown blocks and plugin cards) to
  // timeline positions. The outline uses the complete index, including unloaded prompts.
  const publishActivePrompt = useStableEvent(() => {
    activePrompt.publish(resolveActivePromptSeq(prompts, readingSeqRef.current));
  });

  const reportReadingPosition = useStableEvent((seq: number | null) => {
    readingSeqRef.current = seq;
    publishActivePrompt();
  });

  useEffect(() => {
    readingSeqRef.current = null;
    activePrompt.publish(null);
  }, [activePrompt, agentId, timelineEpoch]);

  // The transcript reports its reading position long before the index arrives, and a reader
  // who never scrolls would otherwise sit on an unmarked rail.
  useEffect(() => {
    publishActivePrompt();
  }, [prompts, publishActivePrompt]);

  return { prompts, activePrompt, jumpToPrompt: jumpToSeq, reportReadingPosition };
}

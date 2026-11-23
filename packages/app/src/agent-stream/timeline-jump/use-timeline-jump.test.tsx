// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import { useTimelineJump } from "./use-timeline-jump";

const runtime = vi.hoisted(() => ({ fetchAgentTimeline: vi.fn() }));
const loadedRange = vi.hoisted(() => ({
  current: null as null | { epoch: string; startSeq: number; endSeq: number },
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ fetchAgentTimeline: runtime.fetchAgentTimeline }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: {
        "server-1": {
          agentTimelineCursor: new Map(
            loadedRange.current ? [["agent-1", loadedRange.current]] : [],
          ),
        },
      },
    }),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function viewportWith(scrollToMessage: (messageId: string) => void) {
  const viewport: StreamViewportHandle = {
    scrollToBottom: vi.fn(),
    prepareForViewportChange: vi.fn(),
    holdReadingPosition: vi.fn(),
    scrollToMessage,
  };
  return { current: viewport };
}

// A tool call's row carries the seq its lifecycle ended at, after the entry's seqStart.
function toolCall(id: string, seq: number): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(seq),
    timelineCursor: { epoch: "epoch-1", seq },
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "mcp__asks__ask_create",
        status: "completed",
        error: null,
        detail: { type: "unknown", input: {}, output: null },
      },
    },
  } as StreamItem;
}

describe("useTimelineJump", () => {
  beforeEach(() => {
    runtime.fetchAgentTimeline.mockReset();
    loadedRange.current = null;
  });

  it("reports a failed unloaded prompt jump", async () => {
    runtime.fetchAgentTimeline.mockRejectedValue(new Error("disconnected"));
    const onJumpError = vi.fn();
    const viewportRef = createRef<StreamViewportHandle>();
    const { result } = renderHook(() =>
      useTimelineJump({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [],
        head: [],
        viewportRef,
        onJumpError,
      }),
    );
    await act(async () => result.current.jumpToSeq(1));

    await waitFor(() => expect(onJumpError).toHaveBeenCalledOnce());
  });

  it("reveals an already-loaded older prompt before scrolling to it", async () => {
    const scrollToMessage = vi.fn();
    const revealLoadedMessage = vi.fn(() => true);
    const viewport: StreamViewportHandle = {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      holdReadingPosition: vi.fn(),
      scrollToMessage,
    };
    const viewportRef = { current: viewport };
    const tail = [
      {
        id: "older-prompt",
        kind: "user_message" as const,
        text: "prompt",
        timestamp: new Date(1),
        timelineCursor: { epoch: "epoch-1", seq: 1 },
      },
    ];
    const { result, rerender } = renderHook(
      ({ mountedHistoryMessageIds }) =>
        useTimelineJump({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          viewportRef,
          onJumpError: vi.fn(),
          mountedHistoryMessageIds,
          revealLoadedMessage,
        }),
      { initialProps: { mountedHistoryMessageIds: new Set<string>() } },
    );

    await act(async () => result.current.jumpToSeq(1));
    expect(revealLoadedMessage).toHaveBeenCalledWith("older-prompt");
    expect(scrollToMessage).not.toHaveBeenCalled();

    rerender({ mountedHistoryMessageIds: new Set(["older-prompt"]) });
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledWith("older-prompt"));
  });

  it("reveals a fetched prompt that lands outside the mounted history window", async () => {
    const fetch = deferred<void>();
    runtime.fetchAgentTimeline.mockReturnValue(fetch.promise);
    const scrollToMessage = vi.fn();
    const revealLoadedMessage = vi.fn(() => true);
    const viewportRef = {
      current: {
        scrollToBottom: vi.fn(),
        prepareForViewportChange: vi.fn(),
        holdReadingPosition: vi.fn(),
        scrollToMessage,
      },
    };
    const fetchedPrompt = {
      id: "fetched-prompt",
      kind: "user_message" as const,
      text: "prompt",
      timestamp: new Date(1),
      timelineCursor: { epoch: "epoch-1", seq: 1 },
    };
    const { result, rerender } = renderHook(
      ({ tail, mountedHistoryMessageIds }) =>
        useTimelineJump({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          viewportRef,
          onJumpError: vi.fn(),
          mountedHistoryMessageIds,
          revealLoadedMessage,
        }),
      {
        initialProps: {
          tail: [] as (typeof fetchedPrompt)[],
          mountedHistoryMessageIds: new Set<string>(),
        },
      },
    );

    act(() => result.current.jumpToSeq(1));
    await waitFor(() => expect(runtime.fetchAgentTimeline).toHaveBeenCalledOnce());

    rerender({ tail: [fetchedPrompt], mountedHistoryMessageIds: new Set<string>() });
    await waitFor(() => expect(revealLoadedMessage).toHaveBeenCalledWith(fetchedPrompt.id));
    expect(scrollToMessage).not.toHaveBeenCalled();

    rerender({ tail: [fetchedPrompt], mountedHistoryMessageIds: new Set([fetchedPrompt.id]) });
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledOnce());
    expect(scrollToMessage).toHaveBeenCalledWith(fetchedPrompt.id);
    await act(async () => fetch.resolve());
  });

  it("jumps directly to a loaded prompt in the live head", async () => {
    const scrollToMessage = vi.fn();
    const viewport: StreamViewportHandle = {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      holdReadingPosition: vi.fn(),
      scrollToMessage,
    };
    const livePrompt = {
      id: "live-prompt",
      kind: "user_message" as const,
      text: "prompt",
      timestamp: new Date(2),
      timelineCursor: { epoch: "epoch-1", seq: 2 },
    };
    const revealLoadedMessage = vi.fn();
    revealLoadedMessage.mockReturnValue(false);
    const { result } = renderHook(() =>
      useTimelineJump({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [],
        head: [livePrompt],
        viewportRef: { current: viewport },
        onJumpError: vi.fn(),
        mountedHistoryMessageIds: new Set<string>(),
        revealLoadedMessage,
      }),
    );

    await act(async () => result.current.jumpToSeq(2));
    expect(scrollToMessage).toHaveBeenCalledWith("live-prompt");
  });
  it("jumps to the tool call whose lifecycle started at the seq", async () => {
    loadedRange.current = { epoch: "epoch-1", startSeq: 1, endSeq: 20 };
    const scrollToMessage = vi.fn();
    const { result } = renderHook(() =>
      useTimelineJump({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [toolCall("before", 4), toolCall("ask", 9), toolCall("after", 12)],
        head: [],
        viewportRef: viewportWith(scrollToMessage),
        onJumpError: vi.fn(),
        mountedHistoryMessageIds: new Set(["before", "ask", "after"]),
      }),
    );

    await act(async () => result.current.jumpToSeq(7));
    expect(scrollToMessage).toHaveBeenCalledWith("ask");
    expect(runtime.fetchAgentTimeline).not.toHaveBeenCalled();
  });

  it("loads the window instead of matching a later item past an unloaded gap", async () => {
    loadedRange.current = { epoch: "epoch-1", startSeq: 30, endSeq: 40 };
    const fetch = deferred<void>();
    runtime.fetchAgentTimeline.mockReturnValue(fetch.promise);
    const scrollToMessage = vi.fn();
    const { result, rerender } = renderHook(
      ({ tail }) =>
        useTimelineJump({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          viewportRef: viewportWith(scrollToMessage),
          onJumpError: vi.fn(),
        }),
      { initialProps: { tail: [toolCall("later", 31)] } },
    );

    act(() => result.current.jumpToSeq(7));
    expect(scrollToMessage).not.toHaveBeenCalled();
    expect(runtime.fetchAgentTimeline).toHaveBeenCalledOnce();

    rerender({ tail: [toolCall("ask", 9), toolCall("later", 31)] });
    await act(async () => fetch.resolve());
    await waitFor(() => expect(scrollToMessage).toHaveBeenCalledWith("ask"));
  });

  it("ignores a jump before the chat has a served epoch", () => {
    const { result } = renderHook(() =>
      useTimelineJump({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: null,
        tail: [],
        head: [],
        viewportRef: createRef<StreamViewportHandle>(),
        onJumpError: vi.fn(),
      }),
    );
    result.current.jumpToSeq(3);
    expect(runtime.fetchAgentTimeline).not.toHaveBeenCalled();
  });
});

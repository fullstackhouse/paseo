// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatOutline } from "./use-chat-outline";

const runtime = vi.hoisted(() => ({
  listAgentTimelinePrompts: vi.fn(),
  fetchAgentTimeline: vi.fn(),
  subscribeAgentTimeline: vi.fn(() => {
    throw new Error("The outline must reuse the viewed timeline");
  }),
}));

vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => runtime,
    fetchAgentTimeline: runtime.fetchAgentTimeline,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("useChatOutline", () => {
  beforeEach(() => {
    runtime.listAgentTimelinePrompts.mockReset();
    runtime.fetchAgentTimeline.mockReset();
    runtime.subscribeAgentTimeline.mockClear();
  });

  it("waits for a served timeline before requesting its prompt index", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({ epoch: "epoch-1", prompts: [] });
    const { rerender } = renderHook(
      ({ agentId, timelineEpoch }) =>
        useChatOutline({
          agentId,
          serverId: "server-1",
          timelineEpoch,
          tail: [],
          head: [],
          enabled: true,
          jumpToSeq: vi.fn(),
        }),
      { initialProps: { agentId: "draft_msg_1", timelineEpoch: null as string | null } },
    );

    expect(runtime.listAgentTimelinePrompts).not.toHaveBeenCalled();

    rerender({ agentId: "agent-1", timelineEpoch: "epoch-1" });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1));
    expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledWith("agent-1");
  });

  it("drops a late prompt index after the authoritative timeline epoch changes", async () => {
    const first = deferred<{ epoch: string; prompts: [] }>();
    const second = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    runtime.listAgentTimelinePrompts
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ timelineEpoch }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch,
          tail: [],
          head: [],
          enabled: true,
          jumpToSeq: vi.fn(),
        }),
      { initialProps: { timelineEpoch: "epoch-1" } },
    );
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1));

    rerender({ timelineEpoch: "epoch-2" });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2));
    await act(async () => first.resolve({ epoch: "epoch-1", prompts: [] }));
    expect(result.current.prompts).toEqual([]);

    await act(async () =>
      second.resolve({
        epoch: "epoch-2",
        prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "current prompt" }],
      }),
    );
    await waitFor(() => {
      expect(result.current.prompts).toHaveLength(1);
    });
    expect(result.current.prompts[0]?.seq).toBe(2);
  });

  it("refreshes from viewed user messages without another stream and keeps the newest index", async () => {
    const older = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    const newer = deferred<{
      epoch: string;
      prompts: Array<{ seq: number; timestamp: string; preview: string }>;
    }>();
    runtime.listAgentTimelinePrompts
      .mockResolvedValueOnce({ epoch: "epoch-1", prompts: [] })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result, rerender } = renderHook(
      ({ tail }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          timelineEpoch: "epoch-1",
          tail,
          head: [],
          enabled: true,
          jumpToSeq: vi.fn(),
        }),
      { initialProps: { tail: [] as import("@/types/stream").StreamItem[] } },
    );
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1));
    const loadedPrompt = (seq: number): import("@/types/stream").StreamItem => ({
      id: `prompt-${seq}`,
      kind: "user_message",
      text: "live prompt",
      timestamp: new Date(seq),
      timelineCursor: { epoch: "epoch-1", seq },
    });
    rerender({ tail: [loadedPrompt(2)] });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2));
    rerender({ tail: [loadedPrompt(2), loadedPrompt(3)] });
    await waitFor(() => expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(3));
    await act(async () =>
      newer.resolve({
        epoch: "epoch-1",
        prompts: [{ seq: 3, timestamp: new Date(3).toISOString(), preview: "newer" }],
      }),
    );
    await act(async () =>
      older.resolve({
        epoch: "epoch-1",
        prompts: [{ seq: 2, timestamp: new Date(2).toISOString(), preview: "older" }],
      }),
    );

    expect(result.current.prompts.map((prompt) => prompt.seq)).toEqual([3]);
    expect(runtime.subscribeAgentTimeline).not.toHaveBeenCalled();
  });

  it("refreshes after reconnect catch-up and visibility changes without reacting to assistant chunks", async () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-1",
      prompts: [{ seq: 1, timestamp: new Date(1).toISOString(), preview: "Unloaded prompt" }],
    });
    const { result, rerender } = renderHook(
      ({ enabled, head, timelineEpoch }) =>
        useChatOutline({
          agentId: "agent-1",
          serverId: "server-1",
          tail: [],
          head,
          timelineEpoch,
          enabled,
          jumpToSeq: vi.fn(),
        }),
      {
        initialProps: {
          enabled: true,
          head: [] as import("@/types/stream").StreamItem[],
          timelineEpoch: "epoch-1",
        },
      },
    );
    await waitFor(() => expect(result.current.prompts[0]?.preview).toBe("Unloaded prompt"));
    rerender({
      enabled: true,
      head: [
        {
          id: "assistant",
          kind: "assistant_message",
          text: "chunk",
          timestamp: new Date(),
          timelineCursor: { epoch: "epoch-1", seq: 2 },
        },
      ],
      timelineEpoch: "epoch-1",
    });
    expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(1);
    rerender({ enabled: false, head: [], timelineEpoch: "epoch-1" });
    expect(result.current.prompts).toEqual([]);
    // The viewed model publishes the catch-up from the reconnected transport.
    runtime.listAgentTimelinePrompts.mockResolvedValue({
      epoch: "epoch-2",
      prompts: [{ seq: 1, timestamp: new Date(2).toISOString(), preview: "Replaced conversation" }],
    });
    rerender({
      enabled: true,
      head: [
        {
          id: "reconnected-user",
          kind: "user_message",
          text: "Replaced conversation",
          timestamp: new Date(2),
          timelineCursor: { epoch: "epoch-2", seq: 1 },
        },
      ],
      timelineEpoch: "epoch-2",
    });
    await waitFor(() => expect(result.current.prompts[0]?.preview).toBe("Replaced conversation"));
    expect(runtime.listAgentTimelinePrompts).toHaveBeenCalledTimes(2);
    expect(runtime.subscribeAgentTimeline).not.toHaveBeenCalled();
  });

  it("jumps to a prompt through the chat's timeline jump", () => {
    runtime.listAgentTimelinePrompts.mockResolvedValue({ epoch: "epoch-1", prompts: [] });
    const jumpToSeq = vi.fn();
    const { result } = renderHook(() =>
      useChatOutline({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch: "epoch-1",
        tail: [],
        head: [],
        enabled: true,
        jumpToSeq,
      }),
    );
    result.current.jumpToPrompt(3);
    expect(jumpToSeq).toHaveBeenCalledWith(3);
  });
});

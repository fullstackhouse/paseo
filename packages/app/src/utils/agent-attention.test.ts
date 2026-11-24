import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { createAgentAttentionController, pickAttentionAgent } from "./agent-attention";

describe("agent attention acknowledgement", () => {
  function setup() {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const controller = createAgentAttentionController({
      clear: async () => {
        calls.push("clear");
      },
      onError: (failure) => errors.push(failure),
    });
    const state = {
      focused: true,
      ready: true,
      requiresAttention: false,
      // FSH: finished attention is never cleared by viewing, so these cases use an error.
      attentionReason: "error" as "finished" | "error" | "permission",
      focusRequest: null as object | null,
    };
    return { controller, state, calls, errors };
  }

  it("acknowledges entry, but keeps attention arriving while focused until another focus action", async () => {
    const { controller, state, calls } = setup();
    controller.update(state);
    state.requiresAttention = true;
    controller.update(state);
    expect(calls).toEqual([]);
    controller.update({ ...state, focusRequest: {} });
    expect(calls).toEqual(["clear"]);
    await Promise.resolve();
    controller.update({ ...state, focusRequest: {} });
    expect(calls).toEqual(["clear", "clear"]);
  });

  it("clears on entry and never clears on leaving", async () => {
    const { controller, state, calls } = setup();
    controller.update({ ...state, requiresAttention: true });
    expect(calls).toEqual(["clear"]);
    await Promise.resolve();
    controller.update({ ...state, focused: false, requiresAttention: true });
    expect(calls).toEqual(["clear"]);
    controller.update({ ...state, requiresAttention: true });
    expect(calls).toEqual(["clear", "clear"]);
  });

  it("waits for connection and agent data before consuming entry", () => {
    const { controller, state, calls } = setup();
    controller.update({ ...state, ready: false });
    controller.update({ ...state, requiresAttention: true });
    expect(calls).toEqual(["clear"]);
  });

  it("does not treat reconnecting as another focus action", () => {
    const { controller, state, calls } = setup();
    controller.update(state);
    controller.update({ ...state, requiresAttention: true });
    controller.update({ ...state, requiresAttention: true, ready: false });
    controller.update({ ...state, requiresAttention: true });
    expect(calls).toEqual([]);
    controller.focus();
    expect(calls).toEqual(["clear"]);
  });

  it("holds a repeat focus while cached data is waiting for synchronization", () => {
    const { controller, state, calls } = setup();
    controller.update(state);
    controller.update({ ...state, ready: false });
    controller.focus();
    controller.update({ ...state, ready: false, requiresAttention: true });
    expect(calls).toEqual([]);
    controller.update({ ...state, requiresAttention: true });
    expect(calls).toEqual(["clear"]);
  });

  it("drops a pending focus when the user leaves before fresh data arrives", () => {
    const { controller, state, calls } = setup();
    controller.update({ ...state, ready: false });
    controller.update({ ...state, focused: false, requiresAttention: true });
    expect(calls).toEqual([]);
  });

  it("keeps finished attention (Ready to review) through entry and focus", () => {
    const { controller, state, calls } = setup();
    controller.update({ ...state, requiresAttention: true, attentionReason: "finished" });
    controller.focus();
    controller.update({
      ...state,
      requiresAttention: true,
      attentionReason: "finished",
      focusRequest: {},
    });
    expect(calls).toEqual([]);
  });

  it("keeps permission attention and deduplicates an in-flight acknowledgement", () => {
    const { controller, state, calls } = setup();
    controller.update({ ...state, requiresAttention: true, attentionReason: "permission" });
    controller.focus();
    expect(calls).toEqual([]);
    controller.update({ ...state, requiresAttention: true });
    controller.focus();
    controller.focus();
    expect(calls).toEqual(["clear"]);
  });

  it("reports failure and allows the next interaction to retry", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const error = new Error("Disconnected");
    const controller = createAgentAttentionController({
      clear: async () => {
        if (++calls === 1) throw error;
      },
      onError: (failure) => errors.push(failure),
    });
    controller.update({
      focused: true,
      ready: true,
      requiresAttention: true,
      attentionReason: "error",
      focusRequest: null,
    });
    await Promise.resolve();
    expect(errors).toEqual([error]);
    controller.focus();
    expect(calls).toBe(2);
  });
});

function createAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  const { id, ...rest } = input;
  return {
    serverId: "server-1",
    id,
    provider: "codex",
    status: "idle",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-01-01T00:00:00.000Z"),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo/worktree",
    model: null,
    parentAgentId: null,
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    ...rest,
    turn: rest.turn ?? { phase: "idle", cancellationRequestId: null },
  };
}

describe("pickAttentionAgent", () => {
  it("returns null for empty input", () => {
    expect(pickAttentionAgent([])).toBeNull();
  });

  it("returns null when no agent requires attention", () => {
    expect(
      pickAttentionAgent([
        createAgent({ id: "agent-1", requiresAttention: false, attentionReason: "permission" }),
        createAgent({ id: "agent-2", requiresAttention: false, attentionReason: null }),
      ]),
    ).toBeNull();
  });

  it("returns the single permission agent", () => {
    expect(
      pickAttentionAgent([
        createAgent({
          id: "agent-1",
          requiresAttention: true,
          attentionReason: "permission",
          attentionTimestamp: new Date("2026-01-03T00:00:00.000Z"),
        }),
      ]),
    ).toBe("agent-1");
  });

  it("ignores finished agents (Ready to review)", () => {
    expect(
      pickAttentionAgent([
        createAgent({
          id: "finished-agent",
          requiresAttention: true,
          attentionReason: "finished",
          attentionTimestamp: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ]),
    ).toBeNull();
  });

  it("prefers a failed agent over an older finished one", () => {
    expect(
      pickAttentionAgent([
        createAgent({
          id: "finished-agent",
          requiresAttention: true,
          attentionReason: "finished",
          attentionTimestamp: new Date("2026-01-01T00:00:00.000Z"),
        }),
        createAgent({
          id: "error-agent",
          requiresAttention: true,
          attentionReason: "error",
          attentionTimestamp: new Date("2026-01-02T00:00:00.000Z"),
        }),
      ]),
    ).toBe("error-agent");
  });

  it("prioritizes permission over error", () => {
    expect(
      pickAttentionAgent([
        createAgent({
          id: "finished-agent",
          requiresAttention: true,
          attentionReason: "finished",
          attentionTimestamp: new Date("2026-01-01T00:00:00.000Z"),
        }),
        createAgent({
          id: "error-agent",
          requiresAttention: true,
          attentionReason: "error",
          attentionTimestamp: new Date("2026-01-02T00:00:00.000Z"),
        }),
        createAgent({
          id: "permission-agent",
          requiresAttention: true,
          attentionReason: "permission",
          attentionTimestamp: new Date("2026-01-03T00:00:00.000Z"),
        }),
      ]),
    ).toBe("permission-agent");
  });

  it("breaks ties by oldest attention timestamp", () => {
    expect(
      pickAttentionAgent([
        createAgent({
          id: "newer-permission-agent",
          requiresAttention: true,
          attentionReason: "permission",
          attentionTimestamp: new Date("2026-01-03T00:00:00.000Z"),
        }),
        createAgent({
          id: "older-permission-agent",
          requiresAttention: true,
          attentionReason: "permission",
          attentionTimestamp: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ]),
    ).toBe("older-permission-agent");
  });

  it("ignores subagents even when they require attention", () => {
    expect(
      pickAttentionAgent([
        createAgent({
          id: "subagent",
          parentAgentId: "parent-agent",
          requiresAttention: true,
          attentionReason: "permission",
          attentionTimestamp: new Date("2026-01-01T00:00:00.000Z"),
        }),
        createAgent({
          id: "top-level-agent",
          requiresAttention: true,
          attentionReason: "error",
          attentionTimestamp: new Date("2026-01-02T00:00:00.000Z"),
        }),
      ]),
    ).toBe("top-level-agent");
  });

  it("returns null when only subagents require attention", () => {
    expect(
      pickAttentionAgent([
        createAgent({
          id: "subagent",
          parentAgentId: "parent-agent",
          requiresAttention: true,
          attentionReason: "permission",
          attentionTimestamp: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ]),
    ).toBeNull();
  });

  it("ignores agents with requiresAttention true but null reason", () => {
    expect(
      pickAttentionAgent([
        createAgent({
          id: "ignored-agent",
          requiresAttention: true,
          attentionReason: null,
          attentionTimestamp: new Date("2026-01-01T00:00:00.000Z"),
        }),
        createAgent({
          id: "error-agent",
          requiresAttention: true,
          attentionReason: "error",
          attentionTimestamp: new Date("2026-01-02T00:00:00.000Z"),
        }),
      ]),
    ).toBe("error-agent");
  });
});

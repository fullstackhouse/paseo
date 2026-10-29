import { describe, expect, it } from "vitest";

import { pickDeliveryAgentId, type DeliveryAgentCandidate } from "./delivery-agent";

function agent(
  id: string,
  overrides: Partial<DeliveryAgentCandidate> = {},
): DeliveryAgentCandidate {
  return {
    id,
    workspaceId: "ws-1",
    archivedAt: null,
    parentAgentId: null,
    lastActivityAt: new Date("2026-10-29T09:00:00Z"),
    ...overrides,
  };
}

describe("pickDeliveryAgentId", () => {
  it("picks the focused agent when it belongs to the workspace", () => {
    const agents = [agent("a", { lastActivityAt: new Date("2026-10-29T10:00:00Z") }), agent("b")];
    expect(pickDeliveryAgentId({ agents, workspaceId: "ws-1", focusedAgentId: "b" })).toBe("b");
  });

  it("falls back to the most recently active agent of the workspace", () => {
    const agents = [
      agent("old"),
      agent("recent", { lastActivityAt: new Date("2026-10-29T10:00:00Z") }),
      agent("other-workspace", {
        workspaceId: "ws-2",
        lastActivityAt: new Date("2026-10-29T11:00:00Z"),
      }),
    ];
    expect(
      pickDeliveryAgentId({ agents, workspaceId: "ws-1", focusedAgentId: "other-workspace" }),
    ).toBe("recent");
  });

  it("skips archived agents and subagents", () => {
    const agents = [
      agent("archived", {
        archivedAt: new Date(),
        lastActivityAt: new Date("2026-10-29T10:00:00Z"),
      }),
      agent("child", { parentAgentId: "main", lastActivityAt: new Date("2026-10-29T11:00:00Z") }),
      agent("main"),
    ];
    expect(pickDeliveryAgentId({ agents, workspaceId: "ws-1", focusedAgentId: "child" })).toBe(
      "main",
    );
  });

  it("returns null when the workspace has no agent", () => {
    expect(
      pickDeliveryAgentId({
        agents: [agent("x", { workspaceId: "ws-2" })],
        workspaceId: "ws-1",
        focusedAgentId: null,
      }),
    ).toBeNull();
  });
});

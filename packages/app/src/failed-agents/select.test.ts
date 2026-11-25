import { describe, expect, it } from "vitest";
import { failedAgentsDismissalKey, isRetryableFailure, selectFailedAgents } from "./select";

const NETWORK_ERROR =
  "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";

function agent(
  id: string,
  overrides: {
    status?: "idle" | "running" | "initializing" | "closed" | "error";
    lastError?: string | null;
    archivedAt?: Date | null;
    updatedAt?: Date;
  } = {},
) {
  return {
    serverId: "host",
    id,
    title: null,
    status: overrides.status ?? "error",
    lastError: "lastError" in overrides ? overrides.lastError : NETWORK_ERROR,
    archivedAt: overrides.archivedAt ?? null,
    updatedAt: overrides.updatedAt ?? new Date(1000),
  };
}

describe("isRetryableFailure", () => {
  it("accepts an agent that failed on an outage", () => {
    expect(isRetryableFailure(agent("a"))).toBe(true);
  });

  it("rejects usage limits, other errors, running and archived agents", () => {
    expect(isRetryableFailure(agent("limit", { lastError: "You've hit your limit" }))).toBe(false);
    expect(isRetryableFailure(agent("other", { lastError: "Invalid model" }))).toBe(false);
    expect(isRetryableFailure(agent("none", { lastError: null }))).toBe(false);
    expect(isRetryableFailure(agent("running", { status: "running" }))).toBe(false);
    expect(isRetryableFailure(agent("archived", { archivedAt: new Date(2000) }))).toBe(false);
  });
});

describe("selectFailedAgents", () => {
  it("collects every failed agent across hosts, usage limits included", () => {
    const selected = selectFailedAgents({
      one: {
        agents: new Map([
          ["outage", agent("outage")],
          ["limit", agent("limit", { lastError: "You've hit your limit" })],
          ["idle", agent("idle", { status: "idle" })],
          ["archived", agent("archived", { archivedAt: new Date(2000) })],
        ]),
      },
      two: {
        agents: new Map([["other", { ...agent("other", { lastError: null }), serverId: "two" }]]),
      },
    });
    expect(selected.map((a) => a.id)).toEqual(["outage", "limit", "other"]);
  });

  it("walks a host's agents once per agents map, and again when the map is replaced", () => {
    const agents = new Map([["a", agent("a")]]);
    const sessions = { host: { agents } };
    expect(selectFailedAgents(sessions).map((a) => a.id)).toEqual(["a"]);

    // The store never edits a map in place; doing it here shows the walk isn't repeated.
    agents.set("b", agent("b"));
    expect(selectFailedAgents(sessions).map((a) => a.id)).toEqual(["a"]);

    const replaced = { host: { agents: new Map(agents) } };
    expect(selectFailedAgents(replaced).map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("returns the same list until a host's agents map changes", () => {
    const one = new Map([["a", agent("a")]]);
    const two = new Map([["b", { ...agent("b"), serverId: "two" }]]);
    const first = selectFailedAgents({ one: { agents: one }, two: { agents: two } });
    expect(selectFailedAgents({ one: { agents: one }, two: { agents: two } })).toBe(first);

    const replaced = selectFailedAgents({ one: { agents: new Map(one) }, two: { agents: two } });
    expect(replaced).not.toBe(first);
    expect(replaced.map((a) => a.id)).toEqual(["a", "b"]);
    expect(selectFailedAgents({ one: { agents: one } }).map((a) => a.id)).toEqual(["a"]);
  });
});

describe("failedAgentsDismissalKey", () => {
  it("changes when an agent fails again", () => {
    const first = failedAgentsDismissalKey([agent("a"), agent("b", { updatedAt: new Date(3000) })]);
    const again = failedAgentsDismissalKey([agent("a", { updatedAt: new Date(5000) })]);
    expect(first).toBe("failed-agents:3000");
    expect(again).not.toBe(first);
  });
});

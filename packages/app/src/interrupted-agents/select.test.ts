import { describe, expect, it } from "vitest";
import {
  formatInterruptedAgentNames,
  interruptedAgentsDismissalKey,
  selectInterruptedAgents,
} from "./select";

function agent(
  id: string,
  overrides: {
    status?: "idle" | "running" | "initializing" | "closed" | "error";
    interruptedAt?: Date | null;
    archivedAt?: Date | null;
  } = {},
) {
  return {
    serverId: "host",
    id,
    status: overrides.status ?? "closed",
    interruptedAt: "interruptedAt" in overrides ? overrides.interruptedAt : new Date(1000),
    archivedAt: overrides.archivedAt ?? null,
  };
}

function sessions(...agents: ReturnType<typeof agent>[]) {
  return { host: { agents: new Map(agents.map((a) => [a.id, a])) } };
}

describe("selectInterruptedAgents", () => {
  it("returns interrupted agents that haven't been resumed or archived", () => {
    const selected = selectInterruptedAgents(
      sessions(
        agent("closed"),
        agent("idle", { status: "idle" }),
        agent("resumed", { status: "running" }),
        agent("starting", { status: "initializing" }),
        agent("archived", { archivedAt: new Date(2000) }),
        agent("never", { interruptedAt: null }),
      ),
    );
    expect(selected.map((a) => a.id)).toEqual(["closed", "idle"]);
  });

  it("collects across hosts", () => {
    const selected = selectInterruptedAgents({
      a: { agents: new Map([["one", agent("one")]]) },
      b: { agents: new Map([["two", agent("two")]]) },
    });
    expect(selected.map((a) => a.id)).toEqual(["one", "two"]);
  });
});

describe("interruptedAgentsDismissalKey", () => {
  it("keys on the latest interruption so a later restart shows again", () => {
    expect(
      interruptedAgentsDismissalKey([
        agent("a", { interruptedAt: new Date(1000) }),
        agent("b", { interruptedAt: new Date(5000) }),
      ]),
    ).toBe("interrupted-agents:5000");
  });
});

describe("formatInterruptedAgentNames", () => {
  const labels = { untitled: "Untitled", more: (count: number) => `+${count} more` };

  it("lists up to three names and counts the rest", () => {
    expect(formatInterruptedAgentNames(["A", null, " ", "D", "E"], labels)).toBe(
      "A, Untitled, Untitled, +2 more",
    );
    expect(formatInterruptedAgentNames(["A", "B"], labels)).toBe("A, B");
  });
});

import { expect, test } from "vitest";
import type { AgentBackgroundWorkItem } from "../background-work/index.js";
import type { ProviderSubagentDescriptor } from "../provider-subagents/store.js";
import { describeLiveWork } from "./live-work.js";

function subagent(overrides: Partial<ProviderSubagentDescriptor>): ProviderSubagentDescriptor {
  return {
    id: "task",
    parentAgentId: "lead",
    parentSubagentId: null,
    provider: "claude",
    title: null,
    description: null,
    status: "running",
    createdAt: "2026-11-26T10:00:00.000Z",
    updatedAt: "2026-11-26T10:00:00.000Z",
    toolCallId: null,
    cwd: null,
    subtitle: null,
    workedMs: 0,
    runStartedAt: null,
    ...overrides,
  };
}

function work(overrides: Partial<AgentBackgroundWorkItem>): AgentBackgroundWorkItem {
  return {
    id: "shell",
    kind: "shell",
    description: null,
    startedAt: "2026-11-26T10:00:00.000Z",
    ...overrides,
  };
}

function source(internal = false) {
  return {
    getAgent: (id: string) => (id === "lead" ? { internal } : null),
    listProviderSubagents: () => [
      subagent({ id: "a", title: "Build detector phase 1" }),
      subagent({ id: "b", description: "Migrate catalog" }),
      subagent({ id: "c", title: "Review lane A", parentSubagentId: "a" }),
      subagent({ id: "d", title: "Finished", status: "completed" }),
    ],
    listAgentBackgroundWork: () => [
      work({ id: "gate", description: "Run the validation gate" }),
      work({ id: "watch", kind: "monitor", description: "gate step results" }),
      work({ id: "x", kind: "other" }),
      // A heartbeat is the daemon's own work and survives the restart.
      work({ id: "heartbeat:check-in", kind: "heartbeat", description: "Check in" }),
    ],
  };
}

test("labels running top-level subagents, shells and monitors", () => {
  expect(describeLiveWork(source(), "lead")).toEqual([
    "Subagent: Build detector phase 1",
    "Subagent: Migrate catalog",
    "Background shell: Run the validation gate",
    "Monitor: gate step results",
    "Background job: x",
  ]);
});

test("has nothing for unloaded and private agents", () => {
  expect(describeLiveWork(source(), "other")).toEqual([]);
  expect(describeLiveWork(source(true), "lead")).toEqual([]);
});

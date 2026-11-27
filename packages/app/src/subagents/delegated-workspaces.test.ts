import { describe, expect, test } from "vitest";
import { buildDelegatedWorkspaceIds } from "./delegated-workspaces";

interface TestAgent {
  parentAgentId: string | null;
  workspaceId?: string;
  archivedAt?: Date | null;
  background?: boolean;
}

function agents(entries: Record<string, TestAgent>) {
  return new Map(Object.entries(entries));
}

describe("buildDelegatedWorkspaceIds", () => {
  test("hides a workspace whose agents all serve an agent in another workspace", () => {
    const ids = buildDelegatedWorkspaceIds(
      agents({
        orchestrator: { parentAgentId: null, workspaceId: "main" },
        worker: { parentAgentId: "orchestrator", workspaceId: "wt-1" },
        helper: { parentAgentId: "worker", workspaceId: "wt-1" },
      }),
    );

    expect([...ids]).toEqual(["wt-1"]);
  });

  test("keeps a workspace that also has a root agent", () => {
    const ids = buildDelegatedWorkspaceIds(
      agents({
        orchestrator: { parentAgentId: null, workspaceId: "main" },
        worker: { parentAgentId: "orchestrator", workspaceId: "wt-1" },
        mine: { parentAgentId: null, workspaceId: "wt-1" },
      }),
    );

    expect(ids.size).toBe(0);
  });

  test("keeps a workspace whose parent is archived, unloaded or on another host", () => {
    const ids = buildDelegatedWorkspaceIds(
      agents({
        archivedParent: { parentAgentId: null, workspaceId: "main", archivedAt: new Date() },
        orphan: { parentAgentId: "archivedParent", workspaceId: "wt-1" },
        unknown: { parentAgentId: "not-loaded", workspaceId: "wt-2" },
      }),
    );

    expect(ids.size).toBe(0);
  });

  test("ignores archived and background agents", () => {
    const ids = buildDelegatedWorkspaceIds(
      agents({
        orchestrator: { parentAgentId: null, workspaceId: "main" },
        worker: { parentAgentId: "orchestrator", workspaceId: "wt-1" },
        oldRoot: { parentAgentId: null, workspaceId: "wt-1", archivedAt: new Date() },
        bg: { parentAgentId: null, workspaceId: "wt-1", background: true },
      }),
    );

    expect([...ids]).toEqual(["wt-1"]);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedWorkspaceRegistry,
} from "../workspace-registry.js";
import { setupWorkspaceManualGroupClearer } from "./index.js";

const EARLIER = "2026-11-20T08:00:00.000Z";

describe("setupWorkspaceManualGroupClearer", () => {
  let dir: string;
  let registry: FileBackedWorkspaceRegistry;
  let emit: (event: AgentManagerEvent) => void = () => {};
  let clearer: ReturnType<typeof setupWorkspaceManualGroupClearer> | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "manual-group-"));
    registry = new FileBackedWorkspaceRegistry(
      path.join(dir, "workspaces.json"),
      createTestLogger(),
    );
    await registry.initialize();
    for (const id of ["ws_moved", "ws_other"]) {
      await registry.upsert(
        createPersistedWorkspaceRecord({
          workspaceId: id,
          projectId: "prj_1",
          cwd: `/tmp/${id}`,
          kind: "directory",
          displayName: id,
          createdAt: EARLIER,
          updatedAt: EARLIER,
          manualGroup: { group: "blocked", setAt: EARLIER },
        }),
      );
    }
    clearer = setupWorkspaceManualGroupClearer({
      agentManager: {
        subscribe: (callback) => {
          emit = callback as (event: AgentManagerEvent) => void;
          return () => {};
        },
      },
      workspaceRegistry: registry,
      logger: createTestLogger(),
    });
  });

  afterEach(async () => {
    clearer?.close();
    clearer = null;
    await rm(dir, { recursive: true, force: true });
  });

  function state(
    lifecycle: ManagedAgent["lifecycle"],
    workspaceId = "ws_moved",
  ): AgentManagerEvent {
    return {
      type: "agent_state",
      agent: { id: "agent_1", lifecycle, workspaceId } as ManagedAgent,
    };
  }

  async function manualGroup(id: string) {
    await clearer?.flush();
    return (await registry.get(id))?.manualGroup ?? null;
  }

  test("ends the move when a turn starts in that workspace, and leaves others alone", async () => {
    emit(state("idle"));
    expect(await manualGroup("ws_moved")).toEqual({ group: "blocked", setAt: EARLIER });
    emit(state("running"));
    expect(await manualGroup("ws_moved")).toBeNull();
    expect(await manualGroup("ws_other")).toEqual({ group: "blocked", setAt: EARLIER });
  });

  test("keeps a move made while the turn was already running until the next turn starts", async () => {
    emit(state("running"));
    await clearer?.flush();
    await registry.update("ws_moved", (existing) => ({
      ...existing,
      manualGroup: { group: "done", setAt: EARLIER },
    }));
    emit(state("running"));
    expect(await manualGroup("ws_moved")).toEqual({ group: "done", setAt: EARLIER });
    emit(state("idle"));
    emit(state("running"));
    expect(await manualGroup("ws_moved")).toBeNull();
  });
});

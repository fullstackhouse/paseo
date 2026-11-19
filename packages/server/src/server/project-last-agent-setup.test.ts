import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { createTestLogger } from "../test-utils/test-logger.js";
import type { AgentSubscriber, ManagedAgent } from "./agent/agent-manager.js";
import {
  setupProjectLastAgentSetupRecorder,
  type ProjectLastAgentSetupRecorder,
} from "./project-last-agent-setup.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
} from "./workspace-registry.js";
import type { ProjectUpdate } from "./workspace-reconciliation-service.js";

const CREATED = "2026-11-18T08:00:00.000Z";

function makeAgent(input: {
  id: string;
  provider?: string;
  model?: string;
  promptedAt: string | null;
  workspaceId?: string;
  labels?: Record<string, string>;
  internal?: boolean;
}): ManagedAgent {
  return {
    id: input.id,
    provider: input.provider ?? "claude",
    workspaceId: input.workspaceId ?? "ws-1",
    config: { provider: input.provider ?? "claude", model: input.model, thinkingOptionId: "high" },
    currentModeId: "auto",
    features: [{ type: "toggle", id: "fast", label: "Fast", value: true }],
    lastUserMessageAt: input.promptedAt ? new Date(input.promptedAt) : null,
    labels: input.labels ?? {},
    internal: input.internal,
  } as ManagedAgent;
}

describe("setupProjectLastAgentSetupRecorder", () => {
  let dir: string;
  let projectRegistry: FileBackedProjectRegistry;
  let emit: AgentSubscriber;
  let recorder: ProjectLastAgentSetupRecorder;
  let updates: ProjectUpdate[];
  let projectId: string;
  let projectMutations: number;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "project-last-agent-setup-"));
    const logger = createTestLogger();
    projectRegistry = new FileBackedProjectRegistry(path.join(dir, "projects.json"), logger);
    const workspaceRegistry = new FileBackedWorkspaceRegistry(
      path.join(dir, "workspaces.json"),
      logger,
    );
    await projectRegistry.initialize();
    await workspaceRegistry.initialize();
    const project = await projectRegistry.getOrCreateActiveByRoot({
      rootPath: "/repo",
      kind: "git",
      displayName: "repo",
      timestamp: CREATED,
    });
    projectId = project.projectId;
    await workspaceRegistry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "ws-1",
        projectId,
        cwd: "/repo",
        kind: "local_checkout",
        displayName: "repo",
        createdAt: CREATED,
        updatedAt: CREATED,
      }),
    );
    updates = [];
    projectMutations = 0;
    projectRegistry.subscribeToMutations(() => {
      projectMutations += 1;
    });
    recorder = setupProjectLastAgentSetupRecorder({
      agentManager: {
        subscribe: (callback) => {
          emit = callback;
          return () => {};
        },
      },
      workspaceRegistry,
      projectRegistry,
      logger,
      onProjectUpdate: (update) => updates.push(update),
    });
  });

  afterEach(async () => {
    recorder.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function lastSetup() {
    await recorder.flush();
    return (await projectRegistry.get(projectId))?.lastAgentSetup ?? null;
  }

  test("saves a prompted top-level agent's setup on its project and publishes it", async () => {
    emit({
      type: "agent_state",
      agent: makeAgent({ id: "a", model: "claude-opus-5-5", promptedAt: "2026-11-19T09:00:00Z" }),
    });

    expect(await lastSetup()).toEqual({
      provider: "claude",
      model: "claude-opus-5-5",
      modeId: "auto",
      thinkingOptionId: "high",
      featureValues: { fast: true },
      promptedAt: "2026-11-19T09:00:00.000Z",
    });
    expect(updates).toHaveLength(1);
    // Mutation listeners re-describe every workspace of the project; a prompt must not wake them.
    expect(projectMutations).toBe(0);
    expect(updates[0]).toMatchObject({
      kind: "upsert",
      project: { lastAgentSetup: { model: "claude-opus-5-5" } },
    });
  });

  test("keeps the latest prompt when an older agent reports afterwards", async () => {
    emit({
      type: "agent_state",
      agent: makeAgent({ id: "new", model: "claude-opus-5-5", promptedAt: "2026-11-19T09:00:00Z" }),
    });
    emit({
      type: "agent_state",
      agent: makeAgent({
        id: "old",
        provider: "codex",
        model: "gpt-6-astra",
        promptedAt: "2026-11-18T15:00:00Z",
      }),
    });

    expect(await lastSetup()).toMatchObject({ provider: "claude", model: "claude-opus-5-5" });
    expect(updates).toHaveLength(1);
  });

  test("writes once per prompt, not on every state change", async () => {
    const agent = makeAgent({ id: "a", model: "m", promptedAt: "2026-11-19T09:00:00Z" });
    emit({ type: "agent_state", agent });
    emit({ type: "agent_state", agent });
    await recorder.flush();
    emit({
      type: "agent_state",
      agent: makeAgent({ id: "a", model: "m2", promptedAt: "2026-11-19T10:00:00Z" }),
    });

    expect(await lastSetup()).toMatchObject({ model: "m2" });
    expect(updates).toHaveLength(2);
  });

  test("ignores subagents, internal agents, unprompted agents and unknown workspaces", async () => {
    const promptedAt = "2026-11-19T09:00:00Z";
    emit({
      type: "agent_state",
      agent: makeAgent({ id: "child", promptedAt, labels: { [PARENT_AGENT_ID_LABEL]: "p" } }),
    });
    emit({ type: "agent_state", agent: makeAgent({ id: "internal", promptedAt, internal: true }) });
    emit({ type: "agent_state", agent: makeAgent({ id: "fresh", promptedAt: null }) });
    emit({
      type: "agent_state",
      agent: makeAgent({ id: "lost", promptedAt, workspaceId: "nope" }),
    });

    expect(await lastSetup()).toBeNull();
    expect(updates).toHaveLength(0);
  });

  test("skips an archived project", async () => {
    await projectRegistry.archive(projectId, "2026-11-19T08:00:00.000Z");
    emit({
      type: "agent_state",
      agent: makeAgent({ id: "a", model: "m", promptedAt: "2026-11-19T09:00:00Z" }),
    });

    expect(await lastSetup()).toBeNull();
    expect(updates).toHaveLength(0);
  });
});

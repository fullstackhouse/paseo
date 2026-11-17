import pino from "pino";
import { describe, expect, test } from "vitest";
import type { AgentManager } from "./agent/agent-manager.js";
import type { StoredAgentRecord } from "./agent/agent-storage.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { createPersistedWorkspaceRecord, type WorkspaceRegistry } from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("auto-name preserves workspace archival that lands during its metadata write", async () => {
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-auto-name",
    projectId: "project-auto-name",
    cwd: "/workspace",
    kind: "directory",
    displayName: "workspace",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const mutationStarted = deferred();
  const allowMutation = deferred();
  const updateEmitted = deferred();
  const workspaceRegistry = {
    update: async (_workspaceId, updater) => {
      mutationStarted.resolve();
      await allowMutation.promise;
      workspace = updater(workspace);
      return workspace;
    },
  } satisfies Pick<WorkspaceRegistry, "update">;
  const autoName = new WorkspaceAutoName({
    agentManager: {} as AgentManager,
    agentStorage: { listByWorkspace: async () => [] },
    workspaceRegistry,
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => updateEmitted.resolve(),
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({ title: "generated", branch: null }),
  });

  autoName.scheduleForDirectory({
    workspaceId: workspace.workspaceId,
    cwd: workspace.cwd,
    firstAgentContext: { prompt: "Name this workspace" },
  });
  await mutationStarted.promise;
  const archivedAt = "2026-08-08T00:01:00.000Z";
  workspace = { ...workspace, updatedAt: archivedAt, archivedAt };
  allowMutation.resolve();
  await updateEmitted.promise;

  expect(workspace).toMatchObject({
    title: "generated",
    archivedAt,
  });
});

interface TitleHarnessAgent {
  id: string;
  title: string | null;
  internal?: boolean;
  archivedAt?: string;
}

function createTitleHarness(input: {
  workspaceTitle: string | null;
  agents: TitleHarnessAgent[];
  kind?: "directory" | "worktree" | "local_checkout";
}) {
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-title-sync",
    projectId: "project-title-sync",
    cwd: "/workspace",
    kind: input.kind ?? "directory",
    displayName: "workspace",
    title: input.workspaceTitle,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const agentTitles = new Map(input.agents.map((agent) => [agent.id, agent.title]));
  const emitted = deferred();
  const agentManager = {
    getAgent: (id: string) => (agentTitles.has(id) ? { id } : null),
    setTitle: async (id: string, title: string) => {
      agentTitles.set(id, title);
    },
  } as unknown as AgentManager;
  const autoName = new WorkspaceAutoName({
    agentManager,
    agentStorage: {
      listByWorkspace: async () =>
        input.agents.map(
          (agent) =>
            ({
              id: agent.id,
              title: agentTitles.get(agent.id) ?? null,
              internal: agent.internal,
              archivedAt: agent.archivedAt ?? null,
            }) as StoredAgentRecord,
        ),
    },
    workspaceRegistry: {
      update: async (_workspaceId, updater) => {
        workspace = updater(workspace);
        return workspace;
      },
    },
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => emitted.resolve(),
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({ title: "Summarize release status", branch: null }),
  });

  async function generate(prompt: string): Promise<void> {
    autoName.scheduleForDirectory({
      workspaceId: workspace.workspaceId,
      cwd: workspace.cwd,
      firstAgentContext: { prompt },
    });
    await emitted.promise;
  }

  return {
    autoName,
    generate,
    workspaceTitle: () => workspace.title,
    agentTitle: (id: string) => agentTitles.get(id) ?? null,
    workspaceId: workspace.workspaceId,
  };
}

const PROMPT = "where are we with the release work?";

describe("single-agent workspaces share one name with their agent", () => {
  test("the generated title also renames an agent still named after its prompt", async () => {
    const harness = createTitleHarness({
      workspaceTitle: PROMPT,
      agents: [{ id: "agent-1", title: PROMPT }],
    });

    await harness.generate(PROMPT);

    expect(harness.workspaceTitle()).toBe("Summarize release status");
    expect(harness.agentTitle("agent-1")).toBe("Summarize release status");
  });

  test("an explicitly titled agent names the workspace instead of the generated title", async () => {
    const harness = createTitleHarness({
      workspaceTitle: PROMPT,
      agents: [{ id: "agent-1", title: "Fix: login redirect" }],
    });

    await harness.generate(PROMPT);

    expect(harness.workspaceTitle()).toBe("Fix: login redirect");
    expect(harness.agentTitle("agent-1")).toBe("Fix: login redirect");
  });

  test("a workspace title set by hand is kept and the prompt-named agent follows it", async () => {
    const harness = createTitleHarness({
      workspaceTitle: "Release",
      agents: [{ id: "agent-1", title: PROMPT }],
    });

    await harness.generate(PROMPT);

    expect(harness.workspaceTitle()).toBe("Release");
    expect(harness.agentTitle("agent-1")).toBe("Release");
  });

  test("agents in a workspace with several agents keep their own titles", async () => {
    const harness = createTitleHarness({
      workspaceTitle: PROMPT,
      agents: [
        { id: "agent-1", title: PROMPT },
        { id: "agent-2", title: "Reviewer" },
      ],
    });

    await harness.generate(PROMPT);

    expect(harness.workspaceTitle()).toBe("Summarize release status");
    expect(harness.agentTitle("agent-1")).toBe(PROMPT);
  });

  test("internal agents don't count as a second agent", async () => {
    const harness = createTitleHarness({
      workspaceTitle: PROMPT,
      agents: [
        { id: "agent-1", title: PROMPT },
        { id: "helper", title: "internal helper", internal: true },
      ],
    });

    await harness.generate(PROMPT);

    expect(harness.agentTitle("agent-1")).toBe("Summarize release status");
  });

  test("an untitled workspace adopts its first agent's explicit title", async () => {
    const harness = createTitleHarness({
      workspaceTitle: null,
      agents: [{ id: "agent-1", title: "Fix: login redirect" }],
    });

    await harness.autoName.adoptFirstAgentTitle({
      workspaceId: harness.workspaceId,
      agentId: "agent-1",
      title: "Fix: login redirect",
      promptTitle: null,
    });

    expect(harness.workspaceTitle()).toBe("Fix: login redirect");
  });

  test("a workspace still named after the prompt adopts the explicit agent title", async () => {
    const harness = createTitleHarness({
      workspaceTitle: PROMPT,
      agents: [{ id: "agent-1", title: "Fix: login redirect" }],
    });

    await harness.autoName.adoptFirstAgentTitle({
      workspaceId: harness.workspaceId,
      agentId: "agent-1",
      title: "Fix: login redirect",
      promptTitle: PROMPT,
    });

    expect(harness.workspaceTitle()).toBe("Fix: login redirect");
  });

  test("adopting never overwrites a workspace title set by hand", async () => {
    const harness = createTitleHarness({
      workspaceTitle: "Release",
      agents: [{ id: "agent-1", title: "Fix: login redirect" }],
    });

    await harness.autoName.adoptFirstAgentTitle({
      workspaceId: harness.workspaceId,
      agentId: "agent-1",
      title: "Fix: login redirect",
      promptTitle: PROMPT,
    });

    expect(harness.workspaceTitle()).toBe("Release");
  });

  test("a workspace that already has another agent keeps its title", async () => {
    const harness = createTitleHarness({
      workspaceTitle: null,
      agents: [
        { id: "agent-0", title: "Planner" },
        { id: "agent-1", title: "Fix: login redirect" },
      ],
    });

    await harness.autoName.adoptFirstAgentTitle({
      workspaceId: harness.workspaceId,
      agentId: "agent-1",
      title: "Fix: login redirect",
      promptTitle: null,
    });

    expect(harness.workspaceTitle()).toBeNull();
  });

  test("an archived agent doesn't stop the remaining agent from following the workspace", async () => {
    const harness = createTitleHarness({
      workspaceTitle: PROMPT,
      agents: [
        { id: "agent-old", title: "Earlier run", archivedAt: "2026-08-07T00:00:00.000Z" },
        { id: "agent-1", title: PROMPT },
      ],
    });

    await harness.generate(PROMPT);

    expect(harness.agentTitle("agent-1")).toBe("Summarize release status");
  });

  test("a workspace that has had agents before is not renamed by a new one", async () => {
    const harness = createTitleHarness({
      workspaceTitle: null,
      kind: "worktree",
      agents: [
        { id: "agent-old", title: "Earlier run", archivedAt: "2026-08-07T00:00:00.000Z" },
        { id: "agent-1", title: "lint sweep" },
      ],
    });

    await harness.autoName.adoptFirstAgentTitle({
      workspaceId: harness.workspaceId,
      agentId: "agent-1",
      title: "lint sweep",
      promptTitle: null,
    });

    expect(harness.workspaceTitle()).toBeNull();
  });

  test("a project's main checkout is never renamed after an agent", async () => {
    const harness = createTitleHarness({
      workspaceTitle: null,
      kind: "local_checkout",
      agents: [{ id: "agent-1", title: "lint sweep" }],
    });

    await harness.autoName.adoptFirstAgentTitle({
      workspaceId: harness.workspaceId,
      agentId: "agent-1",
      title: "lint sweep",
      promptTitle: null,
    });

    expect(harness.workspaceTitle()).toBeNull();
  });
});

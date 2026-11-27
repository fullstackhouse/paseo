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
});

describe("new chats are titled per the Chat titles setting", () => {
  function createChatTitleHarness() {
    const calls: string[] = [];
    const settled = deferred();
    const agentManager = {
      followProviderTitle: async (agentId: string) => {
        calls.push(`follow ${agentId}`);
        return true;
      },
      replaceAutomaticTitle: async (agentId: string, expected: string, title: string) => {
        calls.push(`title ${agentId}: ${expected} -> ${title}`);
        settled.resolve();
        return true;
      },
    } as unknown as AgentManager;
    const prompts: Array<string | undefined> = [];
    const autoName = new WorkspaceAutoName({
      agentManager,
      agentStorage: { listByWorkspace: async () => [] },
      workspaceRegistry: { update: async () => null },
      workspaceGitService: {} as WorkspaceGitService,
      providerSnapshotManager: {} as ProviderSnapshotManager,
      readDaemonConfig: () => ({}),
      gitMutation: { notifyGitMutation: async () => {} },
      emitWorkspaceUpdateForCwd: async () => {},
      emitWorkspaceUpdateForWorkspaceId: async () => {},
      logger: pino({ level: "silent" }),
      generateWorkspaceName: async (options) => {
        prompts.push(options.firstAgentContext?.prompt);
        return { title: "Summarize release status", branch: "summarize-release-status" };
      },
    });

    function schedule(mode: "first-prompt" | "generated" | "agent"): void {
      autoName.scheduleForChat({
        agentId: "agent-1",
        cwd: "/workspace",
        mode,
        provisionalTitle: PROMPT,
        firstAgentContext: { prompt: PROMPT },
      });
    }

    return { schedule, settled: settled.promise, calls, prompts };
  }

  test("generated titles the chat once from its first prompt", async () => {
    const harness = createChatTitleHarness();

    harness.schedule("generated");
    await harness.settled;

    expect(harness.prompts).toEqual([PROMPT]);
    expect(harness.calls).toEqual([`title agent-1: ${PROMPT} -> Summarize release status`]);
  });

  test("from the agent follows the agent's title and shows a generated one until it lands", async () => {
    const harness = createChatTitleHarness();

    harness.schedule("agent");
    await harness.settled;

    expect(harness.prompts).toEqual([PROMPT]);
    expect(harness.calls).toEqual([
      "follow agent-1",
      `title agent-1: ${PROMPT} -> Summarize release status`,
    ]);
  });

  test("first prompt leaves the chat's first-prompt title alone", async () => {
    const harness = createChatTitleHarness();

    harness.schedule("first-prompt");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(harness.prompts).toEqual([]);
    expect(harness.calls).toEqual([]);
  });
});

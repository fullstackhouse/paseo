import type pino from "pino";
import type { ChatTitleMode, FirstAgentContext } from "@getpaseo/protocol/messages";

import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type { StructuredGenerationDaemonConfig } from "./agent/structured-generation-providers.js";
import {
  attemptFirstAgentBranchAutoName,
  type AttemptFirstAgentBranchAutoNameResult,
} from "./paseo-worktree-service.js";
import type { GitMutationService } from "./session/git-mutation/git-mutation-service.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "./workspace-registry.js";
import {
  generateBranchNameFromFirstAgentContext,
  type GeneratedWorkspaceName,
  type GenerateBranchNameFromFirstAgentContextOptions,
} from "./worktree-branch-name-generator.js";

type WorkspaceNameGenerator = typeof generateBranchNameFromFirstAgentContext;

const SHARED_GENERATION_TTL_MS = 60_000;

type CurrentSelection = GenerateBranchNameFromFirstAgentContextOptions["currentSelection"] | null;

interface WorkspaceAutoNameOptions {
  agentManager: AgentManager;
  agentStorage: Pick<AgentStorage, "listByWorkspace">;
  workspaceRegistry: Pick<WorkspaceRegistry, "update">;
  workspaceGitService: WorkspaceGitService;
  providerSnapshotManager: ProviderSnapshotManager;
  readDaemonConfig: () => StructuredGenerationDaemonConfig;
  gitMutation: Pick<GitMutationService, "notifyGitMutation">;
  emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
  emitWorkspaceUpdateForWorkspaceId: (workspaceId: string) => Promise<void>;
  logger: pino.Logger;
  generateWorkspaceName?: WorkspaceNameGenerator;
}

interface ScheduleContext {
  currentSelection?: CurrentSelection;
}

export class WorkspaceAutoName {
  private readonly agentManager: AgentManager;
  private readonly agentStorage: Pick<AgentStorage, "listByWorkspace">;
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "update">;
  private readonly workspaceGitService: WorkspaceGitService;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly readDaemonConfig: () => StructuredGenerationDaemonConfig;
  private readonly gitMutation: Pick<GitMutationService, "notifyGitMutation">;
  private readonly emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
  private readonly emitWorkspaceUpdateForWorkspaceId: (workspaceId: string) => Promise<void>;
  private readonly logger: pino.Logger;
  private readonly generateWorkspaceName: WorkspaceNameGenerator;
  private readonly recentGenerations = new Map<string, Promise<GeneratedWorkspaceName | null>>();

  constructor(options: WorkspaceAutoNameOptions) {
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.workspaceRegistry = options.workspaceRegistry;
    this.workspaceGitService = options.workspaceGitService;
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.readDaemonConfig = options.readDaemonConfig;
    this.gitMutation = options.gitMutation;
    this.emitWorkspaceUpdateForCwd = options.emitWorkspaceUpdateForCwd;
    this.emitWorkspaceUpdateForWorkspaceId = options.emitWorkspaceUpdateForWorkspaceId;
    this.logger = options.logger;
    this.generateWorkspaceName =
      options.generateWorkspaceName ?? generateBranchNameFromFirstAgentContext;
  }

  scheduleForWorktree(
    input: {
      workspace: PersistedWorkspaceRecord;
      firstAgentContext: FirstAgentContext;
    },
    context: ScheduleContext = {},
  ): void {
    this.schedule(
      () =>
        this.maybeAutoNameWorkspaceBranchForFirstAgent({
          ...input,
          currentSelection: context.currentSelection ?? null,
        }),
      {
        cwd: input.workspace.cwd,
        message: "Failed to auto-name worktree branch",
      },
    );
  }

  scheduleForDirectory(
    input: {
      workspaceId: string;
      cwd: string;
      firstAgentContext: FirstAgentContext;
    },
    context: ScheduleContext = {},
  ): void {
    this.schedule(
      () =>
        this.maybeAutoNameDirectoryWorkspaceTitle({
          ...input,
          currentSelection: context.currentSelection ?? null,
        }),
      { cwd: input.cwd, message: "Failed to auto-name directory workspace title" },
    );
  }

  /**
   * FSH: titles a new chat per the host's "Chat titles" setting. "agent" follows the provider
   * session's own title where the provider keeps one and otherwise generates once, like
   * "generated". A generated title lands only while the chat still has its first-prompt title.
   */
  scheduleForChat(
    input: {
      agentId: string;
      cwd: string;
      mode: ChatTitleMode;
      provisionalTitle: string;
      firstAgentContext: FirstAgentContext;
    },
    context: ScheduleContext = {},
  ): void {
    if (input.mode === "first-prompt") return;
    this.schedule(
      () => this.autoTitleChat({ ...input, currentSelection: context.currentSelection ?? null }),
      { cwd: input.cwd, message: "Failed to auto-title chat" },
    );
  }

  private async autoTitleChat(input: {
    agentId: string;
    cwd: string;
    mode: ChatTitleMode;
    provisionalTitle: string;
    firstAgentContext: FirstAgentContext;
    currentSelection: CurrentSelection;
  }): Promise<void> {
    // From the agent still generates: a Claude binary that writes no ai-title in SDK sessions
    // would otherwise leave the long first-prompt title. Whichever automatic title lands first
    // stays only until the agent names its session.
    if (input.mode === "agent") await this.agentManager.followProviderTitle(input.agentId);
    const generated = await this.generateFromContext({
      cwd: input.cwd,
      firstAgentContext: input.firstAgentContext,
      currentSelection: input.currentSelection,
    });
    const title = generated?.title?.trim();
    if (!title) return;
    await this.agentManager.replaceAutomaticTitle(input.agentId, input.provisionalTitle, title);
  }

  private async maybeAutoNameWorkspaceBranchForFirstAgent(input: {
    workspace: PersistedWorkspaceRecord;
    firstAgentContext: FirstAgentContext;
    currentSelection: CurrentSelection;
  }): Promise<void> {
    const worktreeRoot = input.workspace.worktreeRoot ?? input.workspace.cwd;
    let generated: GeneratedWorkspaceName | null = null;
    const result: AttemptFirstAgentBranchAutoNameResult = await attemptFirstAgentBranchAutoName({
      cwd: worktreeRoot,
      firstAgentContext: input.firstAgentContext,
      generateBranchNameFromContext: ({ firstAgentContext }) => {
        return this.generateFromContext({
          cwd: input.workspace.cwd,
          firstAgentContext,
          currentSelection: input.currentSelection,
        }).then((nextGenerated) => {
          generated = nextGenerated;
          return nextGenerated?.branch ?? null;
        });
      },
    });

    if (!generated) {
      generated = await this.generateFromContext({
        cwd: input.workspace.cwd,
        firstAgentContext: input.firstAgentContext,
        currentSelection: input.currentSelection,
      });
    }
    const generatedTitle = generated?.title ?? null;
    if (!generatedTitle) {
      return;
    }

    // K4: re-read from the registry before writing so any concurrent upsert
    // that happened between workspace creation and this async path is not clobbered.
    // When the first-agent rename changed the git branch too, persist that branch
    // alongside the title — both are this path's own fields.
    await this.applyGeneratedWorkspaceTitle(input.workspace.workspaceId, {
      title: generatedTitle,
      ...(result.renamed ? { branch: result.branchName } : {}),
      promptTitle: resolveFirstAgentPromptTitle(input.firstAgentContext),
    });
    if (result.renamed) {
      await this.gitMutation.notifyGitMutation(worktreeRoot, "rename-branch");
    }
    await this.emitWorkspaceUpdateForCwd(input.workspace.cwd);
  }

  private async maybeAutoNameDirectoryWorkspaceTitle(input: {
    workspaceId: string;
    cwd: string;
    firstAgentContext: FirstAgentContext;
    currentSelection: CurrentSelection;
  }): Promise<void> {
    const generated = await this.generateFromContext({
      cwd: input.cwd,
      firstAgentContext: input.firstAgentContext,
      currentSelection: input.currentSelection,
    });
    const title = generated?.title ?? null;
    if (!title) {
      return;
    }
    // K4: applyGeneratedWorkspaceTitle re-reads from the registry before writing.
    // Directory workspaces have no branch — write only the title.
    await this.applyGeneratedWorkspaceTitle(input.workspaceId, {
      title,
      promptTitle: resolveFirstAgentPromptTitle(input.firstAgentContext),
    });
    await this.emitWorkspaceUpdateForWorkspaceId(input.workspaceId);
  }

  /**
   * Writes the generated title and keeps a single-agent workspace and its agent
   * on one name: an agent that still has its prompt-derived title takes the
   * workspace's title; an agent named explicitly names the workspace instead.
   * Titles set by hand are never overwritten.
   */
  private async applyGeneratedWorkspaceTitle(
    workspaceId: string,
    input: { title: string; branch?: string | null; promptTitle?: string | null },
  ): Promise<void> {
    const promptTitle = input.promptTitle ?? null;
    const agents = await this.listWorkspaceAgents(workspaceId);
    const soleAgent = agents.length === 1 ? agents[0] : null;
    const agentHasOwnTitle = Boolean(soleAgent?.title && soleAgent.title !== promptTitle);
    const candidateTitle = agentHasOwnTitle && soleAgent?.title ? soleAgent.title : input.title;

    const updated = await this.workspaceRegistry.update(workspaceId, (current) => {
      const title = isReplaceableWorkspaceTitle(current.title, promptTitle)
        ? candidateTitle
        : current.title;
      return {
        ...current,
        title,
        ...(input.branch ? { branch: input.branch } : {}),
        updatedAt: new Date().toISOString(),
      };
    });

    const workspaceTitle = updated?.title ?? null;
    if (
      !soleAgent ||
      agentHasOwnTitle ||
      !workspaceTitle ||
      soleAgent.title === workspaceTitle ||
      !this.agentManager.getAgent(soleAgent.id)
    ) {
      return;
    }
    await this.agentManager.setTitle(soleAgent.id, workspaceTitle);
  }

  private async listWorkspaceAgents(workspaceId: string): Promise<StoredAgentRecord[]> {
    const records = await this.agentStorage.listByWorkspace(workspaceId);
    return records.filter((record) => !record.internal && !record.archivedAt);
  }

  /**
   * A new workspace and its first chat both title themselves from the same prompt, so the two jobs
   * share one model call: a result is reused for a minute per working directory and prompt.
   */
  private generateFromContext(input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
    currentSelection: CurrentSelection;
  }): Promise<GeneratedWorkspaceName | null> {
    const key = `${input.cwd}\0${JSON.stringify(input.firstAgentContext)}`;
    const shared = this.recentGenerations.get(key);
    if (shared) return shared;
    const generation = this.callGenerator(input);
    this.recentGenerations.set(key, generation);
    const forget = () => {
      if (this.recentGenerations.get(key) === generation) this.recentGenerations.delete(key);
    };
    generation.catch(forget);
    setTimeout(forget, SHARED_GENERATION_TTL_MS).unref();
    return generation;
  }

  private callGenerator(input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
    currentSelection: CurrentSelection;
  }): Promise<GeneratedWorkspaceName | null> {
    return this.generateWorkspaceName({
      agentManager: this.agentManager,
      cwd: input.cwd,
      workspaceGitService: this.workspaceGitService,
      providerSnapshotManager: this.providerSnapshotManager,
      daemonConfig: this.readDaemonConfig(),
      currentSelection: input.currentSelection ?? undefined,
      firstAgentContext: input.firstAgentContext,
      logger: this.logger,
    });
  }

  private schedule(run: () => Promise<void>, context: { cwd: string; message: string }): void {
    setTimeout(() => {
      void run().catch((error) => {
        this.logger.warn({ err: error, cwd: context.cwd }, context.message);
      });
    }, 0);
  }
}

function isReplaceableWorkspaceTitle(
  title: string | null | undefined,
  promptTitle: string | null | undefined,
): boolean {
  return !title || (Boolean(promptTitle) && title === promptTitle);
}

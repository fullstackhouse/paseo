import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { resolveRepositoryDefaultBranch } from "../../../utils/checkout-git.js";
import { createRealpathAwarePathMatcher } from "../../../utils/path.js";
import { runGitCommand } from "../../../utils/run-git-command.js";
import {
  createWorktree,
  isPaseoOwnedWorktreeCwd,
  mapWorkspaceCwdToWorktree,
  rollbackCreatedPaseoWorktree,
  runPluginWorktreeManagerCheckout,
  type WorktreeSource,
} from "../../../utils/worktree.js";
import type { PluginWorktreeManagerRuntime } from "../../plugins/runtime.js";
import type { PluginWorktreeRestoreTarget } from "@getpaseo/plugin/server";
import { waitForPendingWorktreeRemoval } from "../../../utils/worktree-removal-queue.js";
import { WorktreeRequestError, toWorktreeRequestError } from "../../worktree-errors.js";
import {
  resolveWorkspaceDisplayName,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
} from "../../workspace-registry.js";

// FSH: "recreate" makes an empty folder at the workspace's path. It is never offered as the
// recovery: the caller asks for it from an unavailable state that allows it.
export type WorkspaceRecoveryAction = "unarchive" | "restore" | "recreate";

export type WorkspaceRecoveryState =
  | {
      kind: "recoverable";
      workspaceId: string;
      workspaceName: string;
      action: Exclude<WorkspaceRecoveryAction, "recreate">;
      branch: string | null;
    }
  | {
      kind: "unavailable";
      workspaceId: string;
      reason:
        | "workspace_not_found"
        | "workspace_not_archived"
        | "project_not_found"
        | "project_directory_missing"
        | "workspace_directory_missing"
        | "worktree_branch_missing";
      message: string;
      // FSH: an empty folder can be made at the workspace's path so its agents open again. Git
      // can't rebuild the files, and the source may only be on a drive that isn't connected right
      // now, so this waits for an explicit request.
      canRecreate: boolean;
    };

export interface WorkspaceRecoveryService {
  inspect(workspaceId: string): Promise<WorkspaceRecoveryState>;
  restore(
    workspaceId: string,
    options?: { recreate?: boolean },
  ): Promise<{ workspaceId: string; action: WorkspaceRecoveryAction }>;
}

type RecoveryPlan =
  | {
      kind: "unarchive";
      state: Extract<WorkspaceRecoveryState, { kind: "recoverable" }>;
      workspace: PersistedWorkspaceRecord;
    }
  | {
      kind: "restore";
      state: Extract<WorkspaceRecoveryState, { kind: "recoverable" }>;
      workspace: PersistedWorkspaceRecord;
      sourceRepoRoot: string;
      /** FSH: git proves the saved branch is gone; restore it as a new branch from the base. */
      branchGone: boolean;
    };

type UnavailableRecoveryState = Extract<WorkspaceRecoveryState, { kind: "unavailable" }>;

export function createWorkspaceRecoveryService(deps: {
  paseoHome: string;
  worktreesRoot?: string;
  worktreeManagers?: Pick<
    PluginWorktreeManagerRuntime,
    "hasWorktreeManager" | "restoreWorktree" | "removeWorktree"
  >;
  getWorkspace: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
  getProject: (projectId: string) => Promise<PersistedProjectRecord | null>;
  isDirectory: (path: string) => Promise<boolean>;
  unarchiveWorkspace: (workspace: PersistedWorkspaceRecord) => Promise<void>;
  isCheckoutUntrusted?: (checkoutPath: string) => Promise<boolean>;
  syncCheckoutWorktreeManager?: (input: {
    worktreeRoot: string;
    worktreeManagerPluginId: string | null;
    excludeWorkspaceId: string;
  }) => Promise<void>;
}): WorkspaceRecoveryService {
  async function resolveRecovery(
    workspaceId: string,
  ): Promise<UnavailableRecoveryState | RecoveryPlan> {
    const workspace = await deps.getWorkspace(workspaceId);
    if (!workspace) {
      return {
        kind: "unavailable",
        workspaceId,
        reason: "workspace_not_found",
        message: "This workspace is no longer known to the host.",
        canRecreate: false,
      };
    }
    if (!workspace.archivedAt) {
      return {
        kind: "unavailable",
        workspaceId,
        reason: "workspace_not_archived",
        message: "This workspace is not archived, but it is unavailable from the host.",
        canRecreate: false,
      };
    }

    const project = await deps.getProject(workspace.projectId);
    if (!project) {
      return {
        kind: "unavailable",
        workspaceId,
        reason: "project_not_found",
        message: "The project for this archived workspace no longer exists.",
        canRecreate: false,
      };
    }

    // FSH: an archive replies before its worktree removal finishes. Settle it first so an
    // unarchive never adopts a directory that is about to be deleted.
    await waitForPendingWorktreeRemoval(workspace.worktreeRoot ?? workspace.cwd);
    if (await deps.isDirectory(workspace.cwd)) {
      return createRecoveryPlan({ action: "unarchive", workspace });
    }

    // FSH: a worktree record can lose its worktree fields (reconciliation once rewrote archived
    // worktrees as plain folders), so a Paseo-owned path in a git project also counts.
    const isWorktree =
      workspace.kind === "worktree" ||
      (project.kind === "git" &&
        (
          await isPaseoOwnedWorktreeCwd(workspace.cwd, {
            paseoHome: deps.paseoHome,
            worktreesRoot: deps.worktreesRoot,
          })
        ).allowed);
    if (!isWorktree) {
      // FSH: an empty folder is offered only for a plain folder, and only while the folder that
      // contained it exists: a missing parent usually means an unmounted drive, and creating the
      // path would write onto the wrong disk. Worktrees never get one, since unarchiving an empty
      // folder would erase their branch and source repository link.
      return {
        kind: "unavailable",
        workspaceId,
        reason: "workspace_directory_missing",
        message: "The archived workspace folder no longer exists, and git can't restore it.",
        canRecreate: await deps.isDirectory(dirname(workspace.cwd)),
      };
    }
    // COMPAT(worktreeRestoreMissingMainRepoRoot): records created before v0.1.110
    // lack placement ownership; remove the project-root fallback after 2027-01-17.
    const sourceRepoRoot = workspace.mainRepoRoot ?? project.rootPath;
    if (!(await deps.isDirectory(sourceRepoRoot))) {
      return {
        kind: "unavailable",
        workspaceId,
        reason: "project_directory_missing",
        message: "The source repository needed to restore this worktree no longer exists.",
        canRecreate: false,
      };
    }

    // FSH: a branch that git proves is gone (deleted after its PR merged) is restored as a new
    // branch of the same name from the base. Anything less certain keeps the saved branch.
    const checkout = parseWorkspaceHead(workspace);
    const branchGone =
      checkout.kind === "branch" && (await isBranchGone(sourceRepoRoot, checkout.branch));
    return createRecoveryPlan({ action: "restore", workspace, sourceRepoRoot, branchGone });
  }

  async function inspect(workspaceId: string): Promise<WorkspaceRecoveryState> {
    const resolved = await resolveRecovery(workspaceId);
    return resolved.kind === "unavailable" ? resolved : resolved.state;
  }

  async function restore(
    workspaceId: string,
    options?: { recreate?: boolean },
  ): Promise<{ workspaceId: string; action: WorkspaceRecoveryAction }> {
    const resolved = await resolveRecovery(workspaceId);
    if (resolved.kind === "unavailable") {
      const workspace = resolved.canRecreate ? await deps.getWorkspace(workspaceId) : null;
      if (!options?.recreate || !workspace) {
        throw new Error(resolved.message);
      }
      await mkdir(workspace.cwd);
      await deps.unarchiveWorkspace(workspace);
      return { workspaceId, action: "recreate" };
    }

    let workspaceToUnarchive = resolved.workspace;
    let recreated: { worktreePath: string; pluginId: string | null } | null = null;
    if (resolved.kind === "restore") {
      recreated = await recreateArchivedWorktree(
        resolved.workspace,
        resolved.sourceRepoRoot,
        resolved.branchGone,
      );
      if ((resolved.workspace.worktreeManagerPluginId ?? null) !== recreated.pluginId) {
        const { worktreeManagerPluginId: _previous, ...withoutManager } = resolved.workspace;
        workspaceToUnarchive = recreated.pluginId
          ? { ...withoutManager, worktreeManagerPluginId: recreated.pluginId }
          : withoutManager;
      }
    }
    await deps.unarchiveWorkspace(workspaceToUnarchive);
    if (recreated) {
      await deps.syncCheckoutWorktreeManager?.({
        worktreeRoot: recreated.worktreePath,
        worktreeManagerPluginId: recreated.pluginId,
        excludeWorkspaceId: workspaceId,
      });
    }
    return { workspaceId, action: resolved.kind };
  }

  async function recreateArchivedWorktree(
    workspace: PersistedWorkspaceRecord,
    sourceRepoRoot: string,
    branchGone: boolean,
  ): Promise<{ worktreePath: string; pluginId: string | null }> {
    let source: WorktreeSource;
    const checkout = parseWorkspaceHead(workspace);
    if (checkout.kind === "branch" && branchGone) {
      source = {
        kind: "restore-from-base",
        // Reuse a deleted branch's name, so the restored workspace reads the same.
        branchName: checkout.branch,
        baseRef: await resolveRecoveryBase(sourceRepoRoot, workspace.baseBranch),
      };
    } else if (checkout.kind === "branch") {
      source = {
        kind: "restore",
        branchName: checkout.branch,
        baseRef: workspace.baseBranch,
      };
    } else if (checkout.kind === "commit") {
      source = {
        kind: "restore-commit",
        commit: checkout.commit,
        baseRef: await resolveRecoveryBase(sourceRepoRoot, workspace.baseBranch),
      };
    } else {
      source = {
        kind: "restore-from-base",
        branchName: `restored/${randomUUID().slice(0, 8)}`,
        baseRef: await resolveRecoveryBase(sourceRepoRoot, workspace.baseBranch),
      };
    }

    try {
      await runGitCommand(["worktree", "prune"], { cwd: sourceRepoRoot, timeout: 30_000 });
    } catch {
      // A stale worktree registration is not guaranteed; creation reports any real conflict.
    }

    let previousWorktreePath = workspace.worktreeRoot;
    let hasRecordedWorktreePath = Boolean(previousWorktreePath);
    if (!previousWorktreePath) {
      // COMPAT(worktreeRestoreMissingWorktreeRoot): records created before v0.1.110
      // lack durable backing placement; remove filesystem discovery after 2027-01-17.
      const ownership = await isPaseoOwnedWorktreeCwd(workspace.cwd, {
        paseoHome: deps.paseoHome,
        worktreesRoot: deps.worktreesRoot,
      });
      previousWorktreePath = ownership.allowed
        ? (ownership.worktreePath ?? workspace.cwd)
        : workspace.cwd;
      hasRecordedWorktreePath = ownership.allowed;
    }

    const untrusted =
      Boolean(workspace.untrustedSource) ||
      Boolean(await deps.isCheckoutUntrusted?.(previousWorktreePath));
    let recreatedWorktreePath: string;
    let restoredByPluginId: string | null = null;
    try {
      const restored = await recreateWorktreeCheckout({
        workspace,
        sourceRepoRoot,
        source,
        previousWorktreePath,
        hasRecordedWorktreePath,
        untrusted,
      });
      recreatedWorktreePath = restored.worktreePath;
      restoredByPluginId = restored.pluginId;
    } catch (error) {
      throw toWorktreeRequestError(error);
    }

    try {
      const recreatedWorkspacePath = mapWorkspaceCwdToWorktree({
        sourceWorktreePath: previousWorktreePath,
        workspaceCwd: workspace.cwd,
        targetWorktreePath: recreatedWorktreePath,
      });
      if (!createRealpathAwarePathMatcher(workspace.cwd)(recreatedWorkspacePath)) {
        throw new WorktreeRequestError({
          code: "unknown",
          message: `Recreated worktree diverged from ${workspace.cwd}: ${recreatedWorkspacePath}`,
        });
      }
      if (!(await deps.isDirectory(recreatedWorkspacePath))) {
        throw new WorktreeRequestError({
          code: "unknown",
          message: `Selected project directory is missing from the restored worktree: ${recreatedWorkspacePath}`,
        });
      }
    } catch (error) {
      return rollbackCreatedPaseoWorktree(
        {
          cwd: sourceRepoRoot,
          worktreePath: recreatedWorktreePath,
          teardownCwds: [],
          paseoHome: deps.paseoHome,
          worktreesBaseRoot: deps.worktreesRoot,
          worktreeManagers: deps.worktreeManagers,
          worktreeManagerPluginId: restoredByPluginId,
          removeReason: "rollback",
          untrusted,
        },
        error,
      );
    }
    return { worktreePath: recreatedWorktreePath, pluginId: restoredByPluginId };
  }

  async function recreateWorktreeCheckout(options: {
    workspace: PersistedWorkspaceRecord;
    sourceRepoRoot: string;
    source: Extract<WorktreeSource, { kind: "restore" | "restore-commit" | "restore-from-base" }>;
    previousWorktreePath: string;
    hasRecordedWorktreePath: boolean;
    untrusted: boolean;
  }): Promise<{ worktreePath: string; pluginId: string | null }> {
    const {
      workspace,
      sourceRepoRoot,
      source,
      previousWorktreePath,
      hasRecordedWorktreePath,
      untrusted,
    } = options;
    const managerPluginId = workspace.worktreeManagerPluginId;
    if (managerPluginId && hasRecordedWorktreePath && deps.worktreeManagers) {
      const adopted = await runPluginWorktreeManagerCheckout({
        cwd: sourceRepoRoot,
        source,
        operation: "restore",
        preferredPluginId: managerPluginId,
        untrusted,
        paseoHome: deps.paseoHome,
        worktreesBaseRoot: deps.worktreesRoot,
        worktreeManagers: deps.worktreeManagers,
        run: () =>
          deps.worktreeManagers!.restoreWorktree(
            {
              repoRoot: sourceRepoRoot,
              path: previousWorktreePath,
              target: restoreTargetFromWorktreeSource(source),
              baseRef: workspace.baseBranch,
              untrusted,
            },
            { preferredPluginId: managerPluginId },
          ),
        verifyValidatedPath: (validatedPath, pluginId) => {
          if (!createRealpathAwarePathMatcher(previousWorktreePath)(validatedPath)) {
            throw new WorktreeRequestError({
              code: "unknown",
              message: `Plugin ${pluginId} restored worktree to ${validatedPath}, expected ${previousWorktreePath}`,
            });
          }
        },
      });
      if (adopted) {
        return {
          worktreePath: adopted.worktreePath,
          pluginId: adopted.worktreeManagerPluginId ?? managerPluginId,
        };
      }
    }

    const result = await createWorktree({
      cwd: sourceRepoRoot,
      worktreeSlug: basename(previousWorktreePath),
      source,
      paseoHome: deps.paseoHome,
      worktreesRoot: deps.worktreesRoot,
      ...(hasRecordedWorktreePath ? { worktreePath: previousWorktreePath } : {}),
    });
    return { worktreePath: result.worktreePath, pluginId: null };
  }

  return { inspect, restore };
}

function restoreTargetFromWorktreeSource(
  source: Extract<WorktreeSource, { kind: "restore" | "restore-commit" | "restore-from-base" }>,
): PluginWorktreeRestoreTarget {
  if (source.kind === "restore") {
    return { type: "branch", branch: source.branchName };
  }
  if (source.kind === "restore-commit") {
    return { type: "commit", commit: source.commit };
  }
  return { type: "from-base", branch: source.branchName, baseRef: source.baseRef };
}

async function resolveRecoveryBase(repoRoot: string, recordedBase: string | null): Promise<string> {
  if (recordedBase) {
    try {
      await runGitCommand(["rev-parse", "--verify", `${recordedBase}^{commit}`], { cwd: repoRoot });
      return recordedBase;
    } catch {
      // The saved base was removed; use the repository default for continued work.
    }
  }
  const defaultBranch = await resolveRepositoryDefaultBranch(repoRoot);
  if (!defaultBranch) {
    throw new WorktreeRequestError({
      code: "unknown",
      message:
        "The saved base is unavailable and the repository has no default branch to restore from.",
    });
  }
  return defaultBranch;
}

function parseWorkspaceHead(
  workspace: PersistedWorkspaceRecord,
): { kind: "branch"; branch: string } | { kind: "commit"; commit: string } | { kind: "missing" } {
  if (workspace.head) {
    const prefix = "refs/heads/";
    return workspace.head.startsWith(prefix)
      ? { kind: "branch", branch: workspace.head.slice(prefix.length) }
      : { kind: "commit", commit: workspace.head };
  }
  return workspace.branch ? { kind: "branch", branch: workspace.branch } : { kind: "missing" };
}

function createRecoveryPlan(
  input:
    | { action: "unarchive"; workspace: PersistedWorkspaceRecord }
    | {
        action: "restore";
        workspace: PersistedWorkspaceRecord;
        sourceRepoRoot: string;
        branchGone: boolean;
      },
): RecoveryPlan {
  const checkout = parseWorkspaceHead(input.workspace);
  const branchGone = input.action === "restore" && input.branchGone;
  const state = {
    kind: "recoverable" as const,
    workspaceId: input.workspace.workspaceId,
    workspaceName: resolveWorkspaceDisplayName(input.workspace),
    branch: checkout.kind === "branch" && !branchGone ? checkout.branch : null,
  };
  if (input.action === "restore") {
    return {
      kind: input.action,
      state: { ...state, action: input.action },
      workspace: input.workspace,
      sourceRepoRoot: input.sourceRepoRoot,
      branchGone: input.branchGone,
    };
  }
  return {
    kind: input.action,
    state: {
      ...state,
      action: input.action,
    },
    workspace: input.workspace,
  };
}

/**
 * FSH: true only when git proves the branch is gone: no local branch, and origin either doesn't
 * exist or reports no such branch. Origin is asked even when a tracking ref remains, since one
 * outlives a branch deleted after its PR merged until a pruning fetch. A failed check (offline,
 * auth) is not proof: the saved branch is kept and its restore reports the error.
 */
async function isBranchGone(repoRoot: string, branch: string): Promise<boolean> {
  try {
    const local = await runGitCommand(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: repoRoot,
      acceptExitCodes: [0, 1],
    });
    if (local.exitCode === 0) return false;
    const remotes = await runGitCommand(["remote"], { cwd: repoRoot });
    if (!remotes.stdout.split("\n").includes("origin")) return true;
    const listed = await runGitCommand(
      ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`],
      {
        cwd: repoRoot,
        acceptExitCodes: [0, 2],
        timeout: 15_000,
        envOverlay: { GIT_TERMINAL_PROMPT: "0" },
      },
    );
    return listed.exitCode === 2;
  } catch {
    return false;
  }
}

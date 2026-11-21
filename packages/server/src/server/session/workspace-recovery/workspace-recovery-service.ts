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
  UnknownBranchError,
  type PaseoWorktreeOwnership,
  type WorktreeSource,
} from "../../../utils/worktree.js";
import { waitForPendingWorktreeRemoval } from "../../../utils/worktree-removal-queue.js";
import { WorktreeRequestError, toWorktreeRequestError } from "../../worktree-errors.js";
import {
  resolveWorkspaceDisplayName,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
} from "../../workspace-registry.js";

// "recreate" makes an empty folder at the workspace's path. It is never offered as the
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
        | "workspace_directory_missing";
      message: string;
      // An empty folder can be made at the workspace's path so its agents open again.
      // Git can't rebuild the files, and the source may only be on a drive that isn't
      // connected right now, so this waits for an explicit request.
      canRecreate: boolean;
    };

export interface WorkspaceRecoveryService {
  inspect(workspaceId: string): Promise<WorkspaceRecoveryState>;
  restore(
    workspaceId: string,
    options?: { recreate?: boolean },
  ): Promise<{ workspaceId: string; action: WorkspaceRecoveryAction }>;
}

type RecoverableState = Extract<WorkspaceRecoveryState, { kind: "recoverable" }>;
type UnavailableRecoveryState = Extract<WorkspaceRecoveryState, { kind: "unavailable" }>;

type RecoveryPlan =
  | { kind: "unarchive"; state: RecoverableState; workspace: PersistedWorkspaceRecord }
  | {
      kind: "restore";
      state: RecoverableState;
      workspace: PersistedWorkspaceRecord;
      sourceRepoRoot: string;
      ownership: PaseoWorktreeOwnership;
    }
  | {
      kind: "unavailable";
      state: UnavailableRecoveryState;
      workspace: PersistedWorkspaceRecord | null;
    };

export function createWorkspaceRecoveryService(deps: {
  paseoHome: string;
  worktreesRoot?: string;
  getWorkspace: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
  getProject: (projectId: string) => Promise<PersistedProjectRecord | null>;
  isDirectory: (path: string) => Promise<boolean>;
  unarchiveWorkspace: (workspace: PersistedWorkspaceRecord) => Promise<void>;
}): WorkspaceRecoveryService {
  function unavailable(
    workspaceId: string,
    reason: UnavailableRecoveryState["reason"],
    message: string,
    recreatable: PersistedWorkspaceRecord | null = null,
  ): RecoveryPlan {
    return {
      kind: "unavailable",
      state: { kind: "unavailable", workspaceId, reason, message, canRecreate: !!recreatable },
      workspace: recreatable,
    };
  }

  async function resolveRecovery(workspaceId: string): Promise<RecoveryPlan> {
    const workspace = await deps.getWorkspace(workspaceId);
    if (!workspace) {
      return unavailable(
        workspaceId,
        "workspace_not_found",
        "This workspace is no longer known to the host.",
      );
    }
    if (!workspace.archivedAt) {
      return unavailable(
        workspaceId,
        "workspace_not_archived",
        "This workspace is not archived, but it is unavailable from the host.",
      );
    }

    const project = await deps.getProject(workspace.projectId);
    if (!project) {
      return unavailable(
        workspaceId,
        "project_not_found",
        "The project for this archived workspace no longer exists.",
      );
    }

    // Archive returns before its worktree removal finishes. Settle it first so
    // an unarchive never adopts a directory that is about to be deleted.
    await waitForPendingWorktreeRemoval(workspace.worktreeRoot ?? workspace.cwd);
    if (await deps.isDirectory(workspace.cwd)) {
      return {
        kind: "unarchive",
        state: createRecoverableState(workspace, "unarchive", workspace.branch),
        workspace,
      };
    }

    const ownership = await isPaseoOwnedWorktreeCwd(workspace.cwd, {
      paseoHome: deps.paseoHome,
      worktreesRoot: deps.worktreesRoot,
      knownGitCommonDir: null,
    });
    // An empty folder may be made where Paseo owns the path, or where the folder that
    // contained it still exists. A missing parent usually means an unmounted drive, and
    // creating the path would write onto the wrong disk.
    const recreatable =
      ownership.allowed || (await deps.isDirectory(dirname(workspace.cwd))) ? workspace : null;

    // A worktree record can lose its worktree fields (reconciliation once rewrote archived
    // worktrees as plain folders), so a Paseo-owned path in a git project also counts.
    const isWorktree =
      workspace.kind === "worktree" || (ownership.allowed && project.kind === "git");
    if (!isWorktree) {
      return unavailable(
        workspaceId,
        "workspace_directory_missing",
        "The archived workspace folder no longer exists, and git can't restore it.",
        recreatable,
      );
    }
    // COMPAT(worktreeRestoreMissingMainRepoRoot): records created before v0.1.110
    // lack placement ownership; remove the project-root fallback after 2027-01-17.
    const sourceRepoRoot = workspace.mainRepoRoot ?? project.rootPath;
    if (!(await deps.isDirectory(sourceRepoRoot))) {
      return unavailable(
        workspaceId,
        "project_directory_missing",
        "The source repository needed to restore this worktree no longer exists.",
        recreatable,
      );
    }

    // Report the branch only when git has it. A branch deleted after its PR merged is
    // restored as a new branch of the same name from the base.
    const branch =
      workspace.branch && (await isBranchAvailable(sourceRepoRoot, workspace.branch))
        ? workspace.branch
        : null;
    return {
      kind: "restore",
      state: createRecoverableState(workspace, "restore", branch),
      workspace,
      sourceRepoRoot,
      ownership,
    };
  }

  async function inspect(workspaceId: string): Promise<WorkspaceRecoveryState> {
    return (await resolveRecovery(workspaceId)).state;
  }

  async function restore(
    workspaceId: string,
    options?: { recreate?: boolean },
  ): Promise<{ workspaceId: string; action: WorkspaceRecoveryAction }> {
    const resolved = await resolveRecovery(workspaceId);
    if (resolved.kind === "unavailable") {
      if (!options?.recreate || !resolved.workspace) {
        throw new Error(resolved.state.message);
      }
      await mkdir(resolved.workspace.cwd, { recursive: true });
      await deps.unarchiveWorkspace(resolved.workspace);
      return { workspaceId, action: "recreate" };
    }

    if (resolved.kind === "restore") {
      await recreateArchivedWorktree(resolved);
    }
    await deps.unarchiveWorkspace(resolved.workspace);
    return { workspaceId, action: resolved.kind };
  }

  async function recreateArchivedWorktree(
    plan: Extract<RecoveryPlan, { kind: "restore" }>,
  ): Promise<void> {
    const { workspace, sourceRepoRoot, ownership } = plan;
    const fromBase = async (): Promise<WorktreeSource> => ({
      kind: "restore-from-base",
      // Reuse the old branch name when it is gone, so the restored workspace reads the same.
      branchName: workspace.branch ?? `restored/${randomUUID().slice(0, 8)}`,
      baseRef: await resolveRecoveryBase(sourceRepoRoot, workspace.baseBranch),
    });
    const source: WorktreeSource = workspace.branch
      ? { kind: "restore", branchName: workspace.branch, baseRef: workspace.baseBranch }
      : await fromBase();

    try {
      await runGitCommand(["worktree", "prune"], { cwd: sourceRepoRoot, timeout: 30_000 });
    } catch {
      // A stale worktree registration is not guaranteed; creation reports any real conflict.
    }

    let previousWorktreePath = workspace.worktreeRoot;
    let hasRecordedWorktreePath = Boolean(previousWorktreePath);
    if (!previousWorktreePath) {
      // COMPAT(worktreeRestoreMissingWorktreeRoot): records created before v0.1.110
      // lack durable backing placement; remove path discovery after 2027-01-17.
      previousWorktreePath = ownership.allowed
        ? (ownership.worktreePath ?? workspace.cwd)
        : workspace.cwd;
      hasRecordedWorktreePath = ownership.allowed;
    }

    const create = (worktreeSource: WorktreeSource) =>
      createWorktree({
        cwd: sourceRepoRoot,
        worktreeSlug: basename(previousWorktreePath),
        source: worktreeSource,
        paseoHome: deps.paseoHome,
        worktreesRoot: deps.worktreesRoot,
        ...(hasRecordedWorktreePath ? { worktreePath: previousWorktreePath } : {}),
      });
    let recreatedWorktreePath: string;
    try {
      try {
        recreatedWorktreePath = (await create(source)).worktreePath;
      } catch (error) {
        // The saved branch is gone locally and on origin: start it again from the base.
        if (!(error instanceof UnknownBranchError)) throw error;
        recreatedWorktreePath = (await create(await fromBase())).worktreePath;
      }
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
        },
        error,
      );
    }
  }

  return { inspect, restore };
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

function createRecoverableState(
  workspace: PersistedWorkspaceRecord,
  action: RecoverableState["action"],
  branch: string | null,
): RecoverableState {
  return {
    kind: "recoverable",
    workspaceId: workspace.workspaceId,
    workspaceName: resolveWorkspaceDisplayName(workspace),
    action,
    branch,
  };
}

async function isBranchAvailable(repoRoot: string, branch: string): Promise<boolean> {
  try {
    for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
      const result = await runGitCommand(["show-ref", "--verify", "--quiet", ref], {
        cwd: repoRoot,
        acceptExitCodes: [0, 1],
      });
      if (result.exitCode === 0) return true;
    }
    return false;
  } catch {
    // Git could not answer; restore tries the saved branch and falls back if it is gone.
    return true;
  }
}

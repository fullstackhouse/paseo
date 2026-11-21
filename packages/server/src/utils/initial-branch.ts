import { runGitCommand } from "./run-git-command.js";

const INITIAL_COMMIT_MESSAGE = "Initial commit";
const PUSH_TIMEOUT_MS = 120_000;

// A fresh clone of an empty remote: HEAD names a branch that has no commit yet, and no other
// branch exists to branch off from. Worktrees need a commit, so the user has to create one first.
export class RepositoryHasNoCommitsError extends Error {
  readonly code = "repository_has_no_commits";
  readonly branchName: string;

  constructor(branchName: string) {
    super(`This repository has no commits yet, so branch '${branchName}' does not exist`);
    this.name = "RepositoryHasNoCommitsError";
    this.branchName = branchName;
  }
}

export interface InitialBranchPlan {
  branch: string;
  pushTo: string | null;
}

// Returns the branch HEAD points at when the repository has no commits on any local or
// remote-tracking branch, or null when there is something to branch off from.
export async function findUnbornInitialBranch(repoRoot: string): Promise<string | null> {
  const head = await runGitCommand(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], {
    cwd: repoRoot,
    acceptExitCodes: [0, 1],
  });
  if (head.exitCode === 0) {
    return null;
  }
  const refs = await runGitCommand(
    ["for-each-ref", "--count=1", "--format=%(refname)", "refs/heads", "refs/remotes"],
    { cwd: repoRoot },
  );
  if (refs.stdout.trim()) {
    return null;
  }
  const symbolic = await runGitCommand(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: repoRoot,
    acceptExitCodes: [0, 1],
  });
  const branch = symbolic.stdout.trim();
  return symbolic.exitCode === 0 && branch ? branch : null;
}

export async function assertRepositoryHasCommits(repoRoot: string): Promise<void> {
  const branch = await findUnbornInitialBranch(repoRoot);
  if (branch) {
    throw new RepositoryHasNoCommitsError(branch);
  }
}

export async function planInitialBranch(repoRoot: string): Promise<InitialBranchPlan> {
  const branch = await findUnbornInitialBranch(repoRoot);
  if (!branch) {
    throw new Error("This repository already has commits");
  }
  return { branch, pushTo: (await hasOriginRemote(repoRoot)) ? "origin" : null };
}

// Creates HEAD's branch with one empty commit and publishes it to origin when there is one.
// Built from plumbing so whatever the user already staged stays staged and out of the commit.
export async function createInitialBranch(repoRoot: string): Promise<InitialBranchPlan> {
  const { branch, pushTo } = await planInitialBranch(repoRoot);

  const { stdout: tree } = await runGitCommand(["mktree"], { cwd: repoRoot, input: "" });
  const { stdout: commit } = await runGitCommand(
    ["commit-tree", tree.trim(), "-m", INITIAL_COMMIT_MESSAGE],
    { cwd: repoRoot },
  );
  // The empty old value makes git refuse if the branch appeared since we looked.
  await runGitCommand(["update-ref", `refs/heads/${branch}`, commit.trim(), ""], {
    cwd: repoRoot,
  });

  if (!pushTo) {
    return { branch, pushTo: null };
  }
  try {
    await runGitCommand(["push", "-u", pushTo, branch], {
      cwd: repoRoot,
      timeout: PUSH_TIMEOUT_MS,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Created branch '${branch}' locally, but pushing it to ${pushTo} failed: ${reason}`,
      {
        cause: error,
      },
    );
  }
  // Records the remote's default branch locally; the clone of an empty remote left it unset.
  await runGitCommand(["remote", "set-head", pushTo, branch], { cwd: repoRoot });
  return { branch, pushTo };
}

async function hasOriginRemote(repoRoot: string): Promise<boolean> {
  const result = await runGitCommand(["config", "--get", "remote.origin.url"], {
    cwd: repoRoot,
    acceptExitCodes: [0, 1],
  });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

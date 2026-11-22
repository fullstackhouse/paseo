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
  // False when an earlier attempt made the commit and only its push failed.
  needsCommit: boolean;
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
  const pushTo = (await hasOriginRemote(repoRoot)) ? "origin" : null;
  const unborn = await findUnbornInitialBranch(repoRoot);
  if (unborn) {
    return { branch: unborn, pushTo, needsCommit: true };
  }
  const unpushed = pushTo ? await findUnpushedInitialBranch(repoRoot) : null;
  if (unpushed) {
    return { branch: unpushed, pushTo, needsCommit: false };
  }
  throw new Error("This repository already has commits");
}

// Creates HEAD's branch with one empty commit and publishes it to origin when there is one.
// Built from plumbing so whatever the user already staged stays staged and out of the commit.
// After a failed push, calling it again retries the push instead of refusing.
export async function createInitialBranch(repoRoot: string): Promise<InitialBranchPlan> {
  const plan = await planInitialBranch(repoRoot);
  const { branch, pushTo } = plan;

  if (plan.needsCommit) {
    const { stdout: tree } = await runGitCommand(["mktree"], { cwd: repoRoot, input: "" });
    const { stdout: commit } = await runGitCommand(
      ["commit-tree", tree.trim(), "-m", INITIAL_COMMIT_MESSAGE],
      { cwd: repoRoot },
    );
    // The empty old value makes git refuse if the branch appeared since we looked.
    await runGitCommand(["update-ref", `refs/heads/${branch}`, commit.trim(), ""], {
      cwd: repoRoot,
    });
  }

  if (!pushTo) {
    return plan;
  }
  try {
    await runGitCommand(["push", "-u", pushTo, branch], {
      cwd: repoRoot,
      timeout: PUSH_TIMEOUT_MS,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Created branch '${branch}' locally, but pushing it to ${pushTo} failed. Try again to retry the push: ${reason}`,
      {
        cause: error,
      },
    );
  }
  // Records the remote's default branch locally; the clone of an empty remote left it unset.
  await runGitCommand(["remote", "set-head", pushTo, branch], { cwd: repoRoot });
  return plan;
}

// The state a failed push leaves behind: HEAD's branch is the only local branch, holds a single
// commit and has no upstream, and nothing has been fetched from or pushed to the remote yet.
async function findUnpushedInitialBranch(repoRoot: string): Promise<string | null> {
  const symbolic = await runGitCommand(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: repoRoot,
    acceptExitCodes: [0, 1],
  });
  const branch = symbolic.stdout.trim();
  if (symbolic.exitCode !== 0 || !branch) {
    return null;
  }
  const heads = await runGitCommand(["for-each-ref", "--format=%(refname)", "refs/heads"], {
    cwd: repoRoot,
  });
  if (heads.stdout.trim() !== `refs/heads/${branch}`) {
    return null;
  }
  const remotes = await runGitCommand(
    ["for-each-ref", "--count=1", "--format=%(refname)", "refs/remotes"],
    { cwd: repoRoot },
  );
  if (remotes.stdout.trim()) {
    return null;
  }
  const upstream = await runGitCommand(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{upstream}`],
    { cwd: repoRoot, acceptExitCodes: [0, 128] },
  );
  if (upstream.exitCode === 0) {
    return null;
  }
  const count = await runGitCommand(["rev-list", "--count", `refs/heads/${branch}`], {
    cwd: repoRoot,
  });
  return count.stdout.trim() === "1" ? branch : null;
}

async function hasOriginRemote(repoRoot: string): Promise<boolean> {
  const result = await runGitCommand(["config", "--get", "remote.origin.url"], {
    cwd: repoRoot,
    acceptExitCodes: [0, 1],
  });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

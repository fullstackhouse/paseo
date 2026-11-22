import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

// The daemon's errorCode for a worktree requested from a repository with no commits yet, such
// as a fresh clone of an empty GitHub repository.
export const REPOSITORY_HAS_NO_COMMITS = "repository_has_no_commits";

export class RepositoryHasNoCommitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryHasNoCommitsError";
  }
}

// "created": the branch now exists, retry the worktree. "local": start in the checkout itself,
// which needs no commit. "cancelled": leave the repository as it is.
export type EmptyRepositoryChoice = "created" | "local" | "cancelled";

export interface EmptyRepositoryPrompt {
  branch: string;
  pushTo: string | null;
  createBranch: () => Promise<void>;
}

// Asks how to start in a repository with no commits: create its first branch, or use the local
// checkout. The prompt runs createBranch itself, so it can show progress and errors in place.
export async function resolveEmptyRepository(input: {
  client: Pick<DaemonClient, "createInitialBranch">;
  cwd: string;
  ask: (prompt: EmptyRepositoryPrompt) => Promise<EmptyRepositoryChoice>;
}): Promise<EmptyRepositoryChoice> {
  const plan = await input.client.createInitialBranch(input.cwd, { dryRun: true });
  if (!plan.success || !plan.branch) {
    throw new Error(plan.error?.message ?? "Unable to inspect the repository");
  }
  const branch = plan.branch;
  return input.ask({
    branch,
    pushTo: plan.pushedTo,
    createBranch: async () => {
      const created = await input.client.createInitialBranch(input.cwd);
      if (!created.success) {
        throw new Error(created.error?.message ?? `Unable to create branch ${branch}`);
      }
    },
  });
}

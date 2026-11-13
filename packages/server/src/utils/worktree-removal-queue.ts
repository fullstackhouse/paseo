import { resolve } from "node:path";

import { createRealpathAwarePathMatcher } from "./path.js";

interface PendingWorktreeRemoval {
  worktreePath: string;
  done: Promise<void>;
}

// Worktree removals (teardown commands, `git worktree remove`, rm, prune) run
// here, one at a time per repository, so `git worktree` admin writes for a repo
// never interleave. Creating a worktree at a path with a pending removal waits
// for it (see waitForPendingWorktreeRemoval) instead of racing the deletion.
// Process-wide on purpose: two sessions archiving and creating at the same path
// must see each other's pending work.
const repositoryTails = new Map<string, Promise<void>>();
const pendingRemovals = new Set<PendingWorktreeRemoval>();

export interface EnqueueWorktreeRemovalInput<T> {
  // Removals sharing a key run one after another.
  repositoryKey: string;
  worktreePath: string;
  remove: () => Promise<T>;
}

// Runs `remove` after every earlier removal for the same repository. The
// returned promise settles with `remove`'s outcome; the queue itself never
// rejects, so a caller that drops the promise must handle failures inside
// `remove`.
export function enqueueWorktreeRemoval<T>(input: EnqueueWorktreeRemovalInput<T>): Promise<T> {
  const repositoryKey = resolve(input.repositoryKey);
  const previous = repositoryTails.get(repositoryKey) ?? Promise.resolve();
  const result = previous.then(input.remove);
  const done: Promise<void> = result
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      pendingRemovals.delete(pending);
      if (repositoryTails.get(repositoryKey) === done) {
        repositoryTails.delete(repositoryKey);
      }
    });
  const pending: PendingWorktreeRemoval = { worktreePath: resolve(input.worktreePath), done };
  pendingRemovals.add(pending);
  repositoryTails.set(repositoryKey, done);
  return result;
}

// Resolves once no removal is queued or running for worktreePath.
export async function waitForPendingWorktreeRemoval(worktreePath: string): Promise<void> {
  const matchesPath = createRealpathAwarePathMatcher(worktreePath);
  for (;;) {
    const matching = [...pendingRemovals].filter((pending) => matchesPath(pending.worktreePath));
    if (matching.length === 0) {
      return;
    }
    await Promise.all(matching.map((pending) => pending.done));
  }
}

import { describe, expect, test } from "vitest";

import { enqueueWorktreeRemoval, waitForPendingWorktreeRemoval } from "./worktree-removal-queue.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("worktree removal queue", () => {
  test("runs removals for one repository in order, even after a failure", async () => {
    const events: string[] = [];
    const firstGate = deferred();

    const first = enqueueWorktreeRemoval({
      repositoryKey: "/repo-order",
      worktreePath: "/repo-order-worktrees/a",
      remove: async () => {
        events.push("a:start");
        await firstGate.promise;
        events.push("a:end");
        throw new Error("a failed");
      },
    });
    const second = enqueueWorktreeRemoval({
      repositoryKey: "/repo-order",
      worktreePath: "/repo-order-worktrees/b",
      remove: async () => {
        events.push("b");
        return "b removed";
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["a:start"]);
    firstGate.resolve();

    await expect(first).rejects.toThrow("a failed");
    await expect(second).resolves.toBe("b removed");
    expect(events).toEqual(["a:start", "a:end", "b"]);
  });

  test("waiting on a path resolves only after its pending removal settles", async () => {
    const gate = deferred();
    let removed = false;
    void enqueueWorktreeRemoval({
      repositoryKey: "/repo-wait",
      worktreePath: "/repo-wait-worktrees/slug",
      remove: async () => {
        await gate.promise;
        removed = true;
      },
    });

    const waiting = waitForPendingWorktreeRemoval("/repo-wait-worktrees/slug").then(() => removed);
    await waitForPendingWorktreeRemoval("/repo-wait-worktrees/other-slug");
    expect(removed).toBe(false);

    gate.resolve();
    await expect(waiting).resolves.toBe(true);
  });
});

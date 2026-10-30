import { resolve } from "node:path";
import { LRUCache } from "lru-cache";
import type { Logger } from "pino";

import { archiveIfSafe, type AutoArchiveArchiveOptions } from "./archive-if-safe.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitSubscription,
} from "../workspace-git-service.js";

export interface AutoArchiveOnMergeOptions extends AutoArchiveArchiveOptions {
  logger: Logger;
}

export interface AutoArchiveOnMergeDependencies {
  archiveIfSafe: typeof archiveIfSafe;
  resolvePath: typeof resolve;
}

const OPEN_PULL_REQUEST_LATCH_MAX = 1_024;

const defaultDependencies: AutoArchiveOnMergeDependencies = {
  archiveIfSafe,
  resolvePath: resolve,
};

export function setupAutoArchiveOnMerge(
  options: AutoArchiveOnMergeOptions,
  deps: AutoArchiveOnMergeDependencies = defaultDependencies,
): WorkspaceGitSubscription {
  const log = options.logger.child({ module: "auto-archive-on-merge" });
  const inFlightCwds = new Set<string>();
  const openPullRequestUrlsByCwd = new LRUCache<string, string>({
    max: OPEN_PULL_REQUEST_LATCH_MAX,
  });
  const blockedCwdsByWorkspaceId: Record<string, string> = {};

  function evaluateCwd(input: { cwd: string; pullRequestUrl: string }): void {
    const snapshotCwd = deps.resolvePath(input.cwd);
    if (inFlightCwds.has(snapshotCwd)) {
      return;
    }
    inFlightCwds.add(snapshotCwd);

    void (async () => {
      let freshSnapshot: WorkspaceGitRuntimeSnapshot | null;
      try {
        freshSnapshot = await options.workspaceGitService.getSnapshot(input.cwd, {
          reason: "auto-archive-on-merge",
        });
      } catch (error) {
        log.warn(
          { err: error, cwd: input.cwd },
          "Failed to read snapshot for auto-archive; skipping",
        );
        return;
      }
      const freshPullRequest = freshSnapshot?.forge.pullRequest;
      if (
        !freshPullRequest?.isMerged ||
        freshPullRequest.url !== input.pullRequestUrl ||
        openPullRequestUrlsByCwd.get(snapshotCwd) !== input.pullRequestUrl
      ) {
        if (openPullRequestUrlsByCwd.get(snapshotCwd) === input.pullRequestUrl) {
          openPullRequestUrlsByCwd.delete(snapshotCwd);
        }
        return;
      }

      const attachedWorkspaces = (await options.listActiveWorkspaces()).filter(
        (workspace) => deps.resolvePath(workspace.cwd) === snapshotCwd,
      );
      for (const workspace of attachedWorkspaces) {
        const result = await deps.archiveIfSafe({
          workspaceId: workspace.workspaceId,
          snapshot: freshSnapshot,
          options,
          log,
        });
        if (result === "blocked-by-running-agent") {
          blockedCwdsByWorkspaceId[workspace.workspaceId] = input.cwd;
        } else {
          delete blockedCwdsByWorkspaceId[workspace.workspaceId];
        }
      }
    })()
      .catch((error) => {
        log.warn({ err: error, cwd: input.cwd }, "Failed to auto-archive attached workspaces");
      })
      .finally(() => {
        inFlightCwds.delete(snapshotCwd);
      });
  }

  const gitSubscription = options.workspaceGitService.onSnapshotUpdated((snapshot) => {
    const snapshotCwd = deps.resolvePath(snapshot.cwd);
    if (options.daemonConfigStore.get().autoArchiveAfterMerge !== true) {
      openPullRequestUrlsByCwd.delete(snapshotCwd);
      return;
    }

    const pullRequest = snapshot.forge.pullRequest;
    if (!pullRequest?.isMerged) {
      if (pullRequest?.state.toLowerCase() === "open") {
        openPullRequestUrlsByCwd.set(snapshotCwd, pullRequest.url);
      } else {
        openPullRequestUrlsByCwd.delete(snapshotCwd);
      }
      return;
    }
    if (openPullRequestUrlsByCwd.get(snapshotCwd) !== pullRequest.url) {
      openPullRequestUrlsByCwd.delete(snapshotCwd);
      return;
    }
    evaluateCwd({ cwd: snapshot.cwd, pullRequestUrl: pullRequest.url });
  });

  // Snapshots only emit on change, so a merge deferred by a running agent retries when it stops.
  const unsubscribeAgents = options.agentManager.subscribe(
    (event) => {
      if (event.type !== "agent_state") {
        return;
      }
      const workspaceId = event.agent.workspaceId;
      if (!workspaceId || !(workspaceId in blockedCwdsByWorkspaceId)) {
        return;
      }
      if (options.agentManager.hasInFlightRun(event.agent.id)) {
        return;
      }
      if (options.daemonConfigStore.get().autoArchiveAfterMerge !== true) {
        return;
      }
      const cwd = blockedCwdsByWorkspaceId[workspaceId];
      delete blockedCwdsByWorkspaceId[workspaceId];
      const pullRequestUrl = openPullRequestUrlsByCwd.get(deps.resolvePath(cwd));
      if (pullRequestUrl) {
        evaluateCwd({ cwd, pullRequestUrl });
      }
    },
    { includeInternal: true, replayState: false },
  );

  return {
    unsubscribe: () => {
      gitSubscription.unsubscribe();
      unsubscribeAgents();
    },
  };
}

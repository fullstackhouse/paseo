import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { __resetCheckoutShortstatCacheForTests } from "../utils/checkout-git.js";
import {
  type GitCommandSubmissionMetric,
  startGitCommandMetrics,
  stopGitCommandMetrics,
  waitForGitCommandMetricsIdle,
} from "../utils/run-git-command.js";
import type { FileChange } from "./file-observer/index.js";
import {
  type WorkspaceGitRuntimeSnapshot,
  WorkspaceGitServiceImpl,
} from "./workspace-git-service.js";

// Real repositories and real Git commands, with `.git` watcher events delivered by hand so each
// test controls exactly which metadata change the service sees.

interface WatchRecord {
  directory: string;
  callback: (error: Error | null, events: FileChange[]) => void;
}

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
  __resetCheckoutShortstatCacheForTests();
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function seedRepository(options: { siblings: number; withOrigin?: boolean }) {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "paseo-metadata-scope-")));
  const repoRoot = path.join(root, "repo");
  mkdirSync(repoRoot);
  git(repoRoot, "init", "-b", "main");
  git(repoRoot, "config", "user.email", "scope@example.com");
  git(repoRoot, "config", "user.name", "Scope");
  writeFileSync(path.join(repoRoot, "README.md"), "initial\n");
  git(repoRoot, "add", "README.md");
  git(repoRoot, "commit", "-m", "initial");
  if (options.withOrigin) {
    const originRoot = path.join(root, "origin.git");
    git(root, "init", "--bare", "-b", "main", originRoot);
    git(repoRoot, "remote", "add", "origin", originRoot);
    git(repoRoot, "push", "origin", "main");
    git(repoRoot, "fetch", "origin");
  }
  const siblings = Array.from({ length: options.siblings }, (_, index) => {
    const cwd = path.join(root, `sibling-${index}`);
    git(repoRoot, "worktree", "add", "-b", `sibling-${index}`, cwd, "main");
    return cwd;
  });
  return { root, repoRoot, gitDir: path.join(repoRoot, ".git"), siblings };
}

async function observe(cwds: string[]) {
  const records: WatchRecord[] = [];
  const service = new WorkspaceGitServiceImpl({
    logger: pino({ enabled: false }),
    paseoHome: path.join(path.dirname(cwds[0] ?? ""), "paseo-home"),
    deps: {
      subscribe: async (directory, callback) => {
        records.push({ directory, callback });
        return { updateIgnore: async () => {}, unsubscribe: async () => {} };
      },
      createWatcherLivenessCanary: () => ({
        path: "",
        filterEvents: (events: FileChange[]) => events,
        verify: async () => {},
      }),
      runGitFetch: vi.fn(async () => ({ changes: [], error: null })),
    },
  });
  const latest = new Map<string, WorkspaceGitRuntimeSnapshot>();
  const subscriptions = cwds.map((cwd) =>
    service.registerWorkspace({ cwd }, (snapshot) => latest.set(cwd, snapshot)),
  );
  cleanup.push(async () => {
    for (const subscription of subscriptions) subscription.unsubscribe();
    await service.dispose();
  });
  await vi.waitFor(
    () => {
      for (const cwd of cwds) expect(latest.get(cwd)?.git.isGit).toBe(true);
      expect(service.getMetrics()).toMatchObject({
        workspaceObservationSetupInFlightCount: 0,
        workspaceRefreshInFlightCount: 0,
      });
    },
    { timeout: 30_000, interval: 50 },
  );
  await settle();
  return { latest, records };
}

async function settle(): Promise<GitCommandSubmissionMetric[]> {
  startGitCommandMetrics();
  await waitForGitCommandMetricsIdle({ quietMs: 1_500, timeoutMs: 30_000 });
  return stopGitCommandMetrics().submissions;
}

/** Delivers `.git` events, as the repository metadata watcher would, and records the Git work. */
async function deliver(
  records: WatchRecord[],
  gitDir: string,
  events: Array<[relativePath: string, type: FileChange["type"]]>,
): Promise<GitCommandSubmissionMetric[]> {
  const commonDir = realpathSync.native(gitDir);
  const record = records.find((candidate) => realpathSync.native(candidate.directory) === commonDir);
  if (!record) throw new Error(`No repository metadata watcher for ${gitDir}`);
  startGitCommandMetrics();
  record.callback(
    null,
    events.map(([relativePath, type]) => ({
      path: path.join(record.directory, relativePath),
      type,
    })),
  );
  await waitForGitCommandMetricsIdle({ quietMs: 1_500, timeoutMs: 30_000 });
  return stopGitCommandMetrics().submissions;
}

const WORKING_TREE_SCANS = new Set(["status", "ls-files", "diff"]);

function workingTreeScans(commands: GitCommandSubmissionMetric[]): Record<string, string[]> {
  const scans: Record<string, string[]> = {};
  for (const command of commands) {
    const operation = command.args[0] ?? "";
    if (!WORKING_TREE_SCANS.has(operation)) continue;
    const cwd = realpathSync.native(command.cwd);
    scans[cwd] = [...(scans[cwd] ?? []), operation].sort();
  }
  return scans;
}

function behind(latest: Map<string, WorkspaceGitRuntimeSnapshot>, cwd: string): number | null {
  const snapshot = latest.get(cwd)?.git;
  return snapshot?.isGit ? (snapshot.aheadBehind?.behind ?? null) : null;
}

test("a remote-ref or packed-refs change updates sibling ahead/behind without scanning their working trees", async () => {
  const repo = seedRepository({ siblings: 4, withOrigin: true });
  cleanup.push(async () => rmSync(repo.root, { recursive: true, force: true }));
  const { latest, records } = await observe(repo.siblings);
  for (const cwd of repo.siblings) expect(behind(latest, cwd)).toBe(0);

  // An external fetch moves origin/main by one commit none of the siblings has.
  const fetched = git(
    repo.repoRoot,
    "commit-tree",
    "-p",
    "refs/remotes/origin/main",
    "-m",
    "fetched",
    "refs/remotes/origin/main^{tree}",
  );
  git(repo.repoRoot, "update-ref", "refs/remotes/origin/main", fetched);
  const remoteRefMove = await deliver(records, repo.gitDir, [
    ["refs/remotes/origin/main", "update"],
  ]);
  expect(workingTreeScans(remoteRefMove)).toEqual({});
  for (const cwd of repo.siblings) expect(behind(latest, cwd)).toBe(1);

  // Packing deletes every loose ref, the checked-out branches included, and rewrites packed-refs.
  git(repo.repoRoot, "pack-refs", "--all", "--prune");
  const packing = await deliver(records, repo.gitDir, [
    ["packed-refs", "update"],
    ["refs/heads/main", "delete"],
    ["refs/remotes/origin/main", "delete"],
    ...repo.siblings.map((_, index): [string, FileChange["type"]] => [
      `refs/heads/sibling-${index}`,
      "delete",
    ]),
  ]);
  expect(workingTreeScans(packing)).toEqual({});
  for (const cwd of repo.siblings) expect(behind(latest, cwd)).toBe(1);

  // Deleting the packed origin/main rewrites only packed-refs; the siblings fall back to local
  // main, which they are level with.
  git(repo.repoRoot, "update-ref", "-d", "refs/remotes/origin/main");
  const packedRefDelete = await deliver(records, repo.gitDir, [["packed-refs", "update"]]);
  expect(workingTreeScans(packedRefDelete)).toEqual({});
  for (const cwd of repo.siblings) expect(behind(latest, cwd)).toBe(0);
}, 120_000);

test("a commit fully refreshes its own checkout and runs no git status in siblings", async () => {
  const repo = seedRepository({ siblings: 3 });
  cleanup.push(async () => rmSync(repo.root, { recursive: true, force: true }));
  writeFileSync(path.join(repo.repoRoot, "README.md"), "main moves\n");
  git(repo.repoRoot, "add", "README.md");
  const { latest, records } = await observe([repo.repoRoot, ...repo.siblings]);
  expect(latest.get(repo.repoRoot)?.git).toMatchObject({ isDirty: true });

  git(repo.repoRoot, "commit", "-m", "main moves");
  const commit = await deliver(records, repo.gitDir, [
    ["index", "update"],
    ["refs/heads/main", "update"],
  ]);

  // main is its own base, so its full refresh has no diff stat to measure: status is the scan.
  expect(workingTreeScans(commit)).toEqual({ [realpathSync.native(repo.repoRoot)]: ["status"] });
  expect(latest.get(repo.repoRoot)?.git).toMatchObject({ isDirty: false });
  for (const cwd of repo.siblings) expect(behind(latest, cwd)).toBe(1);
}, 120_000);

test("an unclassifiable shared config change still fully refreshes every workspace", async () => {
  const repo = seedRepository({ siblings: 3 });
  cleanup.push(async () => rmSync(repo.root, { recursive: true, force: true }));
  const { records } = await observe(repo.siblings);

  // core.* can change what git status reports, so it keeps the full refresh.
  git(repo.repoRoot, "config", "core.excludesFile", path.join(repo.root, "excludes"));
  const coreConfig = await deliver(records, repo.gitDir, [["config", "update"]]);

  const statusCwds = new Set(
    coreConfig
      .filter((command) => command.args[0] === "status")
      .map((command) => realpathSync.native(command.cwd)),
  );
  expect(statusCwds).toEqual(new Set(repo.siblings.map((cwd) => realpathSync.native(cwd))));
}, 120_000);

test("a push -u refreshes only the pushing worktree among 20 siblings", async () => {
  const repo = seedRepository({ siblings: 20, withOrigin: true });
  cleanup.push(async () => rmSync(repo.root, { recursive: true, force: true }));
  const pusher = repo.siblings[0] ?? "";
  writeFileSync(path.join(pusher, "README.md"), "pushed\n");
  git(pusher, "add", "README.md");
  git(pusher, "commit", "-m", "pushed");
  const { latest, records } = await observe(repo.siblings);

  git(pusher, "push", "-u", "origin", "HEAD");
  const push = await deliver(records, repo.gitDir, [
    ["refs/remotes/origin/sibling-0", "create"],
    ["config", "update"],
  ]);

  const pusherRoot = realpathSync.native(pusher);
  expect(push.filter((command) => realpathSync.native(command.cwd) !== pusherRoot)).toEqual([]);
  expect(push.length).toBeGreaterThan(0);
  expect(latest.get(pusher)?.git).toMatchObject({ aheadOfOrigin: 0, behindOfOrigin: 0 });
}, 180_000);

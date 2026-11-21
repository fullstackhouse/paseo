import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

// workspace.create has four reject branches before it ever touches the
// registries; this pins each one's errorCode (or, for project-not-found, its
// message) as seen by the daemon client, so the CLI/app contract on top of them
// stays covered.
test("workspace.create surfaces each early-reject error branch", async () => {
  const daemon = await createTestPaseoDaemon();
  const missingDir = path.join(tmpdir(), `paseo-workspace-create-missing-${Date.now()}`);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });

  try {
    await client.connect();

    // directory source pointed at a path that does not exist -> directory_not_found
    const directoryNotFound = await client.createWorkspace({
      source: { kind: "directory", path: missingDir },
    });
    expect(directoryNotFound.workspace).toBeNull();
    expect(directoryNotFound.errorCode).toBe("directory_not_found");
    expect(directoryNotFound.error).toContain(missingDir);

    // worktree source without a cwd or projectId -> source_required
    const sourceRequired = await client.createWorkspace({
      source: { kind: "worktree", worktreeSlug: "feat" },
    });
    expect(sourceRequired.workspace).toBeNull();
    expect(sourceRequired.errorCode).toBe("source_required");

    // worktree source with an unknown projectId -> project-not-found message
    // (surfaced via the generic catch, so it carries an error but no errorCode)
    const projectNotFound = await client.createWorkspace({
      source: { kind: "worktree", projectId: "proj-does-not-exist", worktreeSlug: "feat" },
    });
    expect(projectNotFound.workspace).toBeNull();
    expect(projectNotFound.error).toContain("Project not found: proj-does-not-exist");
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    rmSync(missingDir, { recursive: true, force: true });
  }
}, 180000);

test("workspace creation replay rejects a checkout removed after completion", async () => {
  const daemon = await createTestPaseoDaemon();
  const directory = mkdtempSync(path.join(tmpdir(), "workspace-replay-"));
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });
  try {
    await client.connect();
    const request = {
      source: { kind: "directory" as const, path: directory },
      idempotencyKey: "removed-checkout",
    };
    const created = await client.createWorkspace(request);
    expect(created.error).toBeNull();
    expect(created.workspace).not.toBeNull();
    rmSync(directory, { recursive: true, force: true });
    const replayed = await client.createWorkspace(request);
    expect(replayed.workspace).toBeNull();
    expect(replayed.errorCode).toBe("directory_not_found");
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 180000);

// A clone of an empty remote has no branch to cut a worktree from. The client is told why, asks
// the user, creates the first branch, and the same request then succeeds.
test("workspace creation in an empty repository succeeds once its first branch exists", async () => {
  const daemon = await createTestPaseoDaemon();
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "workspace-empty-repo-")));
  const remote = path.join(root, "remote.git");
  const checkout = path.join(root, "checkout");
  execFileSync("git", ["init", "--bare", "-b", "main", remote]);
  execFileSync("git", ["clone", remote, checkout], { stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: checkout });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: checkout });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });
  try {
    await client.connect();
    const added = await client.addProject(checkout);
    expect(added.error).toBeNull();
    const request = {
      source: {
        kind: "worktree" as const,
        projectId: added.project!.projectId,
        cwd: checkout,
        worktreeSlug: "first",
      },
      idempotencyKey: "empty-repo",
    };

    const rejected = await client.createWorkspace(request);
    expect(rejected.workspace).toBeNull();
    expect(rejected.errorCode).toBe("repository_has_no_commits");

    const plan = await client.createInitialBranch(checkout, { dryRun: true });
    expect(plan).toMatchObject({ success: true, branch: "main", pushedTo: "origin" });
    const created = await client.createInitialBranch(checkout);
    expect(created).toMatchObject({
      success: true,
      branch: "main",
      pushedTo: "origin",
      error: null,
    });
    expect(
      execFileSync("git", ["--git-dir", remote, "log", "--format=%s", "main"]).toString(),
    ).toBe("Initial commit\n");

    const retried = await client.createWorkspace(request);
    expect(retried.error).toBeNull();
    expect(retried.workspace).not.toBeNull();
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 180000);

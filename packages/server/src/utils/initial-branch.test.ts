import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRepositoryHasCommits,
  createInitialBranch,
  planInitialBranch,
  RepositoryHasNoCommitsError,
} from "./initial-branch.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function configureIdentity(cwd: string): void {
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
}

describe("initial branch", () => {
  let root: string;
  let remote: string;
  let checkout: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "initial-branch-")));
    remote = join(root, "remote.git");
    checkout = join(root, "checkout");
    execFileSync("git", ["init", "--bare", "-b", "main", remote]);
    execFileSync("git", ["clone", remote, checkout], { stdio: "ignore" });
    configureIdentity(checkout);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a worktree base in a clone of an empty repository", async () => {
    const rejection = assertRepositoryHasCommits(checkout);

    await expect(rejection).rejects.toBeInstanceOf(RepositoryHasNoCommitsError);
    await expect(rejection).rejects.toMatchObject({
      code: "repository_has_no_commits",
      branchName: "main",
    });
  });

  it("plans the branch HEAD names and the origin it would push to, without creating it", async () => {
    await expect(planInitialBranch(checkout)).resolves.toEqual({
      branch: "main",
      pushTo: "origin",
      needsCommit: true,
    });
    expect(git(checkout, "for-each-ref", "refs/heads")).toBe("");
  });

  it("creates the branch with an empty commit and publishes it to origin", async () => {
    await expect(createInitialBranch(checkout)).resolves.toEqual({
      branch: "main",
      pushTo: "origin",
      needsCommit: true,
    });

    expect(git(checkout, "log", "--format=%s", "main")).toBe("Initial commit");
    expect(git(checkout, "ls-tree", "main")).toBe("");
    expect(git(remote, "rev-parse", "main")).toBe(git(checkout, "rev-parse", "main"));
    expect(git(checkout, "rev-parse", "--abbrev-ref", "main@{upstream}")).toBe("origin/main");
    expect(git(checkout, "symbolic-ref", "refs/remotes/origin/HEAD")).toBe(
      "refs/remotes/origin/main",
    );
    await expect(assertRepositoryHasCommits(checkout)).resolves.toBeUndefined();
  });

  it("leaves files the user already staged out of the commit and still staged", async () => {
    writeFileSync(join(checkout, "README.md"), "draft\n");
    git(checkout, "add", "README.md");

    await createInitialBranch(checkout);

    expect(git(checkout, "ls-tree", "main")).toBe("");
    expect(git(checkout, "diff", "--cached", "--name-only")).toBe("README.md");
  });

  it("creates the branch locally when the repository has no origin", async () => {
    const local = join(root, "local");
    execFileSync("git", ["init", "-b", "trunk", local]);
    configureIdentity(local);

    await expect(createInitialBranch(local)).resolves.toEqual({
      branch: "trunk",
      pushTo: null,
      needsCommit: true,
    });
    expect(git(local, "log", "--format=%s", "trunk")).toBe("Initial commit");
  });

  it("retries only the push after a failed one, without a second commit", async () => {
    git(checkout, "remote", "set-url", "origin", join(root, "missing.git"));

    await expect(createInitialBranch(checkout)).rejects.toThrow(
      "Created branch 'main' locally, but pushing it to origin failed",
    );
    const firstCommit = git(checkout, "rev-parse", "main");
    await expect(planInitialBranch(checkout)).resolves.toEqual({
      branch: "main",
      pushTo: "origin",
      needsCommit: false,
    });

    git(checkout, "remote", "set-url", "origin", remote);
    await expect(createInitialBranch(checkout)).resolves.toEqual({
      branch: "main",
      pushTo: "origin",
      needsCommit: false,
    });

    expect(git(checkout, "rev-parse", "main")).toBe(firstCommit);
    expect(git(checkout, "rev-list", "--count", "main")).toBe("1");
    expect(git(remote, "rev-parse", "main")).toBe(firstCommit);
    expect(git(checkout, "rev-parse", "--abbrev-ref", "main@{upstream}")).toBe("origin/main");
    expect(git(checkout, "symbolic-ref", "refs/remotes/origin/HEAD")).toBe(
      "refs/remotes/origin/main",
    );
  });

  it("refuses once the repository has commits", async () => {
    await createInitialBranch(checkout);

    await expect(createInitialBranch(checkout)).rejects.toThrow(
      "This repository already has commits",
    );
  });
});

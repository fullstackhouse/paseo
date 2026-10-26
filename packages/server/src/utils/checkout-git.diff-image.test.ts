import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getCheckoutDiff, getCheckoutDiffImage } from "./checkout-git.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Bytes that are not valid UTF-8, so a text decode anywhere would corrupt them.
const OLD_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);
const NEW_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xc3, 0x28, 0x01]);

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd }).toString();
}

function commitAll(repoDir: string, message: string): string {
  git(["add", "-A"], repoDir);
  git(["-c", "commit.gpgsign=false", "commit", "-m", message], repoDir);
  return git(["rev-parse", "HEAD"], repoDir).trim();
}

function initRepo(): string {
  const tempDir = realpathSync.native(mkdtempSync(join(tmpdir(), "diff-image-test-")));
  tempDirs.push(tempDir);
  const repoDir = join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  git(["init", "-b", "main"], repoDir);
  git(["config", "user.email", "test@test.com"], repoDir);
  git(["config", "user.name", "Test User"], repoDir);
  return repoDir;
}

function ok(content: Buffer) {
  return {
    status: "ok",
    mimeType: "image/png",
    content: content.toString("base64"),
    size: content.byteLength,
  };
}

const uncommitted = { kind: "working", compare: { mode: "uncommitted" } } as const;

describe("getCheckoutDiffImage", () => {
  it("reads HEAD and the working tree for an uncommitted change", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "shot.png"), OLD_PNG);
    commitAll(repoDir, "initial");
    writeFileSync(join(repoDir, "shot.png"), NEW_PNG);

    expect(
      await getCheckoutDiffImage({ cwd: repoDir, path: "shot.png", source: uncommitted }),
    ).toEqual({ old: ok(OLD_PNG), new: ok(NEW_PNG) });
  });

  it("reports the missing side of an added or deleted image", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "gone.png"), OLD_PNG);
    commitAll(repoDir, "initial");
    rmSync(join(repoDir, "gone.png"));
    writeFileSync(join(repoDir, "added.png"), NEW_PNG);

    expect(
      await getCheckoutDiffImage({ cwd: repoDir, path: "gone.png", source: uncommitted }),
    ).toEqual({ old: ok(OLD_PNG), new: { status: "missing" } });
    expect(
      await getCheckoutDiffImage({ cwd: repoDir, path: "added.png", source: uncommitted }),
    ).toEqual({ old: { status: "missing" }, new: ok(NEW_PNG) });
  });

  it("compares a commit to its parent, resolving the rename source", async () => {
    const repoDir = initRepo();
    // Git pairs a rename by similarity, so the edit must leave most bytes intact.
    const original = Buffer.concat([OLD_PNG, Buffer.alloc(4096, 7)]);
    const edited = Buffer.concat([NEW_PNG, Buffer.alloc(4096, 7)]);
    writeFileSync(join(repoDir, "before.png"), original);
    commitAll(repoDir, "initial");
    rmSync(join(repoDir, "before.png"));
    writeFileSync(join(repoDir, "after.png"), edited);
    const sha = commitAll(repoDir, "rename and edit");

    expect(
      await getCheckoutDiffImage({
        cwd: repoDir,
        path: "after.png",
        source: { kind: "commit", sha },
      }),
    ).toEqual({ old: ok(original), new: ok(edited) });
  });

  it("treats the root commit's parent side as missing", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "shot.png"), NEW_PNG);
    const sha = commitAll(repoDir, "initial");

    expect(
      await getCheckoutDiffImage({
        cwd: repoDir,
        path: "shot.png",
        source: { kind: "commit", sha },
      }),
    ).toEqual({ old: { status: "missing" }, new: ok(NEW_PNG) });
  });

  it("does not follow a working-tree symlink", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "README.md"), "x\n");
    commitAll(repoDir, "initial");
    const outside = join(repoDir, "..", "secret.png");
    writeFileSync(outside, NEW_PNG);
    symlinkSync(outside, join(repoDir, "link.png"));

    expect(
      await getCheckoutDiffImage({ cwd: repoDir, path: "link.png", source: uncommitted }),
    ).toEqual({ old: { status: "missing" }, new: { status: "missing" } });
  });

  it("does not follow a symlinked parent directory", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "README.md"), "x\n");
    commitAll(repoDir, "initial");
    const outsideDir = join(repoDir, "..", "outside");
    mkdirSync(outsideDir);
    writeFileSync(join(outsideDir, "secret.png"), NEW_PNG);
    symlinkSync(outsideDir, join(repoDir, "assets"));

    expect(
      await getCheckoutDiffImage({ cwd: repoDir, path: "assets/secret.png", source: uncommitted }),
    ).toEqual({ old: { status: "missing" }, new: { status: "missing" } });
  });

  it("treats a directory named like an image as missing", async () => {
    const repoDir = initRepo();
    mkdirSync(join(repoDir, "icons.png"));
    writeFileSync(join(repoDir, "icons.png", "a.txt"), "x\n");
    commitAll(repoDir, "initial");

    expect(
      await getCheckoutDiffImage({ cwd: repoDir, path: "icons.png", source: uncommitted }),
    ).toEqual({ old: { status: "missing" }, new: { status: "missing" } });
  });

  it("compares the merge base to HEAD in base mode", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "shot.png"), OLD_PNG);
    commitAll(repoDir, "initial");
    git(["checkout", "-q", "-b", "feature"], repoDir);
    writeFileSync(join(repoDir, "shot.png"), NEW_PNG);
    commitAll(repoDir, "update");
    // Uncommitted bytes must not leak into a HEAD comparison.
    writeFileSync(join(repoDir, "shot.png"), Buffer.from([0x89, 0x50]));

    expect(
      await getCheckoutDiffImage({
        cwd: repoDir,
        path: "shot.png",
        source: { kind: "working", compare: { mode: "base", baseRef: "main" } },
      }),
    ).toEqual({ old: ok(OLD_PNG), new: ok(NEW_PNG) });
  });

  it("changes the diff's image revision when an image is rewritten in place", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "shot.png"), OLD_PNG);
    commitAll(repoDir, "initial");
    const compare = { mode: "uncommitted", includeStructured: true } as const;
    const revisionOf = async () =>
      (await getCheckoutDiff(repoDir, compare)).structured?.find((file) => file.path === "shot.png")
        ?.revision;

    writeFileSync(join(repoDir, "shot.png"), NEW_PNG);
    const first = await revisionOf();
    writeFileSync(join(repoDir, "shot.png"), Buffer.concat([NEW_PNG, NEW_PNG]));
    const second = await revisionOf();

    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it("reports images over the size cap without reading them", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "README.md"), "x\n");
    commitAll(repoDir, "initial");
    const size = 8 * 1024 * 1024 + 1;
    writeFileSync(join(repoDir, "huge.png"), Buffer.alloc(size));

    expect(
      await getCheckoutDiffImage({ cwd: repoDir, path: "huge.png", source: uncommitted }),
    ).toEqual({ old: { status: "missing" }, new: { status: "too_large", size } });
  });

  it("rejects paths that are not supported images", async () => {
    const repoDir = initRepo();
    await expect(
      getCheckoutDiffImage({ cwd: repoDir, path: "notes.txt", source: uncommitted }),
    ).rejects.toThrow("Not a supported image");
  });
});

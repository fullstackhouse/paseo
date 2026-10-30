import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPrAgentPrompt, findPullRequestTemplate } from "./pr-agent-prompt.js";

describe("buildPrAgentPrompt", () => {
  it("targets the base branch and leaves out optional sections", () => {
    const prompt = buildPrAgentPrompt({
      forge: "github",
      baseBranch: "main",
      diffBase: "main",
      template: null,
      preferences: null,
      merge: false,
    });

    expect(prompt).toContain("The user requested a PR.");
    expect(prompt).toContain("`git diff main...HEAD`");
    expect(prompt).toContain(
      "`gh pr create --base main` to create a PR onto the target branch `main`.",
    );
    expect(prompt).not.toContain("## PR Description Template");
    expect(prompt).not.toContain("<user-preferences>");
    expect(prompt).not.toContain("## Merge");
  });

  it("includes the repo template and the user's preferences", () => {
    const prompt = buildPrAgentPrompt({
      forge: "github",
      baseBranch: "fsh",
      diffBase: "origin/fsh",
      template: "## Summary\n\n## Test plan\n",
      preferences: "  Use conventional commit titles.  ",
      merge: false,
    });

    expect(prompt).toContain(
      "## PR Description Template\n\nThis workspace has a PR template, which is provided below. Use it for writing the PR description, filling it in based on the changes made.\n\n```markdown\n## Summary\n\n## Test plan\n```",
    );
    expect(prompt).toContain(
      "## User Preferences\n<user-preferences>\nUse conventional commit titles.\n</user-preferences>",
    );
    expect(prompt.indexOf("## PR Description Template")).toBeLessThan(
      prompt.indexOf("## User Preferences"),
    );
  });

  it("diffs against the comparison ref but targets the branch name", () => {
    const prompt = buildPrAgentPrompt({
      forge: "github",
      baseBranch: "main",
      diffBase: "upstream/main",
      template: null,
      preferences: null,
      merge: false,
    });

    expect(prompt).toContain("`git diff upstream/main...HEAD`");
    expect(prompt).toContain("`git log upstream/main..HEAD`");
    expect(prompt).toContain("`gh pr create --base main`");
  });

  it("uses the GitLab CLI and MR wording on GitLab", () => {
    const prompt = buildPrAgentPrompt({
      forge: "gitlab",
      baseBranch: "main",
      diffBase: "origin/main",
      template: "## Summary",
      preferences: null,
      merge: true,
    });

    expect(prompt).toContain("The user requested an MR.");
    expect(prompt).toContain("`glab mr create --target-branch main`");
    expect(prompt).toContain("## MR Description Template");
    expect(prompt).toContain("Merge the MR once it's green and mergeable.");
    expect(prompt).not.toContain("gh pr create");
  });

  it("uses tea on Gitea-family forges", () => {
    const prompt = buildPrAgentPrompt({
      forge: "codeberg",
      baseBranch: "main",
      diffBase: "origin/main",
      template: null,
      preferences: null,
      merge: false,
    });

    expect(prompt).toContain("`tea pulls create --base main`");
  });

  it("names no CLI without a known forge", () => {
    const prompt = buildPrAgentPrompt({
      forge: null,
      baseBranch: "main",
      diffBase: "main",
      template: null,
      preferences: null,
      merge: false,
    });

    expect(prompt).toContain(
      "Create a PR with the forge's CLI or web UI onto the target branch `main`.",
    );
    expect(prompt).not.toContain("gh pr create");
  });

  it("treats blank preferences as none", () => {
    const prompt = buildPrAgentPrompt({
      forge: "github",
      baseBranch: "main",
      diffBase: "main",
      template: "   ",
      preferences: "\n  ",
      merge: false,
    });

    expect(prompt).not.toContain("## PR Description Template");
    expect(prompt).not.toContain("IMPORTANT:");
  });

  it("asks the agent to merge when requested", () => {
    const prompt = buildPrAgentPrompt({
      forge: "github",
      baseBranch: "main",
      diffBase: "main",
      template: null,
      preferences: null,
      merge: true,
    });

    expect(prompt).toContain("## Merge");
    expect(prompt).toContain("Merge the PR once it's green and mergeable.");
  });
});

describe("findPullRequestTemplate", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "pr-agent-prompt-"));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("returns null without a template", async () => {
    expect(await findPullRequestTemplate(repoRoot)).toBeNull();
  });

  it("finds an upper-case template in .github", async () => {
    await mkdir(join(repoRoot, ".github"));
    await writeFile(join(repoRoot, ".github", "PULL_REQUEST_TEMPLATE.md"), "github template");

    expect(await findPullRequestTemplate(repoRoot)).toBe("github template");
  });

  it("prefers .github over the repo root and docs", async () => {
    await mkdir(join(repoRoot, ".github"));
    await mkdir(join(repoRoot, "docs"));
    await writeFile(join(repoRoot, "docs", "pull_request_template.md"), "docs template");
    await writeFile(join(repoRoot, "pull_request_template.md"), "root template");
    await writeFile(join(repoRoot, ".github", "pull_request_template.md"), "github template");

    expect(await findPullRequestTemplate(repoRoot)).toBe("github template");
  });

  it("falls back to docs", async () => {
    await mkdir(join(repoRoot, "docs"));
    await writeFile(join(repoRoot, "docs", "pull_request_template.md"), "docs template");

    expect(await findPullRequestTemplate(repoRoot)).toBe("docs template");
  });
});

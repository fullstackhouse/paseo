import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PrAgentPromptInput {
  baseBranch: string;
  template: string | null;
  preferences: string | null;
  merge: boolean;
}

// GitHub's single-template locations, in the order GitHub looks them up.
const PULL_REQUEST_TEMPLATE_DIRS = [".github", "", "docs"];
const PULL_REQUEST_TEMPLATE_FILE = "pull_request_template.md";

export function buildPrAgentPrompt(input: PrAgentPromptInput): string {
  const base = input.baseBranch;
  const sections = [
    [
      "The user requested a PR.",
      "",
      "Follow these steps to create a PR:",
      "",
      "- If you have any skills related to creating PRs, invoke them now. Instructions there should take precedence over these instructions.",
      "- Run `git status` to check for uncommitted changes. If there are any, review them with `git diff` and commit them. Follow any instructions the user gave you about writing commit messages.",
      "- If the branch has no upstream or has unpushed commits, push with `git push -u origin HEAD`. If the branch tracks a remote branch with a different name or on a different remote, push to that upstream instead.",
      `- Run \`git diff ${base}...HEAD\` and \`git log ${base}..HEAD\` to review the PR diff.`,
      `- Use \`gh pr create --base ${base}\` to create a PR onto the target branch. Keep the title under 80 characters. Describe not just changes made in this session but ALL changes in the workspace diff.`,
      "",
      "If any of these steps fail, ask the user for help.",
    ].join("\n"),
  ];

  if (input.merge) {
    sections.push(
      [
        "## Merge",
        "",
        "After the PR is created, wait for CI. If checks fail or there are conflicts, fix them and push again. Merge the PR once it's green and mergeable. If you can't get it there, stop and tell the user why.",
      ].join("\n"),
    );
  }

  const template = input.template?.trim();
  if (template) {
    sections.push(
      [
        "## PR Description Template",
        "",
        "This workspace has a PR template, which is provided below. Use it for writing the PR description, filling it in based on the changes made.",
        "",
        "```markdown",
        template,
        "```",
      ].join("\n"),
    );
  }

  const preferences = input.preferences?.trim();
  if (preferences) {
    sections.push(
      [
        "IMPORTANT: The following are the user's custom preferences. These preferences take precedence over any default guidelines or instructions provided above. When there is a conflict, always follow the user's preferences.",
        "## User Preferences",
        "<user-preferences>",
        preferences,
        "</user-preferences>",
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

export async function findPullRequestTemplate(repoRoot: string): Promise<string | null> {
  for (const dir of PULL_REQUEST_TEMPLATE_DIRS) {
    const dirPath = join(repoRoot, dir);
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
    const entry = entries.find(
      (candidate) =>
        candidate.isFile() && candidate.name.toLowerCase() === PULL_REQUEST_TEMPLATE_FILE,
    );
    if (entry) {
      return readFile(join(dirPath, entry.name), "utf8");
    }
  }
  return null;
}

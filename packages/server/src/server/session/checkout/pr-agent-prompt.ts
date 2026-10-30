import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getForgeDefinitionOrNeutral } from "@getpaseo/protocol/forge-manifest";

export interface PrAgentPromptInput {
  /** Forge id from the remote, e.g. "github" or "gitlab"; null without a known forge. */
  forge: string | null;
  /** Branch the change request targets, e.g. "main". */
  baseBranch: string;
  /** Ref the diff and log compare against, e.g. "origin/main". */
  diffBase: string;
  template: string | null;
  preferences: string | null;
  merge: boolean;
}

// GitHub's single-template locations, in the order GitHub looks them up.
const PULL_REQUEST_TEMPLATE_DIRS = [".github", "", "docs"];
const PULL_REQUEST_TEMPLATE_FILE = "pull_request_template.md";

const CREATE_COMMANDS: Record<string, (base: string) => string> = {
  github: (base) => `gh pr create --base ${base}`,
  gitlab: (base) => `glab mr create --target-branch ${base}`,
  gitea: (base) => `tea pulls create --base ${base}`,
  forgejo: (base) => `tea pulls create --base ${base}`,
  codeberg: (base) => `tea pulls create --base ${base}`,
};

// "a PR", "an MR": abbreviations are read letter by letter, so the first letter's name decides.
function withArticle(abbrev: string): string {
  return `${/^[AEFHILMNORSX]/.test(abbrev) ? "an" : "a"} ${abbrev}`;
}

function createStep(input: { forge: string | null; base: string; abbrev: string }): string {
  const command = input.forge ? CREATE_COMMANDS[input.forge]?.(input.base) : undefined;
  const how = command
    ? `Use \`${command}\` to create ${withArticle(input.abbrev)}`
    : `Create ${withArticle(input.abbrev)} with the forge's CLI or web UI`;
  return `- ${how} onto the target branch \`${input.base}\`. Keep the title under 80 characters. Describe not just changes made in this session but ALL changes in the workspace diff.`;
}

export function buildPrAgentPrompt(input: PrAgentPromptInput): string {
  const base = input.baseBranch;
  const diffBase = input.diffBase;
  const abbrev = input.forge ? getForgeDefinitionOrNeutral(input.forge).changeRequestAbbrev : "PR";
  const sections = [
    [
      `The user requested ${withArticle(abbrev)}.`,
      "",
      `Follow these steps to create ${withArticle(abbrev)}:`,
      "",
      `- If you have any skills related to creating ${abbrev}s, invoke them now. Instructions there should take precedence over these instructions.`,
      "- Run `git status` to check for uncommitted changes. If there are any, review them with `git diff` and commit them. Follow any instructions the user gave you about writing commit messages.",
      "- If the branch has no upstream or has unpushed commits, push with `git push -u origin HEAD`. If the branch tracks a remote branch with a different name or on a different remote, push to that upstream instead.",
      `- Run \`git diff ${diffBase}...HEAD\` and \`git log ${diffBase}..HEAD\` to review the ${abbrev} diff.`,
      createStep({ forge: input.forge, base, abbrev }),
      "",
      "If any of these steps fail, ask the user for help.",
    ].join("\n"),
  ];

  if (input.merge) {
    sections.push(
      [
        "## Merge",
        "",
        `After the ${abbrev} is created, wait for CI. If checks fail or there are conflicts, fix them and push again. Merge the ${abbrev} once it's green and mergeable. If you can't get it there, stop and tell the user why.`,
      ].join("\n"),
    );
  }

  const template = input.template?.trim();
  if (template) {
    sections.push(
      [
        `## ${abbrev} Description Template`,
        "",
        `This workspace has ${withArticle(abbrev)} template, which is provided below. Use it for writing the ${abbrev} description, filling it in based on the changes made.`,
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

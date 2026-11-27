import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The worker's fake `gh` (e2e-worker.ts) answers the daemon's batched pull request reads
 * (`PaseoChangeRequestRead`) and paseo-asks' review-buttons read for PRs in `paseo-e2e/attention-fixture`
 * from this state, so specs can drive PR state and GitHub's GraphQL rate limit without the network.
 */
export interface FakeGitHubPullRequest {
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
  isDraft?: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  headRefOid?: string;
  /** For paseo-asks' review-buttons read: whether the human can merge past a required review. */
  viewerCanMergeAsAdmin?: boolean;
  /** For paseo-asks' review-buttons read; defaults to `pr-author`. */
  author?: string;
}

export interface FakeGitHubState {
  /** Keyed `paseo-e2e/attention-fixture#<number>`; other repos pass through to the real `gh`. */
  prs: Record<string, FakeGitHubPullRequest>;
  /** GraphQL's own rateLimit; the daemon pauses reads at or under 40% remaining until `resetAt`. */
  rateLimit: { limit: number; remaining: number; resetAt: string } | null;
}

export interface FakeGitHubCall {
  at: number;
  /** `paseo-e2e/<repo>#<number>` for each PR the query asked for. */
  prs: string[];
  /** Set on paseo-asks' review-buttons read; absent on the daemon's batched reads. */
  read?: "review-buttons";
}

function fakeGitHubDir(): string {
  const dir = process.env.E2E_FAKE_GITHUB_DIR;
  if (!dir) throw new Error("E2E_FAKE_GITHUB_DIR is not set; is the e2e worker daemon running?");
  return dir;
}

export function fakePullRequestUrl(key: string): string {
  const match = /^paseo-e2e\/([^#]+)#(\d+)$/.exec(key);
  if (!match) throw new Error(`Fake GitHub keys look like paseo-e2e/<repo>#<n>, got ${key}`);
  return `https://github.com/paseo-e2e/${match[1]}/pull/${match[2]}`;
}

export async function setFakeGitHub(state: FakeGitHubState): Promise<void> {
  await writeFile(path.join(fakeGitHubDir(), "fake-github-state.json"), JSON.stringify(state));
}

export async function readFakeGitHubCalls(): Promise<FakeGitHubCall[]> {
  const file = path.join(fakeGitHubDir(), "fake-github-calls.jsonl");
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeGitHubCall);
}

export async function resetFakeGitHub(): Promise<void> {
  const dir = fakeGitHubDir();
  await rm(path.join(dir, "fake-github-state.json"), { force: true });
  await rm(path.join(dir, "fake-github-calls.jsonl"), { force: true });
}

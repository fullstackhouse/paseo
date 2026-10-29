import type { TFunction } from "i18next";

export interface GitSyncFacts {
  currentBranch?: string | null;
  isDirty?: boolean | null;
  aheadOfOrigin?: number | null;
  behindOfOrigin?: number | null;
  upstreamRef?: string | null;
}

export interface GitSyncCounts {
  ahead: number;
  behind: number;
}

export type GitSyncNextStep = "commit" | "pullThenPush" | "pull" | "push";

export function getGitSyncCounts(facts: GitSyncFacts): GitSyncCounts | null {
  const ahead = facts.aheadOfOrigin ?? 0;
  const behind = facts.behindOfOrigin ?? 0;
  return ahead > 0 || behind > 0 ? { ahead, behind } : null;
}

// True when the diff total needs explaining: uncommitted work, or commits that
// differ from the upstream. A clean, in-sync branch has nothing to say.
export function hasGitSyncDetails(facts: GitSyncFacts): boolean {
  return Boolean(facts.isDirty) || getGitSyncCounts(facts) !== null;
}

// Matches the header's primary git action: Commit wins, then Pull and push, Pull, Push.
export function getGitSyncNextStep(facts: GitSyncFacts): GitSyncNextStep | null {
  if (facts.isDirty) return "commit";
  const counts = getGitSyncCounts(facts);
  if (!counts) return null;
  if (counts.ahead > 0 && counts.behind > 0) return "pullThenPush";
  return counts.behind > 0 ? "pull" : "push";
}

// The wire only carries `upstreamRef` on the workspace status; elsewhere a tracked
// branch is assumed to follow `origin/<branch>`. Null when nothing is tracked.
export function getGitSyncUpstreamLabel(facts: GitSyncFacts): string | null {
  const upstream = facts.upstreamRef?.replace(/^refs\/remotes\//, "").trim();
  if (upstream) return upstream;
  if (facts.aheadOfOrigin == null && facts.behindOfOrigin == null) return null;
  return facts.currentBranch ? `origin/${facts.currentBranch}` : null;
}

export function buildGitSyncAccessibilityLabel(facts: GitSyncFacts, t: TFunction): string {
  const counts = getGitSyncCounts(facts);
  return [
    facts.isDirty ? t("workspace.git.sync.uncommitted") : null,
    counts && counts.ahead > 0 ? t("workspace.git.sync.toPush", { number: counts.ahead }) : null,
    counts && counts.behind > 0 ? t("workspace.git.sync.toPull", { number: counts.behind }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}

import type { TFunction } from "i18next";

export interface GitSyncFacts {
  isDirty?: boolean | null;
  aheadOfOrigin?: number | null;
  behindOfOrigin?: number | null;
  upstreamRef?: string | null;
}

export interface GitSyncCounts {
  ahead: number;
  behind: number;
}

export interface GitSyncModel {
  counts: GitSyncCounts | null;
  summary: string[];
}

export function buildGitSyncModel(facts: GitSyncFacts, t: TFunction): GitSyncModel | null {
  const summary = buildGitSyncSummary(facts, t);
  return summary.length > 0 ? { counts: getGitSyncCounts(facts), summary } : null;
}

export function getGitSyncCounts(facts: GitSyncFacts): GitSyncCounts | null {
  const ahead = facts.aheadOfOrigin ?? 0;
  const behind = facts.behindOfOrigin ?? 0;
  return ahead > 0 || behind > 0 ? { ahead, behind } : null;
}

// Splits a workspace diff total into where the changes live, so a clean tree with
// unpushed commits doesn't read as uncommitted work.
export function buildGitSyncSummary(facts: GitSyncFacts, t: TFunction): string[] {
  const upstream =
    facts.upstreamRef?.replace(/^refs\/remotes\//, "") || t("workspace.git.sync.remote");
  const lines: string[] = [];
  if (facts.isDirty) {
    lines.push(t("workspace.git.sync.uncommitted"));
  }
  if ((facts.aheadOfOrigin ?? 0) > 0) {
    lines.push(t("workspace.git.sync.unpushed", { number: facts.aheadOfOrigin }));
  }
  if ((facts.behindOfOrigin ?? 0) > 0) {
    lines.push(t("workspace.git.sync.behind", { number: facts.behindOfOrigin, upstream }));
  }
  return lines;
}

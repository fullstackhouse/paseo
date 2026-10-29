import { useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { DiffStat } from "@/components/diff-stat";
import { useTimeAgo } from "@/hooks/use-time-ago";
import {
  getGitSyncCounts,
  getGitSyncNextStep,
  getGitSyncUpstreamLabel,
  type GitSyncFacts,
} from "@/git/sync-summary";
import { useCheckoutCommitsQuery, type ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";

const MAX_LISTED_COMMITS = 3;

interface GitSyncCardProps {
  serverId: string;
  cwd: string;
  facts: GitSyncFacts;
}

// Mounted only while its tooltip is open, so the commit list and the uncommitted
// diff are fetched on demand rather than for every composer.
export function GitSyncCard({ serverId, cwd, facts }: GitSyncCardProps) {
  const { t } = useTranslation();
  const counts = getGitSyncCounts(facts);
  const upstream = getGitSyncUpstreamLabel(facts);
  const nextStep = getGitSyncNextStep(facts);
  return (
    <View style={styles.card} testID="git-sync-card">
      <View style={styles.header}>
        <Text style={styles.branch} numberOfLines={1}>
          {facts.currentBranch ?? "HEAD"}
        </Text>
        {upstream ? (
          <>
            <Text style={styles.muted}>→</Text>
            <Text style={styles.upstream} numberOfLines={1}>
              {upstream}
            </Text>
          </>
        ) : null}
      </View>
      {facts.isDirty ? <UncommittedSection serverId={serverId} cwd={cwd} /> : null}
      {counts && counts.ahead > 0 ? (
        <View style={styles.section}>
          <SectionLabel
            glyph="↑"
            label={t("workspace.git.sync.toPush", { number: counts.ahead })}
          />
          <UnpushedCommits serverId={serverId} cwd={cwd} ahead={counts.ahead} />
        </View>
      ) : null}
      {counts && counts.behind > 0 ? (
        <View style={styles.section}>
          <SectionLabel
            glyph="↓"
            label={t("workspace.git.sync.toPull", { number: counts.behind })}
          />
        </View>
      ) : null}
      {nextStep ? (
        <View style={styles.footer}>
          <Text style={styles.muted}>{t(`workspace.git.sync.next.${nextStep}`)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SectionLabel({ glyph, label }: { glyph: string; label: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.glyph}>{glyph}</Text>
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function UncommittedSection({ serverId, cwd }: { serverId: string; cwd: string }) {
  const { t } = useTranslation();
  const diff = useCheckoutDiffQuery({ serverId, cwd, mode: "uncommitted" });
  const totals = useMemo(
    () =>
      diff.files.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [diff.files],
  );
  const showCount = !diff.isLoading && !diff.isError && diff.files.length > 0;
  return (
    <View style={[styles.section, styles.sectionLabelRow]}>
      <Text style={styles.glyph}>●</Text>
      <Text style={styles.sectionLabel}>
        {showCount
          ? t("workspace.git.sync.filesUncommitted", { count: diff.files.length })
          : t("workspace.git.sync.uncommitted")}
      </Text>
      {showCount ? (
        <View style={styles.trailing}>
          <DiffStat additions={totals.additions} deletions={totals.deletions} />
        </View>
      ) : null}
    </View>
  );
}

function UnpushedCommits({
  serverId,
  cwd,
  ahead,
}: {
  serverId: string;
  cwd: string;
  ahead: number;
}) {
  const { t } = useTranslation();
  const query = useCheckoutCommitsQuery({ serverId, cwd });
  if (query.status !== "loaded") {
    return null;
  }
  const unpushed = query.data.commits.filter((commit) => !commit.isOnRemote);
  if (unpushed.length === 0) {
    return null;
  }
  const hidden = Math.max(ahead, unpushed.length) - MAX_LISTED_COMMITS;
  return (
    <View style={styles.commits}>
      {unpushed.slice(0, MAX_LISTED_COMMITS).map((commit) => (
        <UnpushedCommitRow key={commit.sha} commit={commit} />
      ))}
      {hidden > 0 ? (
        <Text style={styles.muted}>{t("workspace.git.sync.moreCommits", { number: hidden })}</Text>
      ) : null}
    </View>
  );
}

function UnpushedCommitRow({ commit }: { commit: ClassifiedCheckoutCommit }) {
  const timeAgo = useTimeAgo(new Date(commit.authorDate));
  return (
    <View style={styles.commit} testID={`git-sync-commit-${commit.shortSha}`}>
      <View style={styles.commitLine}>
        <Text dataSet={CODE_SURFACE_DATASET} style={styles.sha}>
          {commit.shortSha}
        </Text>
        <Text style={styles.subject} numberOfLines={1}>
          {commit.subject}
        </Text>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {commit.authorName} · {timeAgo}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: 300,
    paddingVertical: theme.spacing[1],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  branch: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  upstream: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1.5],
  },
  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  glyph: {
    width: theme.spacing[3],
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  trailing: {
    flex: 1,
    alignItems: "flex-end",
  },
  commits: {
    gap: theme.spacing[1.5],
    paddingLeft: theme.spacing[3] + theme.spacing[1.5],
  },
  commit: {
    gap: theme.spacing[0.5],
  },
  commitLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  sha: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  subject: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
}));

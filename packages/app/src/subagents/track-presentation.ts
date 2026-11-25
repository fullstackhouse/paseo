import type { TFunction } from "i18next";
import type { ComposerTrackPillSegment } from "@/composer/tracks";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { deriveSidebarStateBucket, STATUS_BUCKET_ORDER } from "@/utils/sidebar-agent-state";
import type { SubagentRow } from "./select";
import { providerSubagentLifecycleStatus } from "./provider-store";

function presentationStatus(row: SubagentRow) {
  if (row.kind === "paseo") {
    if (row.turn.phase === "open") return "running";
    return row.status === "running" ? "idle" : row.status;
  }
  return providerSubagentLifecycleStatus(row.status);
}

/** Below this a run has no duration worth reading, and "0s" would read as "did nothing". */
const MIN_SHOWN_WORK_MS = 1000;

export type SubagentRunTime =
  | { kind: "running"; since: Date }
  | { kind: "finished"; workedMs: number };

/**
 * How long the child has worked. A running child counts from a start moved back by its earlier
 * runs, so the timer continues from where the last run stopped.
 */
export function buildSubagentRunTime(work: SubagentRow["work"]): SubagentRunTime | null {
  if (!work) return null;
  if (work.runStartedAt) {
    return { kind: "running", since: new Date(work.runStartedAt.getTime() - work.workedMs) };
  }
  return work.workedMs < MIN_SHOWN_WORK_MS ? null : { kind: "finished", workedMs: work.workedMs };
}

export interface SubagentRowPresentationData {
  key: string;
  kind: "agent";
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  statusBucket: SidebarStateBucket | null;
}

export function buildSubagentRowPresentationData(row: SubagentRow): SubagentRowPresentationData {
  // The task distinguishes siblings in a fan-out, so it names the row when present. Providers
  // own the compact secondary context because model, effort, and usage semantics differ.
  const description = resolveRowLabel(row.description);
  const title = resolveRowLabel(row.title);
  const label = description ?? title;
  const providerSubtitle = row.kind === "provider" ? resolveRowLabel(row.subtitle) : null;
  const subtitle = providerSubtitle ?? (description ? title : null);
  const status = presentationStatus(row);
  return {
    key: `${row.kind}_subagent_${row.id}`,
    kind: "agent",
    label: label ?? "",
    subtitle: subtitle ?? "",
    titleState: label ? "ready" : "loading",
    statusBucket: deriveSidebarStateBucket({
      status,
      requiresAttention: false,
    }),
  };
}

type ActiveStatusBucket = Exclude<SidebarStateBucket, "done" | "blocked">;

/** The sidebar's list order, minus done (no mark) and blocked (workspaces only). */
const ACTIVE_STATUS_BUCKET_ORDER = STATUS_BUCKET_ORDER.filter(
  (bucket): bucket is ActiveStatusBucket => bucket !== "done" && bucket !== "blocked",
);

/** One state the pill reports, and how many children are in it. */
interface SubagentStatusCount {
  bucket: ActiveStatusBucket;
  count: number;
}

/** Everything the pill draws. Built together so no mark can end up next to another one's count. */
export interface SubagentPillPresentation {
  segments: ComposerTrackPillSegment[];
  accessibilityLabel: string;
}

/**
 * What the pill says about a fan-out, and which marks it says it with.
 *
 * A mark and a number sitting together answer the same question, so the pill cannot collapse a
 * mixed fan-out into the most urgent state the way a sidebar project row does: a red dot beside
 * "1 failed" over a child that is still working says the fan-out has stopped. Every state present
 * gets its own mark and its own count, in the order the sidebar's status groups list them.
 *
 * It stays one line because subagent rows only ever reach three states — see
 * `buildSubagentRowPresentationData`, which reports no attention of its own — so the pill is two
 * segments at worst, and falls back to naming what it opens once nothing is happening.
 */
export function buildSubagentPillPresentation(
  t: TFunction,
  rows: readonly SubagentRow[],
): SubagentPillPresentation {
  const counts = summarizeSubagentStatus(rows);
  if (counts.length === 0) {
    const label = totalLabel(t, rows.length);
    return { segments: [{ bucket: null, text: label }], accessibilityLabel: label };
  }
  const labels = counts.map(({ bucket, count }) => statusLabel(t, bucket, count));
  return {
    segments: counts.map(({ bucket }, index) => ({ bucket, text: labels[index] ?? "" })),
    // Marks separate the segments on screen; a screen reader needs the pause spelled out.
    accessibilityLabel: labels.join(", "),
  };
}

/** Wording comes from the sidebar's status groups — one name per state across the whole app. */
function statusLabel(t: TFunction, bucket: ActiveStatusBucket, count: number): string {
  switch (bucket) {
    case "running":
      return t("subagents.pillLabelWorking", { count });
    case "failed":
      return t("subagents.pillLabelFailed", { count });
    case "needs_input":
      return count === 1
        ? t("subagents.pillLabelNeedsInputOne")
        : t("subagents.pillLabelNeedsInputMany", { count });
    case "attention":
      return t("subagents.pillLabelReadyToReview", { count });
  }
}

/** Nothing is happening, so the pill is back to naming what it opens. */
function totalLabel(t: TFunction, total: number): string {
  return total === 1 ? t("subagents.pillLabelOne") : t("subagents.pillLabelMany", { count: total });
}

/**
 * Empty when every child is done: a finished fan-out is not worth a colour above the composer.
 */
function summarizeSubagentStatus(rows: readonly SubagentRow[]): SubagentStatusCount[] {
  const buckets = rows.map((row) => buildSubagentRowPresentationData(row).statusBucket);
  return ACTIVE_STATUS_BUCKET_ORDER.flatMap((bucket) => {
    const count = buckets.filter((candidate) => candidate === bucket).length;
    return count > 0 ? [{ bucket, count }] : [];
  });
}

export function resolveRowLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

/** The list's groups, in the order you act on them: what failed, what waits on you, what runs. */
export type SubagentGroupKey = "failed" | "needs_input" | "working" | "done";

export interface SubagentGroup {
  key: SubagentGroupKey;
  rows: SubagentRow[];
}

const SUBAGENT_GROUP_ORDER: readonly SubagentGroupKey[] = [
  "failed",
  "needs_input",
  "working",
  "done",
];

function subagentGroupKey(row: SubagentRow): SubagentGroupKey {
  switch (buildSubagentRowPresentationData(row).statusBucket) {
    case "failed":
      return "failed";
    case "needs_input":
      return "needs_input";
    case "running":
      return "working";
    default:
      return "done";
  }
}

/**
 * Rows split by what they ask of you, empty groups left out. A failure sorts first because the
 * pill already announced it; done work sorts last because it asks for nothing. Rows keep their
 * incoming order inside a group.
 */
export function groupSubagentRows(rows: readonly SubagentRow[]): SubagentGroup[] {
  const byKey = new Map<SubagentGroupKey, SubagentRow[]>();
  for (const row of rows) {
    const key = subagentGroupKey(row);
    const group = byKey.get(key);
    if (group) group.push(row);
    else byKey.set(key, [row]);
  }
  return SUBAGENT_GROUP_ORDER.flatMap((key) => {
    const groupRows = byKey.get(key);
    return groupRows ? [{ key, rows: groupRows }] : [];
  });
}

const FACT_SEPARATOR = " · ";

/**
 * Each row's subtitle without the facts every sibling shares. A fan-out runs one agent type on one
 * model at one effort, so "general-purpose · Opus · Medium" on every row says nothing about any of
 * them; what differs (tokens, a lone Explore) is what tells two rows apart. Keyed by row id. A
 * lone subtitle is kept whole: with nothing to compare against, nothing is repeated.
 */
export function distinctSubagentSubtitles(rows: readonly SubagentRow[]): Map<string, string> {
  const facts = new Map<string, string[]>();
  for (const row of rows) {
    const subtitle = buildSubagentRowPresentationData(row).subtitle;
    if (subtitle) facts.set(row.id, subtitle.split(FACT_SEPARATOR));
  }
  const lists = [...facts.values()];
  const shared =
    lists.length < 2
      ? new Set<string>()
      : new Set(lists[0]?.filter((fact) => lists.every((list) => list.includes(fact))));
  const result = new Map<string, string>();
  for (const [id, list] of facts) {
    result.set(id, list.filter((fact) => !shared.has(fact)).join(FACT_SEPARATOR));
  }
  return result;
}

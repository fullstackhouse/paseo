import { useMemo, useSyncExternalStore } from "react";
import {
  workspaceSummaryStore,
  type WorkspaceSummaryItem,
} from "@/plugins/workspace-summary/store";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

/** What plugins say about an idle workspace's work, folded across their summary items. */
export type ReportedWork = "needs_you" | "blocked" | "working" | "done";

export type ReportedWorkLookup = (serverId: string, workspaceId: string) => ReportedWork | null;

/** Most to least telling: done only when nothing else is reported. */
const REPORTED_WORK_RANK: readonly ReportedWork[] = ["needs_you", "working", "blocked", "done"];

function reportedWorkOf(item: WorkspaceSummaryItem): ReportedWork | null {
  if (item.needsYou || item.workState === "waiting") return "needs_you";
  return item.workState ?? null;
}

/**
 * Something waiting on the human wins, then any work still going, then work waiting on something
 * else (other workspaces, a reviewer, CI); done only when nothing else is reported.
 */
export function foldReportedWork(items: readonly WorkspaceSummaryItem[]): ReportedWork | null {
  let result: ReportedWork | null = null;
  for (const item of items) {
    const reported = reportedWorkOf(item);
    if (
      reported !== null &&
      (result === null || REPORTED_WORK_RANK.indexOf(reported) < REPORTED_WORK_RANK.indexOf(result))
    ) {
      result = reported;
    }
  }
  return result;
}

interface TurnStatus {
  status: SidebarStateBucket;
  /** Running only because an idle agent's background shells or monitors are live. */
  runningFromBackgroundWork?: boolean;
}

interface StatusWithTime extends TurnStatus {
  enteredAt: Date | null;
}

const REPORTED_WORK_STATUS = {
  needs_you: "attention",
  blocked: "blocked",
  working: "running",
  done: "done",
} as const satisfies Record<ReportedWork, SidebarStateBucket>;

/**
 * Whether the report, not the turn, decides the workspace's group. A running agent, a failure or a
 * permission prompt is live state and always wins; "Ready to review", "Done" and a Running held
 * only by an idle agent's background work (a dev server) are open to the report. Read/unread act
 * on the turn status, so they are hidden while this holds.
 */
export function isStatusDecidedByReport(
  turn: TurnStatus,
  reported: ReportedWork | null | undefined,
): reported is ReportedWork {
  if (reported == null) return false;
  if (turn.status === "running") return turn.runningFromBackgroundWork === true;
  return turn.status === "attention" || turn.status === "done";
}

/** Regroups an idle workspace by what was reported. */
export function applyReportedWork(
  base: StatusWithTime,
  reported: ReportedWork | null | undefined,
): StatusWithTime {
  if (!isStatusDecidedByReport(base, reported)) return base;
  const status = REPORTED_WORK_STATUS[reported];
  return status === base.status ? base : { status, enteredAt: base.enteredAt };
}

/** Folds every summary item once, keyed by host and workspace. */
export function createReportedWorkLookup(
  entries: readonly WorkspaceSummaryItem[],
): ReportedWorkLookup {
  const grouped = new Map<string, WorkspaceSummaryItem[]>();
  for (const entry of entries) {
    const key = `${entry.serverId}:${entry.workspaceId}`;
    const list = grouped.get(key);
    if (list) list.push(entry);
    else grouped.set(key, [entry]);
  }
  const folded = new Map<string, ReportedWork | null>();
  for (const [key, items] of grouped) folded.set(key, foldReportedWork(items));
  return (serverId, workspaceId) => folded.get(`${serverId}:${workspaceId}`) ?? null;
}

/** The lookup status derivation takes; a new one whenever a plugin updates a summary item. */
export function useReportedWorkLookup(): ReportedWorkLookup {
  const entries = useSyncExternalStore(
    workspaceSummaryStore.subscribe,
    workspaceSummaryStore.getSnapshot,
    workspaceSummaryStore.getSnapshot,
  );
  return useMemo(() => createReportedWorkLookup(entries), [entries]);
}

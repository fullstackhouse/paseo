import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  workspaceSummaryStore,
  type WorkspaceSummaryItem,
} from "@/plugins/workspace-summary/store";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { WorkspaceManualGroup } from "@getpaseo/protocol/messages";
import type { MovementContext } from "./moving";
import {
  deriveWorkspaceAttention,
  nextAttentionChangeAt,
  type InProgressTally,
  type ReportedWork,
  type WorkspaceAttention,
} from "./attention";

export type { InProgressTally, ReportedWork } from "./attention";

export type ReportedWorkLookup = ((
  serverId: string,
  workspaceId: string,
  /** The workspace's turn status; a running workspace counts as live work for its entries. */
  turn?: TurnStatus,
) => ReportedWork | null) & {
  /** When the newest agent status among the workspace's items was written (epoch ms), if any. */
  updatedAt?: (serverId: string, workspaceId: string) => number | null;
  /** The workspace's in-progress entries, counted; null when it has none. */
  inProgress?: (serverId: string, workspaceId: string, turn?: TurnStatus) => InProgressTally | null;
  /** What the items report on their own, without their in-progress entries. */
  items?: (serverId: string, workspaceId: string) => ReportedWork | null;
};

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
  return isOpenToRegrouping(turn);
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

const MANUAL_GROUP_STATUS = {
  attention: "attention",
  done: "done",
  blocked: "blocked",
} as const satisfies Record<WorkspaceManualGroup["group"], SidebarStateBucket>;

/** Whether the workspace is idle enough for a report or a move by hand to decide its group. */
export function isOpenToRegrouping(turn: TurnStatus): boolean {
  if (turn.status === "running") return turn.runningFromBackgroundWork === true;
  return turn.status === "attention" || turn.status === "done";
}

/**
 * Puts an idle workspace in the group the user moved it to. Live state still wins, and an agent
 * status written after the move (`reportedAt`) ends it; the host ends it when a turn starts.
 */
export function applyManualGroup(
  turn: TurnStatus,
  current: StatusWithTime,
  manual: WorkspaceManualGroup | null | undefined,
  reportedAt: number | null | undefined,
): StatusWithTime {
  if (!manual || !isOpenToRegrouping(turn)) return current;
  const setAt = Date.parse(manual.setAt);
  if (reportedAt != null && !Number.isNaN(setAt) && reportedAt > setAt) return current;
  const status = MANUAL_GROUP_STATUS[manual.group];
  return status === current.status ? current : { status, enteredAt: current.enteredAt };
}

/**
 * The movement context the sidebar can see for a workspace. Every source that makes Overview call an
 * entry moving (its agent's turn, a background shell, a monitor) also holds the workspace's status
 * at running, so an idle workspace has none and a running one counts as live work throughout.
 */
function sidebarMovement(turn: TurnStatus | undefined, now: number): MovementContext {
  return { runningAgentIds: NO_AGENTS, liveWork: turn?.status === "running", now };
}

const NO_AGENTS: ReadonlySet<string> = new Set();

/**
 * Decides every workspace's attention (`deriveWorkspaceAttention`), keyed by host and workspace, once
 * per movement context; `now` ages cards and in-progress entries.
 */
export function createReportedWorkLookup(
  entries: readonly WorkspaceSummaryItem[],
  now: number = Date.now(),
): ReportedWorkLookup {
  const grouped = new Map<string, WorkspaceSummaryItem[]>();
  for (const entry of entries) {
    const key = `${entry.serverId}:${entry.workspaceId}`;
    const list = grouped.get(key);
    if (list) list.push(entry);
    else grouped.set(key, [entry]);
  }
  const decided = new Map<string, WorkspaceAttention>();
  const attention = (serverId: string, workspaceId: string, turn?: TurnStatus) => {
    const key = `${serverId}:${workspaceId}`;
    const items = grouped.get(key);
    if (!items) return null;
    const movement = sidebarMovement(turn, now);
    const cacheKey = `${key}:${movement.liveWork}`;
    let result = decided.get(cacheKey);
    if (!result) {
      result = deriveWorkspaceAttention(items, movement);
      decided.set(cacheKey, result);
    }
    return result;
  };
  const lookup: ReportedWorkLookup = (serverId, workspaceId, turn) =>
    attention(serverId, workspaceId, turn)?.work ?? null;
  lookup.updatedAt = (serverId, workspaceId) => attention(serverId, workspaceId)?.updatedAt ?? null;
  lookup.inProgress = (serverId, workspaceId, turn) =>
    attention(serverId, workspaceId, turn)?.inProgress ?? null;
  lookup.items = (serverId, workspaceId) => attention(serverId, workspaceId)?.reported ?? null;
  return lookup;
}

/**
 * The lookup status derivation takes; a new one whenever a plugin updates a summary item, and when
 * time alone changes a workspace's attention (`nextAttentionChangeAt`), so it regroups without a
 * fixed tick.
 */
export function useReportedWorkLookup(): ReportedWorkLookup {
  const entries = useSyncExternalStore(
    workspaceSummaryStore.subscribe,
    workspaceSummaryStore.getSnapshot,
    workspaceSummaryStore.getSnapshot,
  );
  const [now, setNow] = useState(() => Date.now());
  const nextAt = useMemo(() => nextAttentionChangeAt(entries, now), [entries, now]);
  useEffect(() => {
    if (nextAt === null) return undefined;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, nextAt - Date.now()));
    return () => clearTimeout(id);
  }, [nextAt]);
  return useMemo(() => createReportedWorkLookup(entries, now), [entries, now]);
}

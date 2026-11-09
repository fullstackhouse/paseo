import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";

export interface ScheduleRunView {
  id: string;
  badge: { label: string; variant: "success" | "error" | "muted" };
  startedLabel: string;
  /** "Took 4m 12s" once ended, "Running for 1m" while running. */
  durationLabel: string;
  error: string | null;
  agentId: string | null;
  workspaceId: string | null;
}

const BADGES: Record<ScheduleRun["status"], ScheduleRunView["badge"]> = {
  running: { label: "Running", variant: "muted" },
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed", variant: "error" },
};

export function describeScheduleRun(run: ScheduleRun, now: Date): ScheduleRunView {
  const startedAt = new Date(run.startedAt);
  const endedAt = run.endedAt ? new Date(run.endedAt) : null;
  const elapsed = formatDuration((endedAt ?? now).getTime() - startedAt.getTime());
  return {
    id: run.id,
    badge: BADGES[run.status],
    startedLabel: formatMessageTimestamp(startedAt, now),
    durationLabel: endedAt ? `Took ${elapsed}` : `Running for ${elapsed}`,
    error: run.status === "failed" ? (run.error?.trim() ?? null) || null : null,
    agentId: run.agentId,
    workspaceId: run.workspaceId ?? null,
  };
}

/** The daemon returns runs oldest-first; the sheet reads newest-first. */
export function describeScheduleRuns(runs: readonly ScheduleRun[], now: Date): ScheduleRunView[] {
  return [...runs]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .map((run) => describeScheduleRun(run, now));
}

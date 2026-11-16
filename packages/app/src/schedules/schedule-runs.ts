import {
  isScheduleRunAwaitingAttention,
  type ScheduleRun,
} from "@getpaseo/protocol/schedule/types";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";

export interface ScheduleRunView {
  id: string;
  status: ScheduleRun["status"];
  badge: { label: string; variant: "success" | "warning" | "error" | "muted" };
  startedLabel: string;
  /** "Took 4m 12s" once ended, "Running for 1m" while running. */
  durationLabel: string;
  error: string | null;
  /** Why the run needs you, while nobody has dealt with it yet. */
  attentionMessage: string | null;
  /** The agent's final message: what the run reports it did. */
  output: string | null;
  agentId: string | null;
  workspaceId: string | null;
}

const NEEDS_YOU_BADGE: ScheduleRunView["badge"] = { label: "Needs you", variant: "warning" };

const BADGES: Record<ScheduleRun["status"], ScheduleRunView["badge"]> = {
  running: { label: "Running", variant: "muted" },
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed", variant: "error" },
};

function trimToNull(value: string | null): string | null {
  return value?.trim() || null;
}

export function describeScheduleRun(run: ScheduleRun, now: Date): ScheduleRunView {
  const startedAt = new Date(run.startedAt);
  const endedAt = run.endedAt ? new Date(run.endedAt) : null;
  const elapsed = formatDuration((endedAt ?? now).getTime() - startedAt.getTime());
  return {
    id: run.id,
    status: run.status,
    badge: isScheduleRunAwaitingAttention(run) ? NEEDS_YOU_BADGE : BADGES[run.status],
    startedLabel: formatMessageTimestamp(startedAt, now),
    durationLabel: endedAt ? `Took ${elapsed}` : `Running for ${elapsed}`,
    error: run.status === "failed" ? trimToNull(run.error) : null,
    attentionMessage:
      isScheduleRunAwaitingAttention(run) && run.status !== "failed"
        ? trimToNull(run.attention?.message ?? null)
        : null,
    output: trimToNull(run.output),
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

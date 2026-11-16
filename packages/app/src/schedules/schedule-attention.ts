import { isScheduleRunAwaitingAttention } from "@getpaseo/protocol/schedule/types";
import { resolveScheduleTitle } from "@/utils/schedule-format";
import { formatMessageTimestamp } from "@/utils/time";
import type { AggregatedSchedule } from "./aggregated-schedules";

/** A finished scheduled run that is waiting on you, ready for the Needs you list. */
export interface ScheduleAttentionItem {
  key: string;
  serverId: string;
  serverName: string;
  scheduleId: string;
  scheduleTitle: string;
  runId: string;
  reasonLabel: string;
  message: string | null;
  startedAt: string;
  startedLabel: string;
  agentId: string | null;
  workspaceId: string | null;
}

const REASON_LABELS: Record<string, string> = {
  failed: "Failed",
  permission: "Waiting for permission",
  plugin: "Needs you",
};

/** Unknown reasons come from a newer host; they still need you. */
function describeReason(reason: string): string {
  return REASON_LABELS[reason] ?? "Needs you";
}

/** Every unresolved run across hosts, newest first. Hosts without the feature contribute none. */
export function collectScheduleAttention(
  schedules: readonly AggregatedSchedule[],
  now: Date,
): ScheduleAttentionItem[] {
  const items: ScheduleAttentionItem[] = [];
  for (const schedule of schedules) {
    for (const run of schedule.attentionRuns ?? []) {
      if (!isScheduleRunAwaitingAttention(run) || !run.attention) continue;
      items.push({
        key: `${schedule.serverId}:${schedule.id}:${run.id}`,
        serverId: schedule.serverId,
        serverName: schedule.serverName,
        scheduleId: schedule.id,
        scheduleTitle: resolveScheduleTitle(schedule),
        runId: run.id,
        reasonLabel: describeReason(run.attention.reason),
        message: run.attention.message?.trim() || null,
        startedAt: run.startedAt,
        startedLabel: formatMessageTimestamp(new Date(run.startedAt), now),
        agentId: run.agentId,
        workspaceId: run.workspaceId ?? null,
      });
    }
  }
  return items.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

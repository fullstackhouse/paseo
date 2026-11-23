// FSH fork: agents whose turn failed on a network or provider outage, offered for retry together.
import { classifyAgentError } from "@getpaseo/protocol/agent-error-kind";
import type { Agent } from "@/stores/session-store";

type FailedCandidate = Pick<
  Agent,
  "serverId" | "id" | "status" | "lastError" | "archivedAt" | "updatedAt"
>;

/** A usage limit or a broken prompt fails again on retry, so only outages count. */
export function isRetryableFailure(agent: FailedCandidate): boolean {
  if (agent.status !== "error" || agent.archivedAt) return false;
  return classifyAgentError(agent.lastError) === "transient";
}

export function selectRetryableFailedAgents<T extends FailedCandidate>(
  sessions: Record<string, { agents: ReadonlyMap<string, T> }>,
): T[] {
  const result: T[] = [];
  for (const session of Object.values(sessions)) {
    for (const agent of session.agents.values()) {
      if (isRetryableFailure(agent)) result.push(agent);
    }
  }
  return result;
}

/** Changes when any of them fails again, so dismissing one outage's callout doesn't hide the next. */
export function failedAgentsDismissalKey(agents: readonly FailedCandidate[]): string {
  let latest = 0;
  for (const agent of agents) {
    latest = Math.max(latest, agent.updatedAt.getTime());
  }
  return `failed-agents:${latest}`;
}

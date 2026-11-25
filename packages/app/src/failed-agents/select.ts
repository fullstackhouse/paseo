// FSH fork: agents whose turn failed on a network or provider outage, offered for retry together.
import { classifyAgentError } from "@getpaseo/protocol/agent-error-kind";
import type { Agent } from "@/stores/session-store";

type FailedCandidate = Pick<
  Agent,
  "serverId" | "id" | "status" | "lastError" | "archivedAt" | "updatedAt"
>;

type Sessions<T> = Record<string, { agents: ReadonlyMap<string, T> }>;

export function isFailedAgent(agent: FailedCandidate): boolean {
  return agent.status === "error" && !agent.archivedAt;
}

/** A usage limit or a broken prompt fails again on retry, so the callout offers only outages. */
export function isRetryableFailure(agent: FailedCandidate): boolean {
  return isFailedAgent(agent) && classifyAgentError(agent.lastError) === "transient";
}

function selectAgents<T extends FailedCandidate>(
  sessions: Sessions<T>,
  matches: (agent: T) => boolean,
): T[] {
  const result: T[] = [];
  for (const session of Object.values(sessions)) {
    for (const agent of session.agents.values()) {
      if (matches(agent)) result.push(agent);
    }
  }
  return result;
}

export function selectRetryableFailedAgents<T extends FailedCandidate>(sessions: Sessions<T>): T[] {
  return selectAgents(sessions, isRetryableFailure);
}

/** Every failed agent, whatever the error: the palette retries them on request, e.g. after a usage limit resets. */
export function selectFailedAgents<T extends FailedCandidate>(sessions: Sessions<T>): T[] {
  return selectAgents(sessions, isFailedAgent);
}

/** Changes when any of them fails again, so dismissing one outage's callout doesn't hide the next. */
export function failedAgentsDismissalKey(agents: readonly FailedCandidate[]): string {
  let latest = 0;
  for (const agent of agents) {
    latest = Math.max(latest, agent.updatedAt.getTime());
  }
  return `failed-agents:${latest}`;
}

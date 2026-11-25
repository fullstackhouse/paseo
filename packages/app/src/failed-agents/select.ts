// FSH fork: failed agents, offered for retry together. Outage failures alone back the sidebar callout.
import { classifyAgentError } from "@getpaseo/protocol/agent-error-kind";
import type { Agent } from "@/stores/session-store";

type FailedCandidate = Pick<
  Agent,
  "serverId" | "id" | "title" | "status" | "lastError" | "archivedAt" | "updatedAt"
>;

type Sessions = Record<string, { agents: ReadonlyMap<string, FailedCandidate> }>;

function isFailedAgent(agent: FailedCandidate): boolean {
  return agent.status === "error" && !agent.archivedAt;
}

/** A usage limit or a broken prompt fails again on retry, so the callout offers only outages. */
export function isRetryableFailure(agent: FailedCandidate): boolean {
  return isFailedAgent(agent) && classifyAgentError(agent.lastError) === "transient";
}

const failedByAgents = new WeakMap<
  ReadonlyMap<string, FailedCandidate>,
  readonly FailedCandidate[]
>();

/**
 * A host's failed agents. Session selectors run on every store write (stream chunks included),
 * and the store replaces a host's agents map whenever an agent changes, so the list is built
 * once per map.
 */
function failedAgentsOf(agents: ReadonlyMap<string, FailedCandidate>): readonly FailedCandidate[] {
  let failed = failedByAgents.get(agents);
  if (!failed) {
    failed = [...agents.values()].filter(isFailedAgent);
    failedByAgents.set(agents, failed);
  }
  return failed;
}

/** Every failed agent, whatever the error: the palette retries them on request, e.g. after a usage limit resets. */
export function selectFailedAgents(sessions: Sessions): FailedCandidate[] {
  return Object.values(sessions).flatMap((session) => failedAgentsOf(session.agents));
}

/** Changes when any of them fails again, so dismissing one outage's callout doesn't hide the next. */
export function failedAgentsDismissalKey(agents: readonly FailedCandidate[]): string {
  let latest = 0;
  for (const agent of agents) {
    latest = Math.max(latest, agent.updatedAt.getTime());
  }
  return `failed-agents:${latest}`;
}

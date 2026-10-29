// FSH fork: agents whose turn a daemon restart cut short, offered for resume in one callout.
import type { Agent } from "@/stores/session-store";

export const RESUME_INTERRUPTED_PROMPT =
  "Paseo restarted during your last turn, which interrupted it. Continue where you left off.";

type InterruptedCandidate = Pick<Agent, "serverId" | "id" | "status" | "archivedAt"> & {
  interruptedAt?: Date | null;
};

export function isAwaitingResume(agent: InterruptedCandidate): boolean {
  if (!agent.interruptedAt || agent.archivedAt) return false;
  // A running agent has already been resumed; its next snapshot clears the mark.
  return agent.status !== "running" && agent.status !== "initializing";
}

export function selectInterruptedAgents<T extends InterruptedCandidate>(
  sessions: Record<string, { agents: ReadonlyMap<string, T> }>,
): T[] {
  const result: T[] = [];
  for (const session of Object.values(sessions)) {
    for (const agent of session.agents.values()) {
      if (isAwaitingResume(agent)) result.push(agent);
    }
  }
  return result;
}

/** Changes with every restart, so dismissing one restart's callout doesn't hide the next. */
export function interruptedAgentsDismissalKey(agents: readonly InterruptedCandidate[]): string {
  let latest = 0;
  for (const agent of agents) {
    latest = Math.max(latest, agent.interruptedAt?.getTime() ?? 0);
  }
  return `interrupted-agents:${latest}`;
}

export function formatInterruptedAgentNames(
  titles: readonly (string | null)[],
  input: { untitled: string; more: (count: number) => string; limit?: number },
): string {
  const limit = input.limit ?? 3;
  const names = titles.slice(0, limit).map((title) => title?.trim() || input.untitled);
  const rest = titles.length - names.length;
  return rest > 0 ? [...names, input.more(rest)].join(", ") : names.join(", ");
}

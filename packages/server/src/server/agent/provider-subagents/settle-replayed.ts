import type { AgentProvider } from "../agent-sdk-types.js";
import type { ProviderSubagentInputEvent, ProviderSubagentStatus } from "./store.js";

export interface ReplayedSubagentEvent {
  provider: AgentProvider;
  event: ProviderSubagentInputEvent;
}

/**
 * Appends a `canceled` upsert for every replayed subagent whose history ends without an outcome.
 *
 * History is replayed into a fresh provider process, and a child that was running when the old one
 * died died with it. Left at "running" it would show as working forever and hold back the parent's
 * finish attention. A provider that does resume such a child reports it running again live.
 *
 * `liveRunningIds` names children a still-live process reported running before the replay (a
 * forced re-hydration after rewind); those are left running.
 */
export function settleReplayedSubagents(
  events: readonly ReplayedSubagentEvent[],
  liveRunningIds: ReadonlySet<string> = new Set(),
): ReplayedSubagentEvent[] {
  const statusById = new Map<string, { provider: AgentProvider; status: ProviderSubagentStatus }>();
  for (const { provider, event } of events) {
    if (event.type === "remove") {
      statusById.delete(event.id);
    } else if (event.type === "upsert") {
      const status = event.status ?? statusById.get(event.id)?.status ?? "running";
      statusById.set(event.id, { provider, status });
    }
  }
  const settled: ReplayedSubagentEvent[] = [...events];
  for (const [id, { provider, status }] of statusById) {
    if (status === "running" && !liveRunningIds.has(id)) {
      settled.push({ provider, event: { type: "upsert", id, status: "canceled" } });
    }
  }
  return settled;
}

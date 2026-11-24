import type { AgentProvider, AgentTimelineItem } from "../agent-sdk-types.js";
import { limitAgentTimelineItemContent } from "../agent-timeline-content.js";
import { InMemoryAgentTimelineStore } from "../agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
} from "../agent-timeline-store-types.js";

export type ProviderSubagentStatus = "running" | "completed" | "failed" | "canceled";

export interface ProviderSubagentDescriptor {
  id: string;
  parentAgentId: string;
  /** Direct provider-subagent parent. Null identifies a child of the managed agent. */
  parentSubagentId: string | null;
  provider: AgentProvider;
  title: string | null;
  description: string | null;
  status: ProviderSubagentStatus;
  createdAt: string;
  updatedAt: string;
  toolCallId: string | null;
  cwd: string | null;
  subtitle: string | null;
  /** Time in finished runs. Idle time between runs is not work. */
  workedMs: number;
  /** When the open run started, or null while the child is not running. */
  runStartedAt: string | null;
}

export type ProviderSubagentInputEvent =
  | {
      type: "upsert";
      id: string;
      title?: string | null;
      description?: string | null;
      /**
       * Omit to keep the stored status. A presentation-only upsert says nothing about whether the
       * child is still running, and must not revert a finished one.
       */
      status?: ProviderSubagentStatus;
      toolCallId?: string | null;
      cwd?: string | null;
      subtitle?: string | null;
      parentSubagentId?: string | null;
      timestamp?: string;
    }
  | {
      type: "timeline";
      id: string;
      item: AgentTimelineItem;
      timestamp?: string;
    }
  | { type: "remove"; id: string };

export type ProviderSubagentStoreEvent =
  | { type: "upsert"; subagent: ProviderSubagentDescriptor }
  | {
      type: "timeline";
      parentAgentId: string;
      subagentId: string;
      provider: AgentProvider;
      row: AgentTimelineRow;
      epoch: string;
    }
  | { type: "remove"; parentAgentId: string; subagentId: string };

function storeKey(parentAgentId: string, subagentId: string): string {
  return `${parentAgentId}\0${subagentId}`;
}

/**
 * Sticky upsert semantics for a descriptor field: an omitted value preserves what is stored, an
 * explicit `null` clears it. Providers observe these fields incrementally, so a partial upsert
 * must never blank fields it says nothing about.
 */
function stickyField<T>(next: T | undefined, previous: T | null | undefined): T | null {
  return next === undefined ? (previous ?? null) : next;
}

type ProviderSubagentWork = Pick<ProviderSubagentDescriptor, "workedMs" | "runStartedAt">;

function advanceWork(
  previous: ProviderSubagentDescriptor | undefined,
  lastRunEndedAt: string | undefined,
  next: Pick<ProviderSubagentDescriptor, "status" | "updatedAt">,
): ProviderSubagentWork {
  const { workedMs, runStartedAt } = previous ?? { workedMs: 0, runStartedAt: null };
  const timestamp = next.updatedAt;
  if (next.status === "running") {
    if (runStartedAt !== null) return { workedMs, runStartedAt };
    // A run that starts before the last one ended is history replayed over a finished child, so
    // its time is already in the total.
    const isReplay =
      lastRunEndedAt !== undefined && Date.parse(timestamp) < Date.parse(lastRunEndedAt);
    return { workedMs: isReplay ? 0 : workedMs, runStartedAt: timestamp };
  }
  if (runStartedAt === null) return { workedMs, runStartedAt };
  const runMs = Math.max(0, Date.parse(timestamp) - Date.parse(runStartedAt));
  return { workedMs: workedMs + runMs, runStartedAt: null };
}

export class ProviderSubagentStore {
  private readonly descriptors = new Map<string, ProviderSubagentDescriptor>();
  private readonly lastRunEndedAt = new Map<string, string>();
  private readonly timelines = new InMemoryAgentTimelineStore();

  apply(
    parentAgentId: string,
    provider: AgentProvider,
    event: ProviderSubagentInputEvent,
  ): ProviderSubagentStoreEvent {
    const key = storeKey(parentAgentId, event.id);
    if (event.type === "remove") {
      this.descriptors.delete(key);
      this.lastRunEndedAt.delete(key);
      this.timelines.delete(key);
      return { type: "remove", parentAgentId, subagentId: event.id };
    }

    if (event.type === "timeline") {
      if (!this.timelines.has(key)) {
        this.timelines.initialize(key);
      }
      const row = this.timelines.append(key, limitAgentTimelineItemContent(event.item), {
        timestamp: event.timestamp,
      });
      return {
        type: "timeline",
        parentAgentId,
        subagentId: event.id,
        provider,
        row,
        epoch: this.timelines.getEpoch(key),
      };
    }

    const previous = this.descriptors.get(key);
    if (!this.timelines.has(key)) {
      this.timelines.initialize(key);
    }
    const timestamp = event.timestamp ?? new Date().toISOString();
    const status = event.status ?? previous?.status ?? "running";
    const subagent: ProviderSubagentDescriptor = {
      id: event.id,
      parentAgentId,
      provider,
      title: stickyField(event.title, previous?.title),
      description: stickyField(event.description, previous?.description),
      status,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      toolCallId: stickyField(event.toolCallId, previous?.toolCallId),
      cwd: stickyField(event.cwd, previous?.cwd),
      subtitle: stickyField(event.subtitle, previous?.subtitle),
      parentSubagentId: stickyField(event.parentSubagentId, previous?.parentSubagentId),
      ...advanceWork(previous, this.lastRunEndedAt.get(key), { status, updatedAt: timestamp }),
    };
    if (previous?.runStartedAt && subagent.runStartedAt === null) {
      this.lastRunEndedAt.set(key, timestamp);
    }
    this.descriptors.set(key, subagent);
    return { type: "upsert", subagent };
  }

  list(parentAgentId: string): ProviderSubagentDescriptor[] {
    return [...this.descriptors.values()]
      .filter((subagent) => subagent.parentAgentId === parentAgentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listAll(): ProviderSubagentDescriptor[] {
    return [...this.descriptors.values()];
  }

  get(parentAgentId: string, subagentId: string): ProviderSubagentDescriptor | null {
    return this.descriptors.get(storeKey(parentAgentId, subagentId)) ?? null;
  }

  fetchTimeline(
    parentAgentId: string,
    subagentId: string,
    options?: AgentTimelineFetchOptions,
  ): AgentTimelineFetchResult {
    return this.timelines.fetch(storeKey(parentAgentId, subagentId), options);
  }

  deleteParent(parentAgentId: string): ProviderSubagentStoreEvent[] {
    const events: ProviderSubagentStoreEvent[] = [];
    for (const subagent of this.list(parentAgentId)) {
      const key = storeKey(parentAgentId, subagent.id);
      this.descriptors.delete(key);
      this.lastRunEndedAt.delete(key);
      this.timelines.delete(key);
      events.push({ type: "remove", parentAgentId, subagentId: subagent.id });
    }
    return events;
  }
}

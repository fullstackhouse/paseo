import { describe, expect, it } from "vitest";
import type { PluginWorkspaceAgentCard } from "@getpaseo/plugin/client";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { MovementContext } from "./moving";
import {
  deriveStatusCard,
  deriveWorkspaceAttention,
  nextAttentionChangeAt,
  unrecordedWaits,
  WORKING_GRACE_MS,
} from "./attention";

let nextKey = 0;
function item(fields: Partial<WorkspaceSummaryItem>): WorkspaceSummaryItem {
  return {
    entryKey: nextKey++,
    serverId: "s",
    pluginId: "paseo-status",
    itemId: "status",
    workspaceId: "w",
    title: "Status",
    ...fields,
  };
}

const NOW = 1_000_000_000;
const IDLE: MovementContext = { runningAgentIds: new Set(), liveWork: false, now: NOW };

function reportedOf(items: WorkspaceSummaryItem[]) {
  return deriveWorkspaceAttention(items, IDLE).reported;
}

function tallyOf(items: WorkspaceSummaryItem[], movement: MovementContext) {
  return deriveWorkspaceAttention(items, movement).inProgress;
}

function card(
  agentId: string,
  fields: Partial<PluginWorkspaceAgentCard>,
): PluginWorkspaceAgentCard {
  return { agentId, state: "working", updatedAt: NOW, ...fields };
}

const status = (...cards: PluginWorkspaceAgentCard[]) => item({ cards });

function asks(fields: Partial<WorkspaceSummaryItem>) {
  return item({ pluginId: "paseo-asks", itemId: "asks", title: "Asks", ...fields });
}

const openAsk = (id: string, agentId: string) => ({ id, title: id, agentId });
const inProgressAsk = (id: string, agentId: string) => ({ id, title: id, agentId, updatedAt: NOW });

function workOf(items: WorkspaceSummaryItem[]) {
  return deriveWorkspaceAttention(items, IDLE).work;
}

describe("deriveWorkspaceAttention from cards", () => {
  it("needs you while an unanswered card waits on you", () => {
    expect(workOf([status(card("a", { state: "waiting_on_you" }))])).toBe("needs_you");
    expect(
      workOf([
        status(card("a", { state: "waiting_on_you" })),
        asks({ needsYou: true, entries: [openAsk("A1", "a")] }),
      ]),
    ).toBe("needs_you");
  });

  it("leaves an answered waiting card to the turn state", () => {
    expect(workOf([status(card("a", { state: "waiting_on_you", answered: true }))])).toBeNull();
    expect(
      workOf([
        status(
          card("a", { state: "waiting_on_you", answered: true }),
          card("b", { state: "blocked" }),
        ),
      ]),
    ).toBeNull();
  });

  it("reads a waiting card blocked while its agent only holds an ask in progress", () => {
    const items = [
      status(card("a", { state: "waiting_on_you" })),
      asks({ inProgress: [{ ...inProgressAsk("A1", "a"), watched: true, waitingOnReview: true }] }),
    ];
    expect(deriveWorkspaceAttention(items, IDLE).reported).toBe("blocked");
    expect(unrecordedWaits(items)).toEqual([]);
  });

  it("reads a waiting card blocked while its children work elsewhere, unless it owns an open ask", () => {
    expect(workOf([status(card("a", { state: "waiting_on_you", liveChildren: ["c"] }))])).toBe(
      "blocked",
    );
    expect(
      workOf([
        status(card("a", { state: "waiting_on_you", liveChildren: ["c"] })),
        asks({ needsYou: true, entries: [openAsk("A1", "a")] }),
      ]),
    ).toBe("needs_you");
  });

  it("keeps a working card while live work backs it or within the grace", () => {
    const old = NOW - WORKING_GRACE_MS;
    expect(workOf([status(card("a", { updatedAt: NOW - 60_000 }))])).toBe("working");
    expect(workOf([status(card("a", { updatedAt: old }))])).toBeNull();
    expect(workOf([status(card("a", { updatedAt: old, live: true }))])).toBe("working");
    expect(workOf([status(card("a", { updatedAt: old, lastLiveAt: NOW - 60_000 }))])).toBe(
      "working",
    );
  });

  it("puts working over blocked, and done only when every card is done", () => {
    expect(workOf([status(card("a", {}), card("b", { state: "blocked" }))])).toBe("working");
    expect(workOf([status(card("a", { state: "blocked" }), card("b", { state: "done" }))])).toBe(
      "blocked",
    );
    expect(workOf([status(card("a", { state: "done" }), card("b", { state: "done" }))])).toBe(
      "done",
    );
    expect(workOf([status()])).toBeNull();
  });

  it("ignores the verdict an item with cards also sends", () => {
    expect(workOf([item({ cards: [card("a", { state: "done" })], workState: "waiting" })])).toBe(
      "done",
    );
  });

  it("gives the newest status card's time", () => {
    const at = (updatedAt: number) => ({ state: "done" as const, summary: "s", updatedAt });
    expect(
      deriveWorkspaceAttention([item({ status: at(10) }), item({ status: at(30) })], IDLE)
        .updatedAt,
    ).toBe(30);
  });
});

describe("unrecordedWaits", () => {
  it("lists every agent whose card waits on you without an open ask, by name", () => {
    const statusItem = status(
      card("a", { state: "waiting_on_you", updatedAt: 1 }),
      card("b", { state: "waiting_on_you", updatedAt: 2 }),
      card("c", { state: "waiting_on_you", answered: true }),
      card("d", { state: "done" }),
    );
    expect(unrecordedWaits([statusItem])).toEqual([
      { agentId: "a", item: statusItem, updatedAt: 1 },
      { agentId: "b", item: statusItem, updatedAt: 2 },
    ]);
  });

  it("counts only the agent's own open ask", () => {
    const statusItem = status(card("a", { state: "waiting_on_you" }));
    expect(unrecordedWaits([statusItem, asks({ entries: [openAsk("A1", "a")] })])).toEqual([]);
    expect(unrecordedWaits([statusItem, asks({ entries: [openAsk("A1", "other")] })])).toHaveLength(
      1,
    );
  });
});

describe("nextAttentionChangeAt", () => {
  it("wakes when a working card's grace ends or an entry stops moving", () => {
    expect(nextAttentionChangeAt([status(card("a", { updatedAt: NOW - 60_000 }))], NOW)).toBe(
      NOW - 60_000 + WORKING_GRACE_MS,
    );
    expect(nextAttentionChangeAt([status(card("a", { live: true }))], NOW)).toBeNull();
    expect(nextAttentionChangeAt([asks({ inProgress: [inProgressAsk("A1", "a")] })], NOW)).toBe(
      NOW + 10 * 60_000 + 1,
    );
  });
});

describe("deriveWorkspaceAttention without cards", () => {
  it("lets needs-you win, then working, then blocked, then done", () => {
    expect(reportedOf([item({ workState: "blocked" })])).toBe("blocked");
    expect(reportedOf([item({ workState: "blocked" }), item({ workState: "working" })])).toBe(
      "working",
    );
    expect(reportedOf([item({ workState: "blocked" }), item({ workState: "done" })])).toBe(
      "blocked",
    );
    expect(
      reportedOf([item({ workState: "blocked" }), item({ pluginId: "asks", needsYou: true })]),
    ).toBe("needs_you");
  });

  it("lets needs-you win, then working, then done", () => {
    expect(reportedOf([])).toBeNull();
    expect(reportedOf([item({ count: 1 })])).toBeNull();
    expect(reportedOf([item({ workState: "done" })])).toBe("done");
    expect(reportedOf([item({ workState: "working" }), item({ workState: "waiting" })])).toBe(
      "needs_you",
    );
    expect(reportedOf([item({ workState: "done" }), item({ workState: "working" })])).toBe(
      "working",
    );
    expect(
      reportedOf([item({ workState: "working" }), item({ pluginId: "asks", needsYou: true })]),
    ).toBe("needs_you");
  });
});

describe("deriveWorkspaceAttention in-progress tally", () => {
  const now = NOW;
  const idle = IDLE;
  const stale = { title: "t", updatedAt: now - 11 * 60_000 };
  const ci = { title: "t", watched: true, updatedAt: now };
  const review = { title: "t", watched: true, waitingOnReview: true, updatedAt: now };
  const asksWith = (
    ...entries: Array<Partial<NonNullable<WorkspaceSummaryItem["inProgress"]>[number]>>
  ) =>
    item({
      pluginId: "paseo-asks",
      itemId: "asks",
      inProgress: entries.map((entry, index) =>
        Object.assign({ id: `A${index}`, title: "t", updatedAt: now }, entry),
      ),
    });

  it("is null without entries", () => {
    expect(tallyOf([item({ workState: "working" })], idle)).toBeNull();
    expect(tallyOf([asksWith()], idle)).toBeNull();
  });

  it("works while CI watches an entry", () => {
    expect(tallyOf([asksWith(ci, ci)], idle)).toEqual({
      moving: 2,
      stuck: 0,
      awaitingReview: 0,
      work: "working",
    });
  });

  it("is blocked when every moving entry waits on a review", () => {
    expect(tallyOf([asksWith(review, review)], idle)).toEqual({
      moving: 2,
      stuck: 0,
      awaitingReview: 2,
      work: "blocked",
    });
  });

  it("works when CI and review are mixed", () => {
    expect(tallyOf([asksWith(ci, review)], idle)?.work).toBe("working");
  });

  it("keeps the moving majority's group over a stuck entry", () => {
    expect(tallyOf([asksWith(ci, ci, ci, stale)], idle)).toEqual({
      moving: 3,
      stuck: 1,
      awaitingReview: 0,
      work: "working",
    });
    expect(tallyOf([asksWith(review, review, stale)], idle)?.work).toBe("blocked");
  });

  it("needs the human once stuck entries are at least as many as moving ones", () => {
    expect(tallyOf([asksWith(ci, stale)], idle)?.work).toBe("needs_you");
    expect(tallyOf([asksWith(stale)], idle)).toEqual({
      moving: 0,
      stuck: 1,
      awaitingReview: 0,
      work: "needs_you",
    });
  });

  it("counts live work and a running agent as machines moving", () => {
    const live = { ...idle, liveWork: true };
    expect(tallyOf([asksWith(review, stale)], live)).toEqual({
      moving: 2,
      stuck: 0,
      awaitingReview: 1,
      work: "working",
    });
    const running = { ...idle, runningAgentIds: new Set(["agent-1"]) };
    expect(tallyOf([asksWith({ ...stale, agentId: "agent-1" })], running)?.work).toBe("working");
  });

  it("ignores waitingOnReview on an entry nothing watches", () => {
    const fresh = { title: "t", waitingOnReview: true, updatedAt: now };
    expect(tallyOf([asksWith(fresh)], idle)?.work).toBe("working");
  });
});

describe("deriveStatusCard", () => {
  const written = (updatedAt = NOW) => ({
    state: "waiting_on_you" as const,
    summary: "PR #65 needs a reviewer",
    updatedAt,
  });
  const statusItem = (...cards: PluginWorkspaceAgentCard[]) => item({ status: written(), cards });
  const review = {
    ...inProgressAsk("A1", "a"),
    title: "Request review on PR #65",
    waitingOn: "review requested",
    tone: "warning" as const,
  };

  it("shows Blocked, waiting on the agent's asks in progress", () => {
    const written1 = statusItem(card("a", { state: "waiting_on_you" }));
    expect(deriveStatusCard(written1, [written1, asks({ inProgress: [review] })])).toEqual({
      ...written(),
      state: "blocked",
      blockedBy: [
        {
          kind: "other",
          label: "Request review on PR #65",
          detail: "review requested",
          tone: "warning",
        },
      ],
    });
  });

  it("shows Blocked, waiting on children live elsewhere, by title", () => {
    const written1 = statusItem(card("a", { state: "waiting_on_you", liveChildren: ["c1", "c2"] }));
    const titles: Record<string, string> = { c1: "Fix the flaky test" };
    expect(deriveStatusCard(written1, [written1], (id) => titles[id] ?? null)?.blockedBy).toEqual([
      { kind: "agent", agentId: "c1", label: "Fix the flaky test" },
      { kind: "agent", agentId: "c2", label: "c2" },
    ]);
  });

  it("keeps the card while it needs you, is answered, or isn't the newest card's", () => {
    const needsYou = statusItem(card("a", { state: "waiting_on_you" }));
    expect(deriveStatusCard(needsYou, [needsYou])).toBe(needsYou.status);
    const withOpenAsk = [needsYou, asks({ entries: [openAsk("A2", "a")], inProgress: [review] })];
    expect(deriveStatusCard(needsYou, withOpenAsk)).toBe(needsYou.status);
    const older = statusItem(card("a", { state: "waiting_on_you", updatedAt: NOW - 1 }));
    expect(deriveStatusCard(older, [older, asks({ inProgress: [review] })])).toBe(older.status);
    expect(deriveStatusCard(null, [])).toBeNull();
  });
});

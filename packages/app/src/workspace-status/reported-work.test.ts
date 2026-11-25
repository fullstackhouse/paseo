import { describe, expect, it } from "vitest";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import {
  applyManualGroup,
  applyReportedWork,
  createReportedWorkLookup,
  foldInProgress,
  foldReportedWork,
  isStatusDecidedByReport,
} from "./reported-work";

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

const at = new Date("2026-11-12T10:00:00Z");

describe("foldReportedWork", () => {
  it("lets needs-you win, then working, then blocked, then done", () => {
    expect(foldReportedWork([item({ workState: "blocked" })])).toBe("blocked");
    expect(foldReportedWork([item({ workState: "blocked" }), item({ workState: "working" })])).toBe(
      "working",
    );
    expect(foldReportedWork([item({ workState: "blocked" }), item({ workState: "done" })])).toBe(
      "blocked",
    );
    expect(
      foldReportedWork([
        item({ workState: "blocked" }),
        item({ pluginId: "asks", needsYou: true }),
      ]),
    ).toBe("needs_you");
  });

  it("lets needs-you win, then working, then done", () => {
    expect(foldReportedWork([])).toBeNull();
    expect(foldReportedWork([item({ count: 1 })])).toBeNull();
    expect(foldReportedWork([item({ workState: "done" })])).toBe("done");
    expect(foldReportedWork([item({ workState: "working" }), item({ workState: "waiting" })])).toBe(
      "needs_you",
    );
    expect(foldReportedWork([item({ workState: "done" }), item({ workState: "working" })])).toBe(
      "working",
    );
    expect(
      foldReportedWork([
        item({ workState: "working" }),
        item({ pluginId: "asks", needsYou: true }),
      ]),
    ).toBe("needs_you");
  });
});

describe("applyReportedWork", () => {
  it("moves an unread finished turn to Working while the agent says it is still working", () => {
    expect(applyReportedWork({ status: "attention", enteredAt: at }, "working")).toEqual({
      status: "running",
      enteredAt: at,
    });
  });

  it("moves an unread finished turn to Done when the agent says it is done", () => {
    expect(applyReportedWork({ status: "attention", enteredAt: at }, "done").status).toBe("done");
  });

  it("raises a read workspace to Ready to review while something waits on the human", () => {
    expect(applyReportedWork({ status: "done", enteredAt: at }, "needs_you").status).toBe(
      "attention",
    );
  });

  it("moves a finished turn waiting on other workspaces, a reviewer or CI to Blocked", () => {
    expect(applyReportedWork({ status: "attention", enteredAt: at }, "blocked")).toEqual({
      status: "blocked",
      enteredAt: at,
    });
    expect(applyReportedWork({ status: "done", enteredAt: at }, "blocked").status).toBe("blocked");
  });

  it("never overrides live state", () => {
    for (const status of ["running", "failed", "needs_input"] as const) {
      const base = { status, enteredAt: at };
      expect(applyReportedWork(base, "done")).toBe(base);
      expect(applyReportedWork(base, "blocked")).toBe(base);
    }
  });

  it("lets the report group a workspace held Running only by background work", () => {
    const base = { status: "running" as const, runningFromBackgroundWork: true, enteredAt: at };
    expect(applyReportedWork(base, "needs_you")).toEqual({ status: "attention", enteredAt: at });
    expect(applyReportedWork(base, "done").status).toBe("done");
    expect(applyReportedWork(base, "working")).toBe(base);
    expect(applyReportedWork(base, null)).toBe(base);
  });

  it("keeps turn state when nothing is reported", () => {
    const base = { status: "attention" as const, enteredAt: at };
    expect(applyReportedWork(base, null)).toBe(base);
  });
});

describe("createReportedWorkLookup", () => {
  it("folds per host and workspace", () => {
    const lookup = createReportedWorkLookup([
      item({ workspaceId: "a", workState: "working" }),
      item({ serverId: "other", workspaceId: "a", workState: "done" }),
      item({ workspaceId: "b", needsYou: true }),
    ]);
    expect(lookup("s", "a")).toBe("working");
    expect(lookup("other", "a")).toBe("done");
    expect(lookup("s", "b")).toBe("needs_you");
    expect(lookup("s", "c")).toBeNull();
  });
});

describe("isStatusDecidedByReport", () => {
  it("holds for Ready to review and Done when something was reported", () => {
    expect(isStatusDecidedByReport({ status: "attention" }, "working")).toBe(true);
    expect(isStatusDecidedByReport({ status: "attention" }, "needs_you")).toBe(true);
    expect(isStatusDecidedByReport({ status: "done" }, "needs_you")).toBe(true);
    expect(isStatusDecidedByReport({ status: "done" }, "done")).toBe(true);
  });

  it("leaves the turn in charge without a report or for live states", () => {
    expect(isStatusDecidedByReport({ status: "attention" }, null)).toBe(false);
    expect(isStatusDecidedByReport({ status: "done" }, undefined)).toBe(false);
    for (const status of ["running", "failed", "needs_input"] as const) {
      expect(isStatusDecidedByReport({ status }, "done")).toBe(false);
    }
    expect(
      isStatusDecidedByReport({ status: "running", runningFromBackgroundWork: false }, "done"),
    ).toBe(false);
  });
});

describe("applyManualGroup", () => {
  const movedAt = "2026-11-12T10:00:00.000Z";
  const moved = (group: "attention" | "done" | "blocked") => ({ group, setAt: movedAt });

  it("puts an idle workspace in the group it was moved to, over the turn and the report", () => {
    const turn = { status: "attention" as const, enteredAt: at };
    expect(applyManualGroup(turn, turn, moved("done"), null)).toEqual({
      status: "done",
      enteredAt: at,
    });
    const reported = applyReportedWork(turn, "working");
    expect(applyManualGroup(turn, reported, moved("blocked"), null).status).toBe("blocked");
    const read = { status: "done" as const, enteredAt: at };
    expect(applyManualGroup(read, read, moved("attention"), null).status).toBe("attention");
  });

  it("never overrides live state", () => {
    for (const status of ["running", "failed", "needs_input"] as const) {
      const base = { status, enteredAt: at };
      expect(applyManualGroup(base, base, moved("done"), null)).toBe(base);
    }
    const devServer = {
      status: "running" as const,
      runningFromBackgroundWork: true,
      enteredAt: at,
    };
    expect(applyManualGroup(devServer, devServer, moved("done"), null).status).toBe("done");
  });

  it("ends once an agent status is written after the move", () => {
    const turn = { status: "attention" as const, enteredAt: at };
    const before = Date.parse(movedAt) - 1;
    const after = Date.parse(movedAt) + 1;
    expect(applyManualGroup(turn, turn, moved("done"), before).status).toBe("done");
    expect(applyManualGroup(turn, turn, moved("done"), after)).toBe(turn);
  });

  it("keeps the current status without a move", () => {
    const turn = { status: "attention" as const, enteredAt: at };
    expect(applyManualGroup(turn, turn, null, null)).toBe(turn);
  });
});

describe("createReportedWorkLookup updatedAt", () => {
  it("gives the newest agent status time per workspace", () => {
    const status = (updatedAt: number) => ({ state: "done" as const, summary: "s", updatedAt });
    const lookup = createReportedWorkLookup([
      item({ workspaceId: "a", status: status(10) }),
      item({ workspaceId: "a", pluginId: "other", status: status(30) }),
      item({ workspaceId: "b", workState: "working" }),
    ]);
    expect(lookup.updatedAt?.("s", "a")).toBe(30);
    expect(lookup.updatedAt?.("s", "b")).toBeNull();
  });
});

describe("foldInProgress", () => {
  const now = 1_000_000_000;
  const idle = { runningAgentIds: new Set<string>(), liveWork: false, now };
  const stale = { title: "t", updatedAt: now - 11 * 60_000 };
  const ci = { title: "t", watched: true, updatedAt: now };
  const review = { title: "t", watched: true, waitingOnReview: true, updatedAt: now };
  const asks = (
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
    expect(foldInProgress([item({ workState: "working" })], idle)).toBeNull();
    expect(foldInProgress([asks()], idle)).toBeNull();
  });

  it("works while CI watches an entry", () => {
    expect(foldInProgress([asks(ci, ci)], idle)).toEqual({
      moving: 2,
      stuck: 0,
      awaitingReview: 0,
      work: "working",
    });
  });

  it("is blocked when every moving entry waits on a review", () => {
    expect(foldInProgress([asks(review, review)], idle)).toEqual({
      moving: 2,
      stuck: 0,
      awaitingReview: 2,
      work: "blocked",
    });
  });

  it("works when CI and review are mixed", () => {
    expect(foldInProgress([asks(ci, review)], idle)?.work).toBe("working");
  });

  it("keeps the moving majority's group over a stuck entry", () => {
    expect(foldInProgress([asks(ci, ci, ci, stale)], idle)).toEqual({
      moving: 3,
      stuck: 1,
      awaitingReview: 0,
      work: "working",
    });
    expect(foldInProgress([asks(review, review, stale)], idle)?.work).toBe("blocked");
  });

  it("needs the human once stuck entries are at least as many as moving ones", () => {
    expect(foldInProgress([asks(ci, stale)], idle)?.work).toBe("needs_you");
    expect(foldInProgress([asks(stale)], idle)).toEqual({
      moving: 0,
      stuck: 1,
      awaitingReview: 0,
      work: "needs_you",
    });
  });

  it("counts live work and a running agent as machines moving", () => {
    const live = { ...idle, liveWork: true };
    expect(foldInProgress([asks(review, stale)], live)).toEqual({
      moving: 2,
      stuck: 0,
      awaitingReview: 1,
      work: "working",
    });
    const running = { ...idle, runningAgentIds: new Set(["agent-1"]) };
    expect(foldInProgress([asks({ ...stale, agentId: "agent-1" })], running)?.work).toBe("working");
  });

  it("ignores waitingOnReview on an entry nothing watches", () => {
    const fresh = { title: "t", waitingOnReview: true, updatedAt: now };
    expect(foldInProgress([asks(fresh)], idle)?.work).toBe("working");
  });
});

describe("createReportedWorkLookup in-progress work", () => {
  const now = 1_000_000_000;
  const watched = (id: string, waitingOnReview = false) => ({
    id,
    title: id,
    watched: true,
    waitingOnReview,
    updatedAt: now,
  });

  it("folds in-progress work with the items under the existing rank", () => {
    const lookup = createReportedWorkLookup(
      [
        item({ workspaceId: "done-card", workState: "done" }),
        item({ workspaceId: "done-card", pluginId: "paseo-asks", inProgress: [watched("A1")] }),
        item({ workspaceId: "ask", needsYou: true }),
        item({ workspaceId: "ask", pluginId: "paseo-asks", inProgress: [watched("A1")] }),
        item({ workspaceId: "review", pluginId: "paseo-asks", inProgress: [watched("A1", true)] }),
        item({ workspaceId: "review", workState: "working" }),
      ],
      now,
    );
    expect(lookup("s", "done-card")).toBe("working");
    expect(lookup.items?.("s", "done-card")).toBe("done");
    expect(lookup("s", "ask")).toBe("needs_you");
    expect(lookup("s", "review")).toBe("working");
    expect(lookup.inProgress?.("s", "review")?.work).toBe("blocked");
    expect(lookup.inProgress?.("s", "nothing")).toBeNull();
  });

  it("ages entries by the time it was built, and counts a running workspace as live work", () => {
    const entry = { id: "A1", title: "t", updatedAt: now - 11 * 60_000 };
    const lookup = createReportedWorkLookup(
      [item({ pluginId: "paseo-asks", inProgress: [entry] })],
      now,
    );
    expect(lookup("s", "w", { status: "attention" })).toBe("needs_you");
    expect(lookup("s", "w", { status: "running", runningFromBackgroundWork: true })).toBe(
      "working",
    );
    expect(
      createReportedWorkLookup(
        [item({ pluginId: "paseo-asks", inProgress: [entry] })],
        now - 60_000,
      )("s", "w"),
    ).toBe("working");
  });
});

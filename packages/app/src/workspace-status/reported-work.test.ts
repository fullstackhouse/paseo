import { describe, expect, it } from "vitest";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import {
  applyManualGroup,
  applyReportedWork,
  createReportedWorkLookup,
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

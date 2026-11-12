import { describe, expect, it } from "vitest";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import { applyReportedWork, createReportedWorkLookup, foldReportedWork } from "./reported-work";

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

  it("never overrides live state", () => {
    for (const status of ["running", "failed", "needs_input"] as const) {
      const base = { status, enteredAt: at };
      expect(applyReportedWork(base, "done")).toBe(base);
    }
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

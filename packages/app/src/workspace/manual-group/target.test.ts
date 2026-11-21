import { describe, expect, it } from "vitest";
import { resolveMoveTarget } from "./target";

const base = { serverId: "s", workspaceId: "w", supported: true };

describe("resolveMoveTarget", () => {
  it("offers Move to for an idle workspace, marking where it shows now", () => {
    for (const current of ["attention", "done", "blocked"] as const) {
      expect(resolveMoveTarget({ ...base, current })).toEqual({
        serverId: "s",
        workspaceId: "w",
        current,
      });
    }
  });

  it("offers nothing on a host that can't store a move", () => {
    expect(resolveMoveTarget({ ...base, supported: false, current: "attention" })).toBeNull();
  });

  // No target means the menu keeps Mark as read: a failed turn can still be acknowledged.
  it("offers nothing in live state, where a move would change nothing", () => {
    for (const current of ["running", "failed", "needs_input"] as const) {
      expect(resolveMoveTarget({ ...base, current })).toBeNull();
    }
  });

  it("offers nothing until the workspace and its status are known", () => {
    expect(resolveMoveTarget({ ...base, workspaceId: undefined, current: "done" })).toBeNull();
    expect(resolveMoveTarget({ ...base, current: null })).toBeNull();
  });
});

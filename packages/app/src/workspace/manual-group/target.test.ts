import { describe, expect, it } from "vitest";
import { resolveMoveTarget } from "./target";

const base = { serverId: "s", workspaceId: "w", supported: true };
const idle = { status: "attention" as const };

describe("resolveMoveTarget", () => {
  it("offers Move to for an idle workspace, marking where it shows now", () => {
    for (const current of ["attention", "done", "blocked"] as const) {
      expect(resolveMoveTarget({ ...base, turn: idle, current })).toEqual({
        serverId: "s",
        workspaceId: "w",
        current,
      });
    }
  });

  it("offers Move to for an idle workspace that shows as Working", () => {
    // A plugin reported working after the turn ended.
    expect(resolveMoveTarget({ ...base, turn: idle, current: "running" })?.current).toBe("running");
    // Held running only by background work, such as a dev server.
    const devServer = { status: "running" as const, runningFromBackgroundWork: true };
    expect(resolveMoveTarget({ ...base, turn: devServer, current: "running" })).not.toBeNull();
  });

  it("offers nothing on a host that can't store a move", () => {
    expect(
      resolveMoveTarget({ ...base, supported: false, turn: idle, current: "attention" }),
    ).toBeNull();
  });

  // No target means the menu keeps Mark as read: a failed turn can still be acknowledged.
  it("offers nothing while the turn is live, where a move would change nothing", () => {
    for (const status of ["running", "failed", "needs_input"] as const) {
      expect(resolveMoveTarget({ ...base, turn: { status }, current: status })).toBeNull();
    }
  });

  it("offers nothing until the workspace and its status are known", () => {
    expect(
      resolveMoveTarget({ ...base, workspaceId: undefined, turn: idle, current: "done" }),
    ).toBeNull();
    expect(resolveMoveTarget({ ...base, turn: null, current: "done" })).toBeNull();
    expect(resolveMoveTarget({ ...base, turn: idle, current: null })).toBeNull();
  });
});

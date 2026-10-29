import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceStateBucket } from "@getpaseo/protocol/agent-state-bucket";
import { createIdleInstallTrigger, summarizeLocalHostActivity } from "./install-when-idle";

function session(statuses: WorkspaceStateBucket[], hasHydratedWorkspaces = true) {
  return {
    hasHydratedWorkspaces,
    workspaces: new Map(statuses.map((status, index) => [`ws-${index}`, { status }])),
  };
}

describe("summarizeLocalHostActivity", () => {
  it("is unknown until the local host's workspaces have loaded", () => {
    expect(summarizeLocalHostActivity(undefined)).toBe("unknown");
    expect(summarizeLocalHostActivity(session([], false))).toBe("unknown");
  });

  it("is busy while a workspace is running or waiting on a permission prompt", () => {
    expect(summarizeLocalHostActivity(session(["done", "running"]))).toBe("busy");
    expect(summarizeLocalHostActivity(session(["attention", "needs_input"]))).toBe("busy");
  });

  it("is busy while a workspace runs its setup script", () => {
    expect(
      summarizeLocalHostActivity({
        hasHydratedWorkspaces: true,
        workspaces: new Map([["ws", { status: "done" as const, setupStatus: "running" }]]),
      }),
    ).toBe("busy");
  });

  it("is idle when every workspace is done, failed or waiting for review", () => {
    expect(summarizeLocalHostActivity(session([]))).toBe("idle");
    expect(summarizeLocalHostActivity(session(["done", "failed", "attention"]))).toBe("idle");
  });
});

describe("createIdleInstallTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once the host has stayed idle for the quiet window", () => {
    const onIdle = vi.fn();
    const trigger = createIdleInstallTrigger({ quietMs: 1000, onIdle });

    trigger.update("idle");
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("restarts the window when an agent starts working", () => {
    const onIdle = vi.fn();
    const trigger = createIdleInstallTrigger({ quietMs: 1000, onIdle });

    trigger.update("idle");
    vi.advanceTimersByTime(800);
    trigger.update("busy");
    trigger.update("idle");
    vi.advanceTimersByTime(800);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("keeps the window running across repeated idle updates", () => {
    const onIdle = vi.fn();
    const trigger = createIdleInstallTrigger({ quietMs: 1000, onIdle });

    trigger.update("idle");
    vi.advanceTimersByTime(600);
    trigger.update("idle");
    vi.advanceTimersByTime(400);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("never fires while activity is unknown", () => {
    const onIdle = vi.fn();
    const trigger = createIdleInstallTrigger({ quietMs: 1000, onIdle });

    trigger.update("unknown");
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("fires only once, and not after dispose", () => {
    const onIdle = vi.fn();
    const trigger = createIdleInstallTrigger({ quietMs: 1000, onIdle });

    trigger.update("idle");
    vi.advanceTimersByTime(1000);
    trigger.update("busy");
    trigger.update("idle");
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);

    const disposed = createIdleInstallTrigger({ quietMs: 1000, onIdle });
    disposed.update("idle");
    disposed.dispose();
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

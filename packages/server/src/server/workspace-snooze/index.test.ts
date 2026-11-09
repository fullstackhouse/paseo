import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedWorkspaceRegistry,
} from "../workspace-registry.js";
import { isWorkspaceSnoozed, resolveSnoozedAttention, setupWorkspaceSnoozeWaker } from "./index.js";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const LATER = "2026-11-09T20:00:00.000Z";
const EARLIER = "2026-11-09T08:00:00.000Z";

describe("isWorkspaceSnoozed", () => {
  test("is snoozed indefinitely without an end time", () => {
    expect(isWorkspaceSnoozed({ snoozedAt: EARLIER, snoozedUntil: null }, NOW)).toBe(true);
  });

  test("is awake once the end time passes, before the waker clears it", () => {
    expect(isWorkspaceSnoozed({ snoozedAt: EARLIER, snoozedUntil: LATER }, NOW)).toBe(true);
    expect(isWorkspaceSnoozed({ snoozedAt: EARLIER, snoozedUntil: EARLIER }, NOW)).toBe(false);
  });

  test("is awake without snoozedAt", () => {
    expect(isWorkspaceSnoozed({ snoozedAt: null, snoozedUntil: null }, NOW)).toBe(false);
  });
});

describe("resolveSnoozedAttention", () => {
  const snoozed = { snoozedAt: EARLIER, snoozedUntil: null };

  test("notifies for an awake workspace", () => {
    expect(
      resolveSnoozedAttention({
        workspace: { snoozedAt: null, snoozedUntil: null },
        reason: "finished",
        permissionBehavior: "silent",
        nowMs: NOW,
      }),
    ).toBe("notify");
  });

  test("keeps finished and failed turns quiet whatever the setting", () => {
    for (const reason of ["finished", "error"] as const) {
      expect(
        resolveSnoozedAttention({
          workspace: snoozed,
          reason,
          permissionBehavior: "wake",
          nowMs: NOW,
        }),
      ).toBe("quiet");
    }
  });

  test("wakes on a permission prompt by default", () => {
    expect(
      resolveSnoozedAttention({
        workspace: snoozed,
        reason: "permission",
        permissionBehavior: undefined,
        nowMs: NOW,
      }),
    ).toBe("wake");
  });

  test("stays quiet on a permission prompt with badge or silent", () => {
    for (const permissionBehavior of ["badge", "silent"] as const) {
      expect(
        resolveSnoozedAttention({
          workspace: snoozed,
          reason: "permission",
          permissionBehavior,
          nowMs: NOW,
        }),
      ).toBe("quiet");
    }
  });
});

describe("setupWorkspaceSnoozeWaker", () => {
  let dir: string;
  let registry: FileBackedWorkspaceRegistry;
  let close: (() => void) | null = null;

  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
    dir = await mkdtemp(path.join(tmpdir(), "snooze-waker-"));
    registry = new FileBackedWorkspaceRegistry(
      path.join(dir, "workspaces.json"),
      createTestLogger(),
    );
    await registry.initialize();
  });

  afterEach(async () => {
    close?.();
    close = null;
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  function workspace(id: string, snooze: { snoozedAt: string; snoozedUntil: string | null }) {
    return createPersistedWorkspaceRecord({
      workspaceId: id,
      projectId: "prj_1",
      cwd: `/tmp/${id}`,
      kind: "directory",
      displayName: id,
      createdAt: EARLIER,
      updatedAt: EARLIER,
      ...snooze,
    });
  }

  // Registry writes do real file I/O, so poll instead of flushing microtasks.
  async function snoozedAt(id: string) {
    return (await registry.get(id))?.snoozedAt ?? null;
  }

  async function waitForArmedTimer() {
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
  }

  test("wakes a workspace whose snooze already ended at startup", async () => {
    await registry.upsert(workspace("ws_past", { snoozedAt: EARLIER, snoozedUntil: EARLIER }));
    close = setupWorkspaceSnoozeWaker({
      workspaceRegistry: registry,
      logger: createTestLogger(),
    }).close;
    await vi.waitFor(async () => expect(await snoozedAt("ws_past")).toBeNull());
  });

  test("wakes a workspace when its snooze ends and leaves indefinite snoozes alone", async () => {
    await registry.upsert(workspace("ws_timed", { snoozedAt: EARLIER, snoozedUntil: LATER }));
    await registry.upsert(workspace("ws_forever", { snoozedAt: EARLIER, snoozedUntil: null }));
    close = setupWorkspaceSnoozeWaker({
      workspaceRegistry: registry,
      logger: createTestLogger(),
    }).close;
    await waitForArmedTimer();
    expect(await snoozedAt("ws_timed")).toBe(EARLIER);

    await vi.advanceTimersByTimeAsync(Date.parse(LATER) - NOW);

    await vi.waitFor(async () => expect(await snoozedAt("ws_timed")).toBeNull());
    expect(await snoozedAt("ws_forever")).toBe(EARLIER);
  });

  test("picks up a snooze set after startup", async () => {
    await registry.upsert(workspace("ws_new", { snoozedAt: EARLIER, snoozedUntil: null }));
    close = setupWorkspaceSnoozeWaker({
      workspaceRegistry: registry,
      logger: createTestLogger(),
    }).close;

    const until = new Date(NOW + 60 * 60_000).toISOString();
    await registry.update("ws_new", (existing) => ({ ...existing, snoozedUntil: until }));
    await waitForArmedTimer();
    expect(await snoozedAt("ws_new")).toBe(EARLIER);
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    await vi.waitFor(async () => expect(await snoozedAt("ws_new")).toBeNull());
  });
});

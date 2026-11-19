import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserBackend, Owner } from "../shared/model";
import { createControlEngine } from "./engine";

const mkdirGate = vi.hoisted(() => ({
  path: "",
  entered: undefined as (() => void) | undefined,
  wait: undefined as Promise<void> | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      if (String(args[0]) === mkdirGate.path) {
        mkdirGate.entered?.();
        await mkdirGate.wait;
      }
      return actual.mkdir(...args);
    },
  };
});

const alice: Owner = { agentId: "alice", workspaceId: "workspace-a" };
const bob: Owner = { agentId: "bob", workspaceId: "workspace-b" };
const directories: string[] = [];
async function setup(overrides: Partial<BrowserBackend> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "control-engine-"));
  directories.push(directory);
  const backend: BrowserBackend = {
    open: vi.fn(async () => ({ targetId: "target" })),
    execute: vi.fn(async () => ({ text: "page contents" })),
    close: vi.fn(async () => {}),
    recover: vi.fn(async () => {}),
    ...overrides,
  };
  const journalPath = join(directory, "journal.json");
  return { backend, journalPath, engine: await createControlEngine({ journalPath, backend }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(async () => {
  mkdirGate.path = "";
  mkdirGate.entered = undefined;
  mkdirGate.wait = undefined;
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("computer control ownership", () => {
  it("keeps session socket paths within the macOS Unix socket limit", async () => {
    const { engine } = await setup();
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    expect(task.session).toMatch(/^paseo-control-[a-f0-9]{24}$/);
    const socketPath = `/Users/example/.cache/paseo-computer-control/browser/${task.session}.sock`;
    expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(103);
  });

  it("queues other agents and transfers only after backend close", async () => {
    const { engine, backend } = await setup();
    const first = await engine.request(alice, "First", "https://example.com/", "first");
    const second = await engine.request(bob, "Second", "https://example.org/", "second");
    expect(first.state).toBe("active");
    expect(second.state).toBe("queued");
    expect(() => engine.execute(bob, first.id, { kind: "snapshot" }, "x")).toThrow("another agent");
    expect(() => engine.execute(bob, second.id, { kind: "snapshot" }, "x")).toThrow("does not own");
    await engine.finish(alice, first.id);
    expect(backend.close).toHaveBeenCalledTimes(1);
    expect(backend.open).toHaveBeenCalledTimes(2);
    expect(engine.inspect(bob)[0].state).toBe("active");
  });

  it("closes admission immediately and drains the running operation before human control", async () => {
    const gate = deferred<{ text: string }>();
    const started = deferred<void>();
    const { engine, backend } = await setup({
      execute: vi.fn(async () => {
        started.resolve();
        return gate.promise;
      }),
    });
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    const running = engine.execute(alice, task.id, { kind: "snapshot" }, "one");
    await started.promise;
    const queued = engine.execute(alice, task.id, { kind: "snapshot" }, "two");
    const queuedRejected = expect(queued).rejects.toThrow("admission closed");
    const hold = engine.takeover(task.id, task.revision);
    expect(engine.inspect()[0].state).toBe("holding");
    expect(() => engine.execute(alice, task.id, { kind: "snapshot" }, "three")).toThrow();
    gate.resolve({ text: "done" });
    await running;
    await queuedRejected;
    expect((await hold).state).toBe("human");
    expect(backend.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the screen held after cancellation until explicit human return", async () => {
    const { engine, backend } = await setup();
    const task = await engine.request(alice, "Login", "https://example.com/", "first");
    await engine.request(bob, "Other", "https://example.org/", "other");
    const held = await engine.handoff(alice, task.id, "Complete sign-in");
    const cancelled = await engine.cancel(task.id, held.revision);
    expect(cancelled.state).toBe("human");
    expect(cancelled.cancelRequested).toBe(true);
    expect(backend.close).not.toHaveBeenCalled();
    expect(() => engine.continue(task.id, held.revision)).toThrow("changed");
    await engine.continue(task.id, cancelled.revision);
    expect(engine.inspect(alice)[0].state).toBe("cancelled");
    expect(engine.inspect(bob)[0].state).toBe("active");
  });

  it("rejects stale Continue after a newer takeover", async () => {
    const { engine } = await setup();
    const task = await engine.request(alice, "Login", "https://example.com/", "first");
    const held = await engine.handoff(alice, task.id, "Sign in");
    const resumed = await engine.continue(task.id, held.revision);
    await engine.takeover(task.id, resumed.revision);
    expect(() => engine.continue(task.id, held.revision)).toThrow("changed");
    expect(engine.inspect()[0].state).toBe("human");
  });

  it("deduplicates operations and rejects conflicting request IDs without dispatch", async () => {
    const { engine, backend, journalPath } = await setup();
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    await engine.execute(alice, task.id, { kind: "snapshot" }, "initial-snapshot");
    const op = { kind: "fill", ref: "e1", text: "DO-NOT-PERSIST" } as const;
    await engine.execute(alice, task.id, op, "same");
    await engine.execute(alice, task.id, op, "same");
    expect(backend.execute).toHaveBeenCalledTimes(2);
    expect(() => engine.execute(alice, task.id, { kind: "snapshot" }, "same")).toThrow(
      "different arguments",
    );
    expect(await readFile(journalPath, "utf8")).not.toContain("DO-NOT-PERSIST");
    expect(await readFile(journalPath, "utf8")).not.toContain("page contents");
  });

  it("blocks all reassignment on unknown execution, including a pending finish", async () => {
    const gate = deferred<{ text: string }>();
    const started = deferred<void>();
    const { engine, backend } = await setup({
      execute: async () => {
        started.resolve();
        return gate.promise;
      },
    });
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    await engine.request(bob, "Next", "https://example.org/", "next");
    const running = engine.execute(alice, task.id, { kind: "press", key: "Tab" }, "one");
    const rejected = expect(running).rejects.toThrow("recovery required");
    await started.promise;
    const finishing = engine.finish(alice, task.id);
    const finishRejected = expect(finishing).rejects.toThrow("Recovery required");
    gate.reject(new Error("timeout"));
    await rejected;
    await finishRejected;
    expect(engine.inspect(alice)[0].state).toBe("recovery");
    expect(engine.inspect(bob)[0].state).toBe("queued");
    expect(backend.close).not.toHaveBeenCalled();
    expect(backend.open).toHaveBeenCalledTimes(1);
  });

  it("requires recovery for persisted live tasks and never resumes browser commands on restart", async () => {
    const { engine, backend, journalPath } = await setup();
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    await engine.handoff(alice, task.id, "Sign in");
    const restarted = await createControlEngine({ journalPath, backend });
    const recovered = restarted.inspect()[0];
    expect(recovered.state).toBe("recovery");
    expect(backend.open).toHaveBeenCalledTimes(1);
    expect(() => restarted.execute(alice, task.id, { kind: "snapshot" }, "one")).toThrow();
    await restarted.recover(task.id, recovered.revision);
    expect(restarted.inspect()[0].state).toBe("cancelled");
    expect(backend.recover).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a cancelled queued task", async () => {
    const { engine, backend } = await setup();
    const first = await engine.request(alice, "First", "https://example.com/", "first");
    const second = await engine.request(bob, "Next", "https://example.org/", "next");
    await engine.cancel(second.id, second.revision);
    await engine.finish(alice, first.id);
    expect(backend.open).toHaveBeenCalledTimes(1);
  });

  it("deduplicates persisted task requests and rejects malformed journals", async () => {
    const { engine, backend, journalPath } = await setup();
    const first = await engine.request(alice, "First", "https://example.com/", "first");
    expect((await engine.request(alice, "First", "https://example.com/", "first")).id).toBe(
      first.id,
    );
    await expect(engine.request(alice, "Changed", "https://example.com/", "first")).rejects.toThrow(
      "different arguments",
    );
    await writeFile(journalPath, '{"version":1,"tasks":[{}],"requests":[]}');
    await expect(createControlEngine({ journalPath, backend })).rejects.toThrow("Invalid");
  });

  it("lets a newer Stop win over an admitted Continue", async () => {
    const { engine, backend } = await setup();
    const task = await engine.request(alice, "Login", "https://example.com/", "first");
    const held = await engine.handoff(alice, task.id, "Sign in");
    const continuing = engine.continue(task.id, held.revision);
    const stopping = engine.takeover(task.id, engine.inspect()[0].revision);
    await continuing;
    await stopping;
    expect(engine.inspect()[0].state).toBe("human");
    expect(backend.execute).not.toHaveBeenCalled();
  });

  it("retains recovery ownership when backend cleanup fails", async () => {
    const { engine, backend } = await setup({
      close: async () => {
        throw new Error("Unknown drain");
      },
    });
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    await engine.request(bob, "Next", "https://example.org/", "next");
    await expect(engine.finish(alice, task.id)).rejects.toThrow("recovery required");
    expect(engine.inspect(alice)[0].state).toBe("recovery");
    expect(engine.inspect(bob)[0].state).toBe("queued");
    expect(backend.open).toHaveBeenCalledTimes(1);
  });

  it("refuses a live journal owner and reclaims a dead owner only through recovery", async () => {
    const { backend, journalPath } = await setup();
    const lockPath = join(dirnameForTest(journalPath), "screen-lock");
    const engine = await createControlEngine({ journalPath, backend, lockPath });
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    await expect(createControlEngine({ journalPath, backend, lockPath })).rejects.toThrow(
      "using this journal",
    );
    const ownerPath = join(lockPath, "owner.json");
    const lock = JSON.parse(await readFile(ownerPath, "utf8"));
    await writeFile(ownerPath, JSON.stringify({ ...lock, pid: 2147483647 }));
    const restarted = await createControlEngine({ journalPath, backend, lockPath });
    expect(restarted.inspect()[0].state).toBe("recovery");
    await restarted.recover(task.id, restarted.inspect()[0].revision);
    expect(backend.recover).toHaveBeenCalledTimes(1);
    expect(restarted.inspect()[0].state).toBe("cancelled");
    await expect(readFile(ownerPath)).rejects.toThrow();
  });

  it.each(["cancel", "close"] as const)(
    "does not open a task after %s during lock acquisition",
    async (action) => {
      const { backend, journalPath } = await setup();
      const lockPath = join(dirnameForTest(journalPath), "screen-lock");
      const engine = await createControlEngine({ journalPath, backend, lockPath });
      const entered = deferred<void>();
      const gate = deferred<void>();
      mkdirGate.path = lockPath;
      mkdirGate.entered = entered.resolve;
      mkdirGate.wait = gate.promise;
      const requested = engine.request(alice, "First", "https://example.com/", "first");
      const observedRequest = requested.catch(() => undefined);
      await entered.promise;
      const pending = engine.inspect()[0];
      expect(pending.state).toBe("queued");
      const stopped =
        action === "cancel" ? engine.cancel(pending.id, pending.revision) : engine.close();
      gate.resolve();
      await observedRequest;
      await stopped;
      expect(backend.open).not.toHaveBeenCalled();
      expect(engine.inspect()[0].state).toBe(action === "cancel" ? "cancelled" : "recovery");
    },
  );

  it("requires a new snapshot after every mutation and human return", async () => {
    const { engine, backend } = await setup();
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    await expect(
      engine.execute(alice, task.id, { kind: "click", ref: "e1" }, "early-click"),
    ).rejects.toThrow("fresh snapshot");
    await engine.execute(alice, task.id, { kind: "snapshot" }, "snapshot-1");
    await engine.execute(alice, task.id, { kind: "click", ref: "e1" }, "click-1");
    await expect(
      engine.execute(alice, task.id, { kind: "fill", ref: "e1", text: "hello" }, "stale-fill"),
    ).rejects.toThrow("fresh snapshot");
    await engine.execute(alice, task.id, { kind: "snapshot" }, "snapshot-2");
    await engine.execute(
      alice,
      task.id,
      { kind: "navigate", url: "https://example.com/other" },
      "navigate",
    );
    await expect(
      engine.execute(alice, task.id, { kind: "click", ref: "e1" }, "stale-click"),
    ).rejects.toThrow("fresh snapshot");
    await engine.execute(alice, task.id, { kind: "snapshot" }, "snapshot-3");
    const held = await engine.handoff(alice, task.id, "Sign in");
    await engine.continue(task.id, held.revision);
    expect(() => engine.execute(alice, task.id, { kind: "snapshot" }, "snapshot-3")).toThrow(
      "previous control epoch",
    );
    expect(() => engine.execute(alice, task.id, { kind: "click", ref: "e1" }, "click-1")).toThrow(
      "previous control epoch",
    );
    await expect(
      engine.execute(alice, task.id, { kind: "click", ref: "e1" }, "after-continue"),
    ).rejects.toThrow("fresh snapshot");
    await engine.execute(alice, task.id, { kind: "snapshot" }, "snapshot-4");
    await engine.execute(alice, task.id, { kind: "click", ref: "e2" }, "fresh-click");
    expect(backend.execute).toHaveBeenCalledTimes(7);
  });

  it("does not use a cached snapshot receipt to refresh invalidated refs", async () => {
    const { engine } = await setup();
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    await engine.execute(alice, task.id, { kind: "snapshot" }, "snapshot");
    await engine.execute(alice, task.id, { kind: "press", key: "Tab" }, "press");
    await engine.execute(alice, task.id, { kind: "snapshot" }, "snapshot");
    await expect(
      engine.execute(alice, task.id, { kind: "click", ref: "e1" }, "click"),
    ).rejects.toThrow("fresh snapshot");
  });

  it("cancels waiting tasks after recovery instead of reconnecting to a closed browser port", async () => {
    const { engine, backend } = await setup({
      execute: async () => {
        throw new Error("timeout");
      },
    });
    const task = await engine.request(alice, "First", "https://example.com/", "first");
    await engine.request(bob, "Next", "https://example.org/", "next");
    await expect(engine.execute(alice, task.id, { kind: "snapshot" }, "snapshot")).rejects.toThrow(
      "recovery required",
    );
    await engine.recover(task.id, engine.inspect(alice)[0].revision);
    expect(engine.inspect(bob)[0]).toMatchObject({
      state: "cancelled",
      humanReason: "Connection recovered; reconnect Chrome and request again.",
    });
    expect(backend.open).toHaveBeenCalledTimes(1);
  });

  it("prevents a second controller from dispatching into an owned screen", async () => {
    const first = await setup();
    const second = await setup();
    const lockPath = join(dirnameForTest(first.journalPath), "screen-lock");
    const one = await createControlEngine({
      journalPath: first.journalPath,
      backend: first.backend,
      lockPath,
    });
    const two = await createControlEngine({
      journalPath: second.journalPath,
      backend: second.backend,
      lockPath,
    });
    const task = await one.request(alice, "First", "https://example.com/", "first");
    await expect(two.request(bob, "Next", "https://example.org/", "next")).rejects.toThrow();
    expect(second.backend.open).not.toHaveBeenCalled();
    await one.finish(alice, task.id);
    expect((await two.request(bob, "Next", "https://example.org/", "next")).state).toBe("active");
  });
});
function dirnameForTest(value: string) {
  return value.slice(0, value.lastIndexOf("/"));
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BrowserBackend, Operation, Owner, Task } from "../shared/model";

interface RequestReceipt {
  key: string;
  fingerprint: string;
  taskId: string;
}
interface Journal {
  version: 1;
  tasks: Task[];
  requests: RequestReceipt[];
}
interface Options {
  journalPath: string;
  backend: BrowserBackend;
  lockPath?: string;
  taskTimeoutMs?: number;
}
const terminal = (task: Task) => task.state === "completed" || task.state === "cancelled";
const copy = <T>(value: T): T => structuredClone(value);
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function webUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Use an HTTP(S) URL without credentials");
  // URLs in the ownership journal must not contain auth codes or fragments.
  if (url.search || url.hash)
    throw new Error("Task URLs must not contain query strings or fragments");
  return url.toString();
}

function validateTask(task: Task) {
  const states = new Set([
    "queued",
    "active",
    "holding",
    "human",
    "recovery",
    "completed",
    "cancelled",
  ]);
  if (
    !task ||
    typeof task.id !== "string" ||
    typeof task.agentId !== "string" ||
    (task.workspaceId !== null && typeof task.workspaceId !== "string") ||
    typeof task.title !== "string" ||
    typeof task.url !== "string" ||
    typeof task.createdAt !== "string" ||
    typeof task.session !== "string" ||
    !states.has(task.state) ||
    !Number.isSafeInteger(task.revision) ||
    task.revision < 1 ||
    typeof task.cancelRequested !== "boolean"
  )
    throw new Error("Invalid control task journal");
  webUrl(task.url);
}

function validateJournal(value: unknown): Journal {
  if (!value || typeof value !== "object") throw new Error("Invalid control journal");
  const journal = value as Journal;
  if (journal.version !== 1 || !Array.isArray(journal.tasks) || !Array.isArray(journal.requests))
    throw new Error("Invalid control journal");
  if (journal.tasks.length > 120 || journal.requests.length > 1000)
    throw new Error("Control journal exceeds limits");
  const ids = new Set<string>();
  for (const task of journal.tasks) {
    validateTask(task);
    if (ids.has(task.id)) throw new Error("Duplicate control task");
    ids.add(task.id);
  }
  for (const receipt of journal.requests) {
    if (
      !receipt ||
      typeof receipt.key !== "string" ||
      typeof receipt.fingerprint !== "string" ||
      typeof receipt.taskId !== "string" ||
      !ids.has(receipt.taskId)
    )
      throw new Error("Invalid request receipt journal");
  }
  return journal;
}

function assertExited(pid: number, message: string) {
  try {
    process.kill(pid, 0);
    throw new Error(message);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** One controller owns the screen. Restart always requires an explicit recovery decision. */
export async function createControlEngine(options: Options) {
  let staleOwnLock = false;
  if (options.lockPath) {
    try {
      const previous = JSON.parse(await readFile(join(options.lockPath, "owner.json"), "utf8"));
      if (previous.journalPath === resolve(options.journalPath)) {
        if (!Number.isSafeInteger(previous.pid) || previous.pid < 1)
          throw new Error("Invalid screen lock");
        assertExited(previous.pid, "Another controller is using this journal");
        staleOwnLock = true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  let journal: Journal = { version: 1, tasks: [], requests: [] };
  try {
    journal = validateJournal(JSON.parse(await readFile(options.journalPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let lane: Promise<unknown> = Promise.resolve();
  let closed = false;
  let storageFailed = false;
  let lockHeld = false;
  const lockIdentity = randomUUID();
  const lockRecord = {
    identity: lockIdentity,
    pid: process.pid,
    journalPath: resolve(options.journalPath),
  };
  async function acquireUnguarded() {
    if (!options.lockPath || lockHeld) return;
    await mkdir(dirname(options.lockPath), { recursive: true, mode: 0o700 });
    await mkdir(options.lockPath, { mode: 0o700 });
    await writeFile(join(options.lockPath, "owner.json"), JSON.stringify(lockRecord), {
      mode: 0o600,
    });
    lockHeld = true;
  }
  async function acquireLock() {
    if (!options.lockPath || lockHeld) return;
    await mkdir(dirname(options.lockPath), { recursive: true, mode: 0o700 });
    const guard = `${options.lockPath}.recovery`;
    await mkdir(guard, { mode: 0o700 });
    try {
      await acquireUnguarded();
    } finally {
      await rm(guard, { recursive: true });
    }
  }
  async function recoverLock() {
    if (!options.lockPath || lockHeld) return;
    const guard = `${options.lockPath}.recovery`;
    await mkdir(guard, { mode: 0o700 });
    try {
      let previous: typeof lockRecord;
      try {
        previous = JSON.parse(await readFile(join(options.lockPath, "owner.json"), "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await acquireUnguarded();
        return;
      }
      if (
        previous.journalPath !== lockRecord.journalPath ||
        !Number.isSafeInteger(previous.pid) ||
        previous.pid < 1
      )
        throw new Error("Another controller owns the screen lock");
      assertExited(previous.pid, "Previous controller is still running");
      const stale = `${options.lockPath}.${randomUUID()}.recovered`;
      await rename(options.lockPath, stale);
      await acquireUnguarded();
      await rm(stale, { recursive: true });
    } finally {
      await rm(guard, { recursive: true });
    }
  }
  async function releaseLock() {
    if (!options.lockPath || !lockHeld) return;
    const record = JSON.parse(await readFile(join(options.lockPath, "owner.json"), "utf8"));
    if (record.identity !== lockIdentity) throw new Error("Screen lock ownership changed");
    await rm(options.lockPath, { recursive: true });
    lockHeld = false;
  }
  const resuming = new Set<string>();
  const takeoverDuringResume = new Set<string>();
  const epochs = new Map<string, number>();
  const freshSnapshots = new Set<string>();
  const operations = new Map<
    string,
    {
      fingerprint: string;
      epoch: number;
      result: Promise<{ text: string }>;
    }
  >();

  async function persist() {
    try {
      await mkdir(dirname(options.journalPath), { recursive: true, mode: 0o700 });
      const temporary = `${options.journalPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(journal), { mode: 0o600 });
      await rename(temporary, options.journalPath);
    } catch (error) {
      storageFailed = true;
      throw error;
    }
  }
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = lane.then(fn);
    lane = result.catch(() => undefined);
    return result;
  }
  function available() {
    if (closed || storageFailed) throw new Error("Controller unavailable; recovery required");
  }
  function find(id: string): Task {
    const task = journal.tasks.find((item) => item.id === id);
    if (!task) throw new Error("Unknown task");
    return task;
  }
  function owned(owner: Owner, id: string) {
    const task = find(id);
    if (task.agentId !== owner.agentId || task.workspaceId !== owner.workspaceId)
      throw new Error("Task belongs to another agent or workspace");
    return task;
  }
  function atRevision(id: string, revision: number) {
    available();
    const task = find(id);
    if (task.revision !== revision) throw new Error("Task changed; refresh before acting");
    return task;
  }
  function change(task: Task, state: Task["state"]) {
    task.state = state;
    task.revision++;
  }
  async function fail(task: Task): Promise<never> {
    change(task, "recovery");
    task.humanReason = "Execution could not be confirmed. Recover before assigning the screen.";
    await persist();
    throw new Error("Browser execution uncertain; recovery required");
  }
  async function advance() {
    if (
      closed ||
      storageFailed ||
      journal.tasks.some((task) => !terminal(task) && task.state !== "queued")
    )
      return;
    const task = journal.tasks.find((item) => item.state === "queued");
    if (!task) return;
    await acquireLock();
    available();
    if (task.state !== "queued" || task.cancelRequested) {
      if (journal.tasks.every(terminal)) await releaseLock();
      return;
    }
    freshSnapshots.delete(task.id);
    change(task, "active");
    // Persist before dispatch, so a crash cannot silently reassign an opened target.
    await persist();
    available();
    if (find(task.id).state !== "active" || task.cancelRequested) return;
    try {
      const opened = await options.backend.open(copy(task));
      task.targetId = opened.targetId;
      await persist();
    } catch {
      await fail(task);
    }
  }
  async function release(task: Task, state: "completed" | "cancelled") {
    available();
    if (task.state === "recovery") throw new Error("Recovery required before release");
    try {
      await options.backend.close(copy(task));
    } catch {
      return fail(task);
    }
    change(task, state);
    delete task.humanReason;
    await persist();
    for (const key of operations.keys()) if (JSON.parse(key)[0] === task.id) operations.delete(key);
    await advance();
    if (journal.tasks.every(terminal)) await releaseLock();
    return copy(task);
  }

  let recoveredOnStart = false;
  for (const task of journal.tasks) {
    if (!terminal(task)) {
      change(task, "recovery");
      task.humanReason =
        "Controller restarted. Confirm the old browser work has stopped before recovery.";
      recoveredOnStart = true;
    }
  }
  // A crash between recording completion and releasing the lock still needs an explicit cleanup.
  if (staleOwnLock && !recoveredOnStart) {
    const last = journal.tasks.at(-1);
    if (!last) throw new Error("Orphaned screen lock requires manual recovery");
    change(last, "recovery");
    last.humanReason = "Previous controller left its screen lock. Confirm cleanup before recovery.";
    recoveredOnStart = true;
  }
  if (recoveredOnStart) await persist();

  function hold(task: Task, reason: string) {
    available();
    if (task.state !== "active" && !resuming.has(task.id))
      throw new Error("Only the active task can enter human control");
    if (resuming.has(task.id)) takeoverDuringResume.add(task.id);
    // Synchronous admission barrier. Already queued commands re-check state before dispatch.
    change(task, "holding");
    task.humanReason = reason.slice(0, 500);
    return serialize(async () => {
      if (task.state === "recovery") throw new Error("Recovery required before human control");
      change(task, "human");
      await persist();
      return copy(task);
    });
  }

  const engine = {
    inspect(owner?: Owner, taskId?: string): Task[] {
      return copy(
        journal.tasks.filter(
          (task) =>
            (!taskId || task.id === taskId) &&
            (!owner || (owner.agentId === task.agentId && owner.workspaceId === task.workspaceId)),
        ),
      );
    },
    request(owner: Owner, title: string, url: string, requestId: string) {
      available();
      const normalized = webUrl(url);
      if (!requestId || requestId.length > 128 || !title.trim() || title.length > 200)
        throw new Error("Invalid task request");
      const key = JSON.stringify([owner.agentId, owner.workspaceId, requestId]);
      const hash = fingerprint([title, normalized]);
      return serialize(async () => {
        available();
        const existing = journal.requests.find((item) => item.key === key);
        if (existing) {
          if (existing.fingerprint !== hash)
            throw new Error("Request ID reused with different arguments");
          await advance();
          return copy(find(existing.taskId));
        }
        if (journal.tasks.some((task) => !terminal(task) && task.agentId === owner.agentId))
          throw new Error("This agent already has an outstanding task");
        if (journal.tasks.filter((task) => !terminal(task)).length >= 20)
          throw new Error("Screen queue is full");
        // Evict only terminal history and its receipts, never a live reservation.
        while (journal.tasks.length >= 120) {
          const index = journal.tasks.findIndex(terminal);
          if (index < 0) throw new Error("Task history is full");
          const [removed] = journal.tasks.splice(index, 1);
          journal.requests = journal.requests.filter((receipt) => receipt.taskId !== removed.id);
        }
        const task: Task = {
          ...owner,
          id: randomUUID(),
          title: title.trim(),
          url: normalized,
          state: "queued",
          revision: 1,
          createdAt: new Date().toISOString(),
          // Keep the complete socket path below macOS's 104-byte sockaddr_un limit.
          session: `paseo-control-${randomBytes(12).toString("hex")}`,
          cancelRequested: false,
        };
        journal.tasks.push(task);
        journal.requests.push({ key, fingerprint: hash, taskId: task.id });
        await persist();
        await advance();
        return copy(task);
      });
    },
    execute(owner: Owner, taskId: string, operation: Operation, requestId: string) {
      available();
      const task = owned(owner, taskId);
      if (task.state !== "active") throw new Error("Task does not own browser automation");
      if (!requestId || requestId.length > 128) throw new Error("Invalid operation request ID");
      const accepted = copy(operation);
      const key = JSON.stringify([taskId, requestId]);
      const hash = fingerprint(accepted);
      const epoch = epochs.get(taskId) ?? 0;
      const existing = operations.get(key);
      if (existing) {
        if (existing.epoch !== epoch)
          throw new Error("Request ID belongs to a previous control epoch; use a new request ID");
        if (existing.fingerprint !== hash)
          throw new Error("Request ID reused with different arguments");
        return existing.result;
      }
      if (operations.size >= 1000)
        throw new Error("Operation receipt limit reached; finish this controller session");
      const result = serialize(async () => {
        available();
        if (task.state !== "active") throw new Error("Browser admission closed");
        // The journal never stores operation text, snapshots, or returned page contents.
        await persist();
        available();
        if (task.state !== "active" || (epochs.get(taskId) ?? 0) !== epoch)
          throw new Error("Browser admission closed");
        if ((accepted.kind === "click" || accepted.kind === "fill") && !freshSnapshots.has(taskId))
          throw new Error("Take a fresh snapshot before using an element reference");
        freshSnapshots.delete(taskId);
        try {
          const observation = await options.backend.execute(copy(task), accepted);
          if (accepted.kind === "snapshot") freshSnapshots.add(taskId);
          return observation;
        } catch {
          return fail(task);
        }
      });
      operations.set(key, { fingerprint: hash, epoch, result });
      return result;
    },
    handoff(owner: Owner, taskId: string, reason: string) {
      return hold(owned(owner, taskId), reason);
    },
    takeover(taskId: string, revision: number) {
      return hold(atRevision(taskId, revision), "You took control. Automation is paused.");
    },
    continue(taskId: string, revision: number) {
      const task = atRevision(taskId, revision);
      if (task.state !== "human") throw new Error("Task is not in human control");
      // Close this revision immediately so two UI requests cannot both resume it.
      change(task, "holding");
      epochs.set(task.id, (epochs.get(task.id) ?? 0) + 1);
      freshSnapshots.delete(task.id);
      resuming.add(task.id);
      return serialize(async () => {
        available();
        resuming.delete(task.id);
        if (takeoverDuringResume.delete(task.id)) {
          await persist();
          return copy(task);
        }
        if (task.cancelRequested) return release(task, "cancelled");
        change(task, "active");
        delete task.humanReason;
        await persist();
        return copy(task);
      });
    },
    cancel(taskId: string, revision: number) {
      const task = atRevision(taskId, revision);
      if (terminal(task)) return Promise.resolve(copy(task));
      if (task.state === "recovery") throw new Error("Use recovery to release an uncertain task");
      const wasQueued = task.state === "queued";
      const held = task.state === "human" || task.state === "holding";
      task.cancelRequested = true;
      task.revision++;
      if (wasQueued) task.state = "cancelled";
      else if (!held && task.state === "active") task.state = "holding";
      return serialize(async () => {
        available();
        if (task.state === "recovery") throw new Error("Recovery required");
        if (held) {
          // The user may still be authenticating; cancellation cannot give the screen away.
          task.humanReason = "Task cancelled. Return control to release the screen.";
          await persist();
          return copy(task);
        }
        if (wasQueued) {
          await persist();
          return copy(task);
        }
        return release(task, "cancelled");
      });
    },
    finish(owner: Owner, taskId: string) {
      available();
      const task = owned(owner, taskId);
      if (task.state !== "active") throw new Error("Return human control before finishing");
      change(task, "holding");
      return serialize(() => release(task, "completed"));
    },
    recover(taskId: string, revision: number) {
      const task = atRevision(taskId, revision);
      if (task.state !== "recovery") throw new Error("Task does not require recovery");
      change(task, "holding");
      return serialize(async () => {
        try {
          await recoverLock();
          await options.backend.recover(copy(task));
        } catch {
          return fail(task);
        }
        change(task, "cancelled");
        delete task.humanReason;
        for (const queued of journal.tasks) {
          if (queued.state !== "queued") continue;
          change(queued, "cancelled");
          queued.cancelRequested = true;
          queued.humanReason = "Connection recovered; reconnect Chrome and request again.";
        }
        await persist();
        if (journal.tasks.every(terminal)) await releaseLock();
        return copy(task);
      });
    },
    async close() {
      closed = true;
      clearInterval(expiryTimer);
      for (const task of journal.tasks) {
        if (!terminal(task) && task.state !== "human" && task.state !== "recovery") {
          change(task, "recovery");
          task.humanReason = "Controller stopped. Explicit recovery is required.";
        }
      }
      await lane;
      await persist();
      if (journal.tasks.every(terminal)) await releaseLock();
    },
  };
  const expiryTimer = setInterval(() => {
    const cutoff = Date.now() - (options.taskTimeoutMs ?? 30 * 60_000);
    for (const task of journal.tasks) {
      if (
        terminal(task) ||
        task.state === "recovery" ||
        task.cancelRequested ||
        Date.parse(task.createdAt) > cutoff
      )
        continue;
      try {
        void engine.cancel(task.id, task.revision).catch(() => undefined);
      } catch {
        // Another action already changed this revision; the next sweep observes it.
      }
    }
  }, 30_000);
  expiryTimer.unref();
  return engine;
}

export type ControlEngine = Awaited<ReturnType<typeof createControlEngine>>;

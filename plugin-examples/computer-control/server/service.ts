import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import { configSchema } from "../shared/rpc";
import { createControlEngine } from "./engine";
import { createBrowserBackend } from "./browser";
import type { BrowserBackend, Owner, Task } from "../shared/model";

type Config = ReturnType<typeof configSchema.parse>;
interface ServiceOptions {
  directory?: string;
  lockPath?: string;
  createBackend?: (config: Config) => BrowserBackend;
  writeConfig?: (path: string, config: Config) => Promise<void>;
  wakeIntervalMs?: number;
  taskTimeoutMs?: number;
}
async function writeConfig(path: string, config: Config) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
  await rename(temporary, path);
}

export async function createService(options: ServiceOptions = {}) {
  const directory =
    options.directory ??
    process.env.PASEO_COMPUTER_CONTROL_DIR ??
    join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "plugin-data", "computer-control");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configPath = join(directory, "config.json");
  let config = {
    enabled: false,
    binaryPath: join(homedir(), ".local", "bin", "agent-browser"),
    cdpEndpoint: "9222",
  };
  try {
    config = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        "Computer control configuration is unreadable; repair it before enabling control.",
        { cause: error },
      );
  }
  const makeBackend = options.createBackend ?? createBrowserBackend;
  let backend = makeBackend(config);
  const engine = await createControlEngine({
    journalPath: join(directory, "tasks.json"),
    taskTimeoutMs: options.taskTimeoutMs,
    lockPath:
      options.lockPath ??
      process.env.PASEO_COMPUTER_CONTROL_LOCK ??
      join(homedir(), ".cache", "paseo-computer-control-owner"),
    backend: {
      open: (task) => backend.open(task),
      execute: (task, operation) => backend.execute(task, operation),
      close: (task) => backend.close(task),
      recover: (task) => backend.recover(task),
    },
  });
  let lastError: string | null = null;
  let attentionError: string | null = null;
  const notifiedAttention = new Map<string, number>();
  let closed = false;
  let attachedPaseo: PaseoApi | undefined;
  let admission: Promise<unknown> = Promise.resolve();
  let observed = engine.inspect();
  // Keep each attempt, including failure, until a new activation revision. Retrying every
  // timer tick can flood a working agent after an ambiguous send acknowledgement.
  const wakeAttempts = new Map<string, Promise<void>>();
  const wakeErrors = new Set<string>();
  const admittingAgents = new Set<string>();
  const wakeError =
    "A task is ready, but its agent could not be notified. Open that conversation and ask it to continue.";
  function serializeAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const next = admission.then(() => {
      if (closed) throw new Error("Computer control is closing");
      return operation();
    });
    admission = next.catch(() => undefined);
    return next;
  }
  function requireEnabled() {
    if (!config.enabled)
      throw new Error(
        "Computer control is disabled. Enable it in the Computer control plugin screen after setting up Chrome.",
      );
  }
  function wake(task: Task, api: PaseoApi) {
    const key = `${task.id}:${task.revision}`;
    const pending = wakeAttempts.get(key);
    if (pending) return pending;
    const attempt = (async () => {
      try {
        await api.agents
          .ref(task.agentId)
          .send(
            `Computer control task ${task.id} is ready. Call control_status, observe your owned tab afresh, and continue your original task. Human return of control is not proof of successful authentication.`,
            { activeTurnBehavior: "steer" },
          );
        wakeErrors.delete(task.id);
      } catch {
        wakeErrors.add(task.id);
      }
    })();
    wakeAttempts.set(key, attempt);
    return attempt;
  }
  async function observe(previous: Task[], api: PaseoApi, exceptAgentId?: string) {
    if (closed) return;
    const current = engine.inspect();
    observed = current;
    const retained = new Set(current.map((task) => task.id));
    for (const id of notifiedAttention.keys()) if (!retained.has(id)) notifiedAttention.delete(id);
    for (const key of wakeAttempts.keys())
      if (!retained.has(key.split(":")[0])) wakeAttempts.delete(key);
    for (const id of wakeErrors)
      if (!current.some((task) => task.id === id && task.state === "active")) wakeErrors.delete(id);
    await Promise.all(
      current.map(async (task) => {
        const old = previous.find((item) => item.id === task.id);
        if (
          task.state === "active" &&
          task.agentId !== exceptAgentId &&
          !admittingAgents.has(task.agentId) &&
          (old?.state === "queued" || old?.state === "human")
        )
          await wake(task, api);
      }),
    );
  }
  function attachPaseo(api: PaseoApi) {
    attachedPaseo = api;
  }
  async function after(previous: Task[], api: PaseoApi, exceptAgentId?: string) {
    attachPaseo(api);
    await observe(previous, api, exceptAgentId);
  }
  const wakeTimer = setInterval(() => {
    if (attachedPaseo)
      void observe(observed, attachedPaseo).catch(() => {
        lastError =
          "The task queue could not be observed. Check Computer control before continuing.";
      });
  }, options.wakeIntervalMs ?? 1000);
  wakeTimer.unref();
  return {
    engine,
    get config() {
      return { ...config };
    },
    get error() {
      return wakeErrors.size ? wakeError : (lastError ?? attentionError);
    },
    requireEnabled,
    attachPaseo,
    request(owner: Owner, title: string, url: string, requestId: string) {
      return serializeAdmission(async () => {
        requireEnabled();
        admittingAgents.add(owner.agentId);
        try {
          const task = await engine.request(owner, title, url, requestId);
          // Remember queued admission even if promotion happens before the next timer tick.
          observed = [...observed.filter((item) => item.id !== task.id), task];
          return task;
        } finally {
          admittingAgents.delete(owner.agentId);
        }
      });
    },
    configure(next: Config) {
      const replacementConfig = configSchema.parse(next);
      return serializeAdmission(async () => {
        if (engine.inspect().some((task) => !["completed", "cancelled"].includes(task.state)))
          throw new Error("Finish or recover all tasks before changing the connection.");
        const replacement = makeBackend(replacementConfig);
        await (options.writeConfig ?? writeConfig)(configPath, replacementConfig);
        config = replacementConfig;
        backend = replacement;
        lastError = null;
        attentionError = null;
      });
    },
    after,
    async attention(task: Task, paseo: PaseoApi) {
      try {
        const result = await paseo.notifications.send({
          title: "Chrome needs your attention",
          body: "Open Computer control to take over, then Continue or Cancel.",
          open: { screen: "control", params: { taskId: task.id } },
          key: `chrome-${task.id}-${task.revision}`,
        });
        if (result.delivered) {
          notifiedAttention.set(task.id, task.revision);
          attentionError = null;
        } else if (
          result.dropped === "duplicate" &&
          notifiedAttention.get(task.id) === task.revision
        ) {
          // Dedupe is expected after an acknowledged send for this exact handoff.
          attentionError = null;
        } else {
          let reason = "notification delivery was not confirmed";
          if (result.dropped === "muted") reason = "plugin notifications are muted";
          if (result.dropped === "rate_limited")
            reason = "Paseo's notification rate limit was reached";
          if (result.dropped === "duplicate")
            reason = "Paseo suppressed a duplicate and earlier delivery is unconfirmed";
          attentionError = `The task is safely paused, but ${reason}. Use the Computer control screen.`;
        }
      } catch {
        attentionError =
          "The task is safely paused, but its notification could not be delivered. Use the Computer control screen.";
      }
    },
    async cancelAgent(agentId: string, paseo: PaseoApi) {
      const previous = engine.inspect();
      for (const task of previous.filter(
        (item) => item.agentId === agentId && !["completed", "cancelled"].includes(item.state),
      ))
        await engine.cancel(task.id, task.revision);
      await after(previous, paseo);
    },
    async close() {
      closed = true;
      clearInterval(wakeTimer);
      await admission;
      await engine.close();
    },
  };
}

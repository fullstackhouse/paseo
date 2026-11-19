import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { BrowserBackend, Operation, Task } from "../shared/model";

const exec = promisify(execFile);
const MAX_OUTPUT = 64 * 1024;

interface CommandResult {
  success?: boolean;
  data?: { targetId?: string; snapshot?: string };
}

export interface BrowserOptions {
  binaryPath: string;
  cdpEndpoint: string;
  socketDir?: string;
}

interface Dependencies {
  runCommand?: (args: string[]) => Promise<string>;
  assertDisconnected?: (session: string) => Promise<void>;
}

/** Accept only an explicitly selected local Chrome, never an implicit browser launch. */
export function localEndpoint(value: string) {
  const endpoint = /^\d+$/.test(value) ? `http://127.0.0.1:${value}` : value;
  const url = new URL(endpoint);
  if (
    !["http:", "ws:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.port ||
    Number(url.port) < 1
  ) {
    throw new Error(
      "Use an explicit loopback Chrome debugging port or endpoint without credentials",
    );
  }
  return { endpoint, host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) };
}

function pageUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Only HTTP(S) page URLs without embedded credentials are supported");
  return url.toString();
}

function sessionName(task: Task) {
  if (!/^paseo-control-[a-zA-Z0-9-]{1,85}$/.test(task.session))
    throw new Error("Invalid owned browser session");
  return task.session;
}

function target(task: Task) {
  if (!task.targetId || !/^[a-zA-Z0-9-]{1,128}$/.test(task.targetId))
    throw new Error("Task has no valid owned Chrome tab");
  return task.targetId;
}

function ref(value: string) {
  if (!/^@?e\d+$/.test(value)) throw new Error("Use an element ref from the latest snapshot");
  return value.startsWith("@") ? value : `@${value}`;
}

function operationArgs(operation: Operation): string[] {
  switch (operation.kind) {
    case "snapshot":
      return ["snapshot"];
    case "navigate":
      return ["open", pageUrl(operation.url)];
    case "click":
      return ["click", ref(operation.ref)];
    case "fill":
      if (operation.text.startsWith("-"))
        throw new Error("Text beginning with a command-line flag is not supported");
      if (operation.text.length > 4096) throw new Error("Text is limited to 4096 characters");
      return ["fill", ref(operation.ref), operation.text];
    case "press":
      if (
        !/^(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Space)$/.test(
          operation.key,
        )
      )
        throw new Error(
          "Unsupported key; browser shortcuts and arbitrary key combinations are disabled",
        );
      return ["press", operation.key];
    case "scroll":
      if (
        !["up", "down"].includes(operation.direction) ||
        !Number.isInteger(operation.pixels) ||
        operation.pixels < 1 ||
        operation.pixels > 2000
      )
        throw new Error("Scroll must be up/down and between 1 and 2000 pixels");
      return ["scroll", operation.direction, String(operation.pixels)];
  }
}

function assertPortClosed(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const fail = () => {
      socket.destroy();
      reject(new Error("Disable Chrome remote debugging before recovery"));
    };
    socket.setTimeout(1500, fail);
    socket.once("connect", fail);
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve();
      else reject(new Error("Cannot confirm Chrome debugging is disconnected"));
    });
  });
}

async function assertExecutorGone(socketDir: string, session: string) {
  const pid = await readFile(join(socketDir, `${session}.pid`), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (pid !== null) {
    if (!/^\d+\s*$/.test(pid) || Number(pid) < 2)
      throw new Error("Invalid executor record; manual recovery required");
    try {
      process.kill(Number(pid), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH")
        return assertSocketGone(socketDir, session);
      throw new Error("Cannot confirm the previous browser executor has stopped", { cause: error });
    }
    throw new Error(`Stop the owned agent-browser session ${session} before recovery`);
  }
  await assertSocketGone(socketDir, session);
}

function assertSocketGone(socketDir: string, session: string): Promise<void> {
  const socketPath = join(socketDir, `${session}.sock`);
  // sockaddr_un includes a terminating NUL. The CLI cannot bind these paths; Node
  // reports EINVAL rather than ENAMETOOLONG on macOS. The PID check runs first.
  const limit = new Map([
    ["darwin", 104],
    ["linux", 108],
  ]).get(process.platform);
  if (limit !== undefined && Buffer.byteLength(socketPath) >= limit) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const fail = () => {
      socket.destroy();
      reject(new Error("Previous browser executor socket is still active or cannot be checked"));
    };
    socket.setTimeout(1500, fail);
    socket.once("connect", fail);
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") resolve();
      else fail();
    });
  });
}

export function createBrowserBackend(
  options: BrowserOptions,
  dependencies: Dependencies = {},
): BrowserBackend {
  const connection = localEndpoint(options.cdpEndpoint);
  if (!isAbsolute(options.binaryPath)) throw new Error("agent-browser path must be absolute");
  const socketDir =
    options.socketDir ?? join(homedir(), ".cache", "paseo-computer-control", "browser");
  const configPath = join(socketDir, "empty-config.json");
  let pending = 0;

  async function command(task: Task, args: string[]) {
    const session = sessionName(task);
    const argv = [
      "--session",
      session,
      "--cdp",
      connection.endpoint,
      "--pin-tab",
      "--json",
      "--config",
      configPath,
      ...args,
    ];
    pending++;
    try {
      let stdout: string;
      if (dependencies.runCommand) stdout = await dependencies.runCommand(argv);
      else {
        await mkdir(socketDir, { recursive: true, mode: 0o700 });
        await writeFile(configPath, "{}", { mode: 0o600 });
        const env = Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")),
        );
        stdout = (
          await exec(options.binaryPath, argv, {
            cwd: socketDir,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
            env: {
              ...env,
              AGENT_BROWSER_SOCKET_DIR: socketDir,
              AGENT_BROWSER_DEFAULT_TIMEOUT: "15000",
            },
          })
        ).stdout;
      }
      const result = JSON.parse(stdout) as CommandResult;
      if (result.success !== true || !result.data) throw new Error("Unsuccessful backend response");
      if (task.targetId && result.data.targetId && result.data.targetId !== task.targetId)
        throw new Error("Browser returned a different target");
      return result.data;
    } catch {
      // execFile errors include argv, including filled text: never expose them to logs or UI.
      throw new Error("Browser command failed or execution is uncertain; recovery is required");
    } finally {
      pending--;
    }
  }

  return {
    async open(task) {
      if (task.targetId) throw new Error("Task already owns a tab");
      const data = await command(task, ["open", pageUrl(task.url)]);
      if (!data.targetId || !/^[a-zA-Z0-9-]{1,128}$/.test(data.targetId))
        throw new Error("Browser did not confirm the new tab; recovery is required");
      return { targetId: data.targetId };
    },
    async execute(task, operation) {
      target(task);
      const data = await command(task, operationArgs(operation));
      if (operation.kind !== "snapshot")
        return { text: "Browser action completed. Take a fresh snapshot to verify the result." };
      if (typeof data.snapshot !== "string") throw new Error("Browser did not return a snapshot");
      const text = data.snapshot.slice(0, MAX_OUTPUT);
      return { text: text + (data.snapshot.length > MAX_OUTPUT ? "\n[Snapshot truncated]" : "") };
    },
    async close(task) {
      await command(task, ["tab", "close", target(task)]);
      await command(task, ["close"]);
    },
    async recover(task) {
      sessionName(task);
      if (pending) throw new Error("A browser command is still pending");
      if (dependencies.assertDisconnected) return dependencies.assertDisconnected(task.session);
      await assertPortClosed(connection.host, connection.port);
      await assertExecutorGone(socketDir, task.session);
      // Recovery never launches an executor, reconnects CDP, or deletes another task's sidecars.
    },
  };
}

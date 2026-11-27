import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { type Command, concurrently } from "concurrently";
import dotenv from "dotenv";

dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

const daemonRunnerEntry = fileURLToPath(new URL("./supervisor-entrypoint.ts", import.meta.url));

const args = process.argv.slice(2);
// concurrently signals entire command trees, including detached descendants.
// Give it the dependency watchers. The daemon supervisor owns worker shutdown.
const watchers = args.includes("--watch-dependencies")
  ? concurrently(
      [
        { command: "npm run watch:protocol", name: "protocol", prefixColor: "yellow" },
        { command: "npm run watch:client", name: "client", prefixColor: "blue" },
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        killOthersOn: ["success", "failure"],
      },
    )
  : null;

// The worker imports the protocol and client dist that these watchers emit. Started before their first
// build finishes, it loads the previous dist; after a branch switch or pull, that dist's generated
// validators no longer match the protocol schemas and the worker crashes on import.
function firstBuildFinished(watcher: Command): Promise<void> {
  return new Promise((resolve) => {
    watcher.stdout.subscribe((chunk) => {
      if (chunk.toString().includes("Watching for file changes")) resolve();
    });
  });
}

if (watchers) {
  const built = Promise.all(watchers.commands.map(firstBuildFinished)).then(() => "built" as const);
  const stopped = watchers.result.then(
    () => "stopped" as const,
    () => "stopped" as const,
  );
  if ((await Promise.race([built, stopped])) === "stopped") {
    process.stderr.write("Dependency watchers stopped before their first build finished\n");
    process.exit(1);
  }
}

const supervisorArgs = [
  ...process.execArgv,
  daemonRunnerEntry,
  "--dev",
  ...args.filter((arg) => arg !== "--watch-dependencies"),
];

const supervisor = spawn(process.execPath, supervisorArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    PASEO_LOG_FORMAT: process.env.PASEO_LOG_FORMAT ?? "pretty",
  },
});

function exitCodeForSignal(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : 1;
}

let stopping = false;
let lostWatchers = false;

function forwardSignal(signal: NodeJS.Signals): void {
  if (supervisor.exitCode !== null || supervisor.signalCode !== null || supervisor.killed) {
    return;
  }
  stopping = true;
  supervisor.kill(signal);
}

const watchersStopped = watchers?.result.catch(() => undefined);
function handleWatchersStopped(): void {
  if (stopping || supervisor.exitCode !== null || supervisor.signalCode !== null) return;
  lostWatchers = true;
  forwardSignal("SIGTERM");
}
void watchersStopped?.then(handleWatchersStopped);

async function finish(exitCode: number): Promise<void> {
  stopping = true;
  watchers?.commands.forEach((watcher) => watcher.kill());
  await watchersStopped;
  process.exit(lostWatchers ? 1 : exitCode);
}

// The supervisor handles SIGINT/SIGTERM itself and needs time to drain the
// worker gracefully. Keep this wrapper alive until the supervisor exits so npm
// does not release the shell while the daemon is still logging final shutdown.
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

supervisor.on("error", (error) => {
  process.stderr.write(`Failed to start daemon supervisor: ${error.message}\n`);
  void finish(1);
});

supervisor.on("exit", (code, signal) => {
  void finish(code ?? (signal ? exitCodeForSignal(signal) : 1));
});

import { spawn } from "node:child_process";
import { openSync, readFileSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import log from "electron-log/main";
import { createFshUpdater, parseLatestReleaseVersion, type FshUpdater } from "./fsh-updater.js";

const LATEST_RELEASE_URL = "https://api.github.com/repos/fullstackhouse/paseo/releases/latest";
const INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/fullstackhouse/paseo/fsh/scripts/install-fsh.sh";

// Captured at startup: the build this process is running.
const initialExecutableIdentity = readIdentitySync();

function readIdentitySync(): string {
  try {
    return String(statSync(process.execPath).ino);
  } catch {
    return "";
  }
}

function readFshBuildVersion(): string | null {
  if (!app.isPackaged) return null;
  try {
    const pkg = JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf-8")) as {
      fshBuild?: unknown;
    };
    return typeof pkg.fshBuild === "string" && pkg.fshBuild.length > 0 ? pkg.fshBuild : null;
  } catch {
    return null;
  }
}

function runInstallScript(): string {
  const logPath = path.join(app.getPath("logs"), "fsh-update.log");
  const out = openSync(logPath, "w");
  // Detached into its own session: the script quits this app, and must outlive it.
  const child = spawn(
    "/bin/bash",
    ["-c", `curl -fsSL "${INSTALL_SCRIPT_URL}" | bash -s -- --yes`],
    { detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  log.info("[fsh-updater] started install-fsh.sh", { pid: child.pid, logPath });
  return logPath;
}

/** The FSH updater, or null when this isn't a packaged FSH build. */
export function createElectronFshUpdater(deps: { stopDaemon(): Promise<void> }): FshUpdater | null {
  const buildVersion = readFshBuildVersion();
  if (!buildVersion) return null;

  return createFshUpdater({
    buildVersion,
    initialExecutableIdentity,
    async fetchLatestVersion() {
      const response = await fetch(LATEST_RELEASE_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
      return parseLatestReleaseVersion(await response.json());
    },
    async readExecutableIdentity() {
      return String((await stat(process.execPath)).ino);
    },
    runInstallScript,
    stopDaemon: deps.stopDaemon,
    relaunch() {
      app.relaunch();
      app.quit();
    },
  });
}

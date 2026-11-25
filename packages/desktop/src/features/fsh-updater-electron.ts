import { spawn } from "node:child_process";
import { openSync, readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { app } from "electron";
import log from "electron-log/main";
import {
  createFshUpdater,
  parseLatestReleaseVersion,
  parseTestBuilds,
  type FshUpdater,
} from "./fsh-updater.js";

const RELEASES_URL = "https://api.github.com/repos/fullstackhouse/paseo/releases";
const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
// Where install-fsh.sh records the installed tag; it always uses ~/.paseo, whatever PASEO_HOME says.
const INSTALLED_TAG_PATH = path.join(homedir(), ".paseo", "fsh-release");
const ASSET_EXTENSION = process.platform === "linux" ? "rpm" : "dmg";
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

async function fetchGitHubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return response.json();
}

function runInstallScript(args: readonly string[]): string {
  const logPath = path.join(app.getPath("logs"), "fsh-update.log");
  const out = openSync(logPath, "w");
  // Detached into its own session: the script quits this app, and must outlive it. The extra
  // arguments go in as bash's positional parameters, not into the command string.
  const child = spawn(
    "/bin/bash",
    ["-c", `curl -fsSL "${INSTALL_SCRIPT_URL}" | bash -s -- --yes "$@"`, "install-fsh", ...args],
    { detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  log.info("[fsh-updater] started install-fsh.sh", { pid: child.pid, args, logPath });
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
      return parseLatestReleaseVersion(await fetchGitHubJson(LATEST_RELEASE_URL), ASSET_EXTENSION);
    },
    async fetchTestBuilds() {
      return parseTestBuilds(
        await fetchGitHubJson(`${RELEASES_URL}?per_page=100`),
        ASSET_EXTENSION,
      );
    },
    async readInstalledTag() {
      try {
        return (await readFile(INSTALLED_TAG_PATH, "utf-8")).trim() || null;
      } catch {
        return null;
      }
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

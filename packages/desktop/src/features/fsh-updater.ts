// FSH fork: FSH builds are ad-hoc signed, so electron-updater can't install them and no
// update feed is published. Instead GitHub's latest release is the newest build, and
// scripts/install-fsh.sh installs it. The build stamps its release tag minus `fsh-` into its
// package.json (`fshBuild`), so the two compare directly. The app-side update callout and
// settings section run unchanged on top.
import type { AppUpdateCheckResult, AppUpdateInstallResult } from "./app-update-service.js";

export interface FshUpdaterDeps {
  /** `fshBuild` stamped by .github/workflows/fsh-desktop.yml, e.g. `0.13.0-beta.1-15c0b7e`. */
  buildVersion: string;
  /** GitHub's latest release, in the same form: what install-fsh.sh installs. */
  fetchLatestVersion(): Promise<string>;
  /**
   * Identity of the app executable on disk now (its inode). Replacing the bundle leaves the
   * running copy alive, so a changed identity means a newer build is installed and only
   * needs a restart.
   */
  readExecutableIdentity(): Promise<string>;
  initialExecutableIdentity: string;
  /**
   * Starts install-fsh.sh in the background. The script quits Paseo, stops the daemon,
   * swaps the app, reopens it and updates the plugins. Returns its log path.
   */
  runInstallScript(): string;
  stopDaemon(): Promise<void>;
  relaunch(): void;
}

export interface FshUpdater {
  check(): Promise<AppUpdateCheckResult>;
  install(): Promise<AppUpdateInstallResult>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function parseLatestReleaseVersion(release: unknown): string {
  const tag =
    typeof release === "object" && release !== null && "tag_name" in release
      ? release.tag_name
      : null;
  if (typeof tag !== "string" || !tag.startsWith("fsh-")) {
    throw new Error("The latest release isn't an FSH desktop build.");
  }
  return tag.slice("fsh-".length);
}

export function createFshUpdater(deps: FshUpdaterDeps): FshUpdater {
  const result = (
    fields: Pick<AppUpdateCheckResult, "hasUpdate" | "latestVersion"> &
      Partial<AppUpdateCheckResult>,
  ): AppUpdateCheckResult => ({
    readyToInstall: fields.hasUpdate,
    currentVersion: deps.buildVersion,
    body: null,
    date: null,
    errorMessage: null,
    ...fields,
  });

  const isInstalledOnDisk = async (): Promise<boolean> =>
    (await deps.readExecutableIdentity()) !== deps.initialExecutableIdentity;

  return {
    async check() {
      const installed = await isInstalledOnDisk();
      let latestVersion: string;
      try {
        latestVersion = await deps.fetchLatestVersion();
      } catch (error) {
        if (installed) return result({ hasUpdate: true, latestVersion: "" });
        return result({
          hasUpdate: false,
          latestVersion: "",
          errorMessage: `Couldn't check for FSH updates: ${errorMessage(error)}`,
        });
      }
      return result({
        hasUpdate: installed || latestVersion !== deps.buildVersion,
        latestVersion,
      });
    },

    async install() {
      if (await isInstalledOnDisk()) {
        await deps.stopDaemon();
        // Let the IPC reply reach the renderer before the app quits.
        setTimeout(() => deps.relaunch(), 0);
        return { installed: true, version: null, message: "Restarting Paseo..." };
      }

      const logPath = deps.runInstallScript();
      return {
        installed: true,
        version: null,
        message: `Updating. Paseo quits and reopens when the new build is in place. Log: ${logPath}`,
      };
    },
  };
}

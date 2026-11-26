// FSH fork: FSH builds are ad-hoc signed, so electron-updater can't install them and no
// update feed is published. Instead GitHub's latest release is the newest build, and
// scripts/install-fsh.sh installs it. The build stamps its release tag minus `fsh-` into its
// package.json (`fshBuild`), so the two compare directly. The app-side update callout and
// settings section run unchanged on top.
//
// Test builds are prereleases (`fsh-pr<N>-<sha>`, `fsh-test-<sha>`, see
// .github/workflows/fsh-desktop.yml). The app lists them and installs one through the same
// script (`--tag`). While a test build runs, the update check stays quiet; "back to stable"
// reinstalls the latest release.
import type { AppUpdateCheckResult, AppUpdateInstallResult } from "./app-update-service.js";

export interface FshUpdaterDeps {
  /**
   * `fshBuild` stamped by .github/workflows/fsh-desktop.yml: the release tag minus `fsh-`, e.g.
   * `0.13.0-beta.1-15c0b7e`, or `pr12-15c0b7e` / `test-15c0b7e` for a test build.
   */
  buildVersion: string;
  /** GitHub's latest release, in the same form: what install-fsh.sh installs. */
  fetchLatestVersion(): Promise<string>;
  /** Test builds in GitHub's releases, newest first. */
  fetchTestBuilds(): Promise<FshTestBuild[]>;
  /** The tag install-fsh.sh recorded in `~/.paseo/fsh-release`, if any. */
  readInstalledTag(): Promise<string | null>;
  /**
   * Identity of the app executable on disk now (its inode). Replacing the bundle leaves the
   * running copy alive, so a changed identity means a newer build is installed and only
   * needs a restart.
   */
  readExecutableIdentity(): Promise<string>;
  initialExecutableIdentity: string;
  /**
   * Starts install-fsh.sh in the background with these extra arguments. The script quits Paseo,
   * stops the daemon, swaps the app, reopens it and updates the plugins. Returns its log path.
   */
  runInstallScript(args: readonly string[]): string;
  stopDaemon(): Promise<void>;
  relaunch(): void;
}

export interface FshTestBuild {
  tag: string;
  pr: number | null;
  branch: string | null;
  sha: string;
  publishedAt: string | null;
}

export interface FshTestBuildsInfo {
  /** The release this app came from. */
  installedTag: string;
  /** Set while a test build runs. */
  installedTestBuild: FshTestBuild | null;
  testBuilds: FshTestBuild[];
  errorMessage: string | null;
}

/** What to install: the latest release, a test build by tag, or the latest release again. */
export type FshInstallTarget =
  | { kind: "latest" }
  | { kind: "test"; tag: string }
  | { kind: "stable" };

export interface FshUpdater {
  check(): Promise<AppUpdateCheckResult>;
  install(target?: FshInstallTarget): Promise<AppUpdateInstallResult>;
  listTestBuilds(): Promise<FshTestBuildsInfo>;
}

/** `install_app_update`'s `fshRelease` argument: `"stable"`, a test build tag, or absent. */
export function parseFshInstallTarget(args: Record<string, unknown> | undefined): FshInstallTarget {
  const release = args?.fshRelease;
  if (release === "stable") return { kind: "stable" };
  if (typeof release === "string") return { kind: "test", tag: release };
  return { kind: "latest" };
}

const TEST_BUILD_TAG = /^fsh-(?:pr(\d+)|test)-([0-9a-f]{7,40})$/;

/** The PR and sha in a test build's tag, or null when the tag isn't a test build. */
export function parseTestBuildTag(tag: string): Pick<FshTestBuild, "tag" | "pr" | "sha"> | null {
  const match = TEST_BUILD_TAG.exec(tag);
  if (!match) return null;
  return { tag, pr: match[1] ? Number(match[1]) : null, sha: match[2] };
}

const lastSegment = (value: string): string => value.slice(value.lastIndexOf("-") + 1);

/**
 * The release this app came from. The stamp names it, except on test builds from before test
 * builds were stamped as such (they carry the stable form, `<version>-<sha>`): then the tag
 * install-fsh.sh recorded wins when it is a test build of the same commit.
 */
export function resolveInstalledTag(buildVersion: string, recordedTag: string | null): string {
  const stamped = `fsh-${buildVersion}`;
  if (
    recordedTag &&
    parseTestBuildTag(recordedTag) &&
    lastSegment(recordedTag) === lastSegment(buildVersion)
  ) {
    return recordedTag;
  }
  return stamped;
}

const hasAsset = (release: Record<string, unknown>, assetExtension: string): boolean =>
  Array.isArray(release.assets) &&
  release.assets.some(
    (asset: unknown) =>
      typeof asset === "object" &&
      asset !== null &&
      "name" in asset &&
      typeof asset.name === "string" &&
      asset.name.endsWith(`.${assetExtension}`),
  );

/**
 * Test builds in a GitHub releases listing that carry this platform's package. The branch comes
 * from the release title the workflow writes: `Paseo <version> test build (PR #12, branch foo abc1234)`.
 */
export function parseTestBuilds(releases: unknown, assetExtension: string): FshTestBuild[] {
  if (!Array.isArray(releases)) throw new Error("GitHub's release list isn't a list.");
  const builds: FshTestBuild[] = [];
  for (const release of releases as unknown[]) {
    if (typeof release !== "object" || release === null) continue;
    const fields = release as Record<string, unknown>;
    if (fields.prerelease !== true || typeof fields.tag_name !== "string") continue;
    const parsed = parseTestBuildTag(fields.tag_name);
    if (!parsed || !hasAsset(fields, assetExtension)) continue;
    const name = typeof fields.name === "string" ? fields.name : "";
    builds.push({
      ...parsed,
      branch: /branch (\S+) [0-9a-f]+\)$/.exec(name)?.[1] ?? null,
      publishedAt: typeof fields.published_at === "string" ? fields.published_at : null,
    });
  }
  return builds.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The FSH build in GitHub's latest release. `assetExtension` is the package install-fsh.sh
 * installs on this platform (`dmg`, `rpm`). CI publishes a release only when both build, but
 * releases from before the Linux build have no RPM, and offering one would run a script that fails.
 */
export function parseLatestReleaseVersion(release: unknown, assetExtension: string): string {
  if (typeof release !== "object" || release === null) {
    throw new Error("The latest release isn't an FSH desktop build.");
  }
  const tag = "tag_name" in release ? release.tag_name : null;
  if (typeof tag !== "string" || !tag.startsWith("fsh-")) {
    throw new Error("The latest release isn't an FSH desktop build.");
  }
  if (!hasAsset(release as Record<string, unknown>, assetExtension)) {
    throw new Error(`The latest FSH release (${tag}) has no .${assetExtension} for this platform.`);
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

  const readInstalledTag = async (): Promise<string> =>
    resolveInstalledTag(deps.buildVersion, await deps.readInstalledTag().catch(() => null));

  const startScript = (args: readonly string[]): AppUpdateInstallResult => {
    const logPath = deps.runInstallScript(args);
    return {
      installed: true,
      version: null,
      message: `Updating. Paseo quits and reopens when the new build is in place. Log: ${logPath}`,
    };
  };

  return {
    async check() {
      const installed = await isInstalledOnDisk();
      // A test build stays put until someone picks Back to stable; only a swap on disk counts.
      if (parseTestBuildTag(await readInstalledTag())) {
        return result({ hasUpdate: installed, latestVersion: "" });
      }
      let latestVersion: string;
      try {
        latestVersion = await deps.fetchLatestVersion();
      } catch (error) {
        if (installed) return result({ hasUpdate: true, latestVersion: "" });
        return result({
          hasUpdate: false,
          latestVersion: "",
          errorMessage: `Couldn't check for FSH updates: ${describeError(error)}`,
        });
      }
      return result({
        hasUpdate: installed || latestVersion !== deps.buildVersion,
        latestVersion,
      });
    },

    async install(target = { kind: "latest" }) {
      if (target.kind === "test") {
        // The tag reaches a shell command line, so only a well-formed test build tag passes.
        if (!parseTestBuildTag(target.tag)) throw new Error(`${target.tag} isn't a test build.`);
        return startScript(["--tag", target.tag]);
      }
      // --force: install-fsh.sh skips a release it recorded as installed, and a test build put
      // on disk some other way (a DMG) left the stable tag recorded.
      if (target.kind === "stable") return startScript(["--force"]);

      if (await isInstalledOnDisk()) {
        await deps.stopDaemon();
        // Let the IPC reply reach the renderer before the app quits.
        setTimeout(() => deps.relaunch(), 0);
        return { installed: true, version: null, message: "Restarting Paseo..." };
      }
      return startScript([]);
    },

    async listTestBuilds() {
      const installedTag = await readInstalledTag();
      const installed = parseTestBuildTag(installedTag);
      let testBuilds: FshTestBuild[] = [];
      let errorMessage: string | null = null;
      try {
        testBuilds = await deps.fetchTestBuilds();
      } catch (error) {
        errorMessage = `Couldn't list test builds: ${describeError(error)}`;
      }
      const listed = testBuilds.find((build) => build.tag === installedTag);
      return {
        installedTag,
        installedTestBuild: installed
          ? (listed ?? { ...installed, branch: null, publishedAt: null })
          : null,
        testBuilds,
        errorMessage,
      };
    },
  };
}

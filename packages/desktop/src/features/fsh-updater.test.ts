import { describe, expect, it, vi } from "vitest";
import {
  createFshUpdater,
  parseFshInstallTarget,
  parseLatestReleaseVersion,
  parseTestBuilds,
  resolveInstalledTag,
  type FshTestBuild,
  type FshUpdaterDeps,
} from "./fsh-updater.js";

const BUILD = "0.13.0-beta.1-15c0b7e";
const NEWER = "0.13.0-beta.1-abc1234";
const TEST_BUILD: FshTestBuild = {
  tag: "fsh-pr12-def5678",
  pr: 12,
  branch: "feat/thing",
  sha: "def5678",
  publishedAt: "2026-11-20T10:00:00Z",
};

function setup(overrides: Partial<FshUpdaterDeps> = {}) {
  let identity = "100";
  const deps: FshUpdaterDeps = {
    buildVersion: BUILD,
    initialExecutableIdentity: "100",
    fetchLatestVersion: vi.fn(async () => NEWER),
    fetchTestBuilds: vi.fn(async () => [TEST_BUILD]),
    readInstalledTag: vi.fn(async () => null),
    readExecutableIdentity: vi.fn(async () => identity),
    runInstallScript: vi.fn(() => "/logs/fsh-update.log"),
    stopDaemon: vi.fn(async () => undefined),
    relaunch: vi.fn(),
    ...overrides,
  };
  return {
    deps,
    updater: createFshUpdater(deps),
    swapAppOnDisk: () => {
      identity = "200";
    },
  };
}

describe("parseLatestReleaseVersion", () => {
  const assets = [{ name: "Paseo-0.13.0-arm64.dmg" }, { name: "Paseo-0.13.0-x86_64.rpm" }];

  it("strips the fsh- prefix from the release tag", () => {
    expect(parseLatestReleaseVersion({ tag_name: `fsh-${NEWER}`, assets }, "rpm")).toBe(NEWER);
  });

  it("rejects a release that isn't an FSH desktop build", () => {
    expect(() => parseLatestReleaseVersion({ tag_name: "v0.13.0", assets }, "dmg")).toThrow(
      /FSH desktop/,
    );
    expect(() => parseLatestReleaseVersion({}, "dmg")).toThrow(/FSH desktop/);
    expect(() => parseLatestReleaseVersion(null, "dmg")).toThrow(/FSH desktop/);
  });

  it("rejects a release without this platform's package", () => {
    const macOnly = { tag_name: `fsh-${NEWER}`, assets: [{ name: "Paseo-0.13.0-arm64.dmg" }] };
    expect(parseLatestReleaseVersion(macOnly, "dmg")).toBe(NEWER);
    expect(() => parseLatestReleaseVersion(macOnly, "rpm")).toThrow(/no \.rpm/);
  });
});

describe("parseTestBuilds", () => {
  const dmg = [{ name: "Paseo-0.17.1-arm64.dmg" }];
  const release = (fields: Record<string, unknown>) => ({
    prerelease: true,
    assets: dmg,
    ...fields,
  });

  it("lists PR and branch test builds with this platform's package, newest first", () => {
    const releases = [
      release({
        tag_name: "fsh-test-4d2a5d0",
        name: "Paseo 0.17.1 test build (branch fsh-rebase-v0.17.1 4d2a5d0)",
        published_at: "2026-11-01T00:00:00Z",
      }),
      release({
        tag_name: "fsh-pr12-def5678",
        name: "Paseo 0.17.1 test build (PR #12, branch feat/thing def5678)",
        published_at: "2026-11-20T10:00:00Z",
      }),
      // A stable release, an Android release, a test build without a DMG.
      { tag_name: `fsh-${NEWER}`, prerelease: false, assets: dmg },
      release({ tag_name: "fsh-android-1.2.3" }),
      release({ tag_name: "fsh-test-aaaaaaa", assets: [{ name: "Paseo.rpm" }] }),
    ];
    expect(parseTestBuilds(releases, "dmg")).toEqual([
      TEST_BUILD,
      {
        tag: "fsh-test-4d2a5d0",
        pr: null,
        branch: "fsh-rebase-v0.17.1",
        sha: "4d2a5d0",
        publishedAt: "2026-11-01T00:00:00Z",
      },
    ]);
  });

  it("rejects a listing that isn't a list", () => {
    expect(() => parseTestBuilds({ message: "rate limited" }, "dmg")).toThrow(/isn't a list/);
  });
});

describe("resolveInstalledTag", () => {
  it("reads the tag from the stamp", () => {
    expect(resolveInstalledTag(BUILD, null)).toBe(`fsh-${BUILD}`);
    expect(resolveInstalledTag("pr12-def5678", `fsh-${BUILD}`)).toBe("fsh-pr12-def5678");
  });

  it("trusts a recorded test build tag of the same commit over a stable-form stamp", () => {
    expect(resolveInstalledTag("0.13.0-beta.1-def5678", "fsh-pr12-def5678")).toBe(
      "fsh-pr12-def5678",
    );
    expect(resolveInstalledTag(BUILD, "fsh-pr12-def5678")).toBe(`fsh-${BUILD}`);
  });
});

describe("parseFshInstallTarget", () => {
  it("reads stable, a tag, or nothing", () => {
    expect(parseFshInstallTarget({ fshRelease: "stable" })).toEqual({ kind: "stable" });
    expect(parseFshInstallTarget({ fshRelease: "fsh-test-4d2a5d0" })).toEqual({
      kind: "test",
      tag: "fsh-test-4d2a5d0",
    });
    expect(parseFshInstallTarget(undefined)).toEqual({ kind: "latest" });
  });
});

describe("createFshUpdater.check", () => {
  it("is up to date when the latest release matches the running build", async () => {
    const { updater } = setup({ fetchLatestVersion: async () => BUILD });
    await expect(updater.check()).resolves.toMatchObject({
      hasUpdate: false,
      readyToInstall: false,
      currentVersion: BUILD,
      latestVersion: BUILD,
      errorMessage: null,
    });
  });

  it("offers a newer release as ready to install", async () => {
    const { updater } = setup();
    await expect(updater.check()).resolves.toMatchObject({
      hasUpdate: true,
      readyToInstall: true,
      latestVersion: NEWER,
    });
  });

  it("offers a restart when the app on disk was replaced, even offline", async () => {
    const { updater, swapAppOnDisk } = setup({
      fetchLatestVersion: async () => {
        throw new Error("offline");
      },
    });
    swapAppOnDisk();
    await expect(updater.check()).resolves.toMatchObject({
      hasUpdate: true,
      readyToInstall: true,
      errorMessage: null,
    });
  });

  it("stays quiet on a test build", async () => {
    const { updater, deps } = setup({ buildVersion: "pr12-def5678" });
    await expect(updater.check()).resolves.toMatchObject({
      hasUpdate: false,
      readyToInstall: false,
      errorMessage: null,
    });
    expect(deps.fetchLatestVersion).not.toHaveBeenCalled();
  });

  it("still offers a restart on a test build replaced on disk", async () => {
    const { updater, swapAppOnDisk } = setup({ buildVersion: "test-def5678" });
    swapAppOnDisk();
    await expect(updater.check()).resolves.toMatchObject({ hasUpdate: true });
  });

  it("reports a failed check", async () => {
    const { updater } = setup({
      fetchLatestVersion: async () => {
        throw new Error("offline");
      },
    });
    await expect(updater.check()).resolves.toMatchObject({
      hasUpdate: false,
      errorMessage: expect.stringContaining("offline"),
    });
  });
});

describe("createFshUpdater.install", () => {
  it("hands the update to the install script", async () => {
    const { updater, deps } = setup();
    await expect(updater.install()).resolves.toMatchObject({
      installed: true,
      message: expect.stringContaining("/logs/fsh-update.log"),
    });
    expect(deps.runInstallScript).toHaveBeenCalledWith([]);
    expect(deps.stopDaemon).not.toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it("only restarts when the new build is already on disk", async () => {
    vi.useFakeTimers();
    const { updater, deps, swapAppOnDisk } = setup();
    swapAppOnDisk();
    await expect(updater.install()).resolves.toMatchObject({ installed: true });
    expect(deps.runInstallScript).not.toHaveBeenCalled();
    expect(deps.stopDaemon).toHaveBeenCalledOnce();
    expect(deps.relaunch).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(deps.relaunch).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("installs a test build by tag", async () => {
    const { updater, deps } = setup();
    await updater.install({ kind: "test", tag: "fsh-test-4d2a5d0" });
    expect(deps.runInstallScript).toHaveBeenCalledWith(["--tag", "fsh-test-4d2a5d0"]);
  });

  it("refuses anything but a test build tag", async () => {
    const { updater, deps } = setup();
    await expect(updater.install({ kind: "test", tag: "fsh-x; rm -rf ~" })).rejects.toThrow(
      /isn't a test build/,
    );
    await expect(updater.install({ kind: "test", tag: `fsh-${NEWER}` })).rejects.toThrow();
    expect(deps.runInstallScript).not.toHaveBeenCalled();
  });

  it("goes back to stable by reinstalling the latest release", async () => {
    const { updater, deps, swapAppOnDisk } = setup({ buildVersion: "pr12-def5678" });
    swapAppOnDisk();
    await updater.install({ kind: "stable" });
    expect(deps.runInstallScript).toHaveBeenCalledWith(["--force"]);
    expect(deps.relaunch).not.toHaveBeenCalled();
  });
});

describe("createFshUpdater.listTestBuilds", () => {
  it("lists test builds and no installed one on a stable build", async () => {
    const { updater } = setup();
    await expect(updater.listTestBuilds()).resolves.toEqual({
      installedTag: `fsh-${BUILD}`,
      installedTestBuild: null,
      testBuilds: [TEST_BUILD],
      errorMessage: null,
    });
  });

  it("names the installed test build with its listed branch", async () => {
    const { updater } = setup({ buildVersion: "pr12-def5678" });
    await expect(updater.listTestBuilds()).resolves.toMatchObject({
      installedTag: "fsh-pr12-def5678",
      installedTestBuild: TEST_BUILD,
    });
  });

  it("knows an installed test build that is no longer listed", async () => {
    const { updater } = setup({
      buildVersion: "test-0123abc",
      fetchTestBuilds: async () => {
        throw new Error("offline");
      },
    });
    await expect(updater.listTestBuilds()).resolves.toEqual({
      installedTag: "fsh-test-0123abc",
      installedTestBuild: {
        tag: "fsh-test-0123abc",
        pr: null,
        sha: "0123abc",
        branch: null,
        publishedAt: null,
      },
      testBuilds: [],
      errorMessage: expect.stringContaining("offline"),
    });
  });
});

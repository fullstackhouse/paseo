import { describe, expect, it, vi } from "vitest";
import { createFshUpdater, parseLatestReleaseVersion, type FshUpdaterDeps } from "./fsh-updater.js";

const BUILD = "0.13.0-beta.1-15c0b7e";
const NEWER = "0.13.0-beta.1-abc1234";

function setup(overrides: Partial<FshUpdaterDeps> = {}) {
  let identity = "100";
  const deps: FshUpdaterDeps = {
    buildVersion: BUILD,
    initialExecutableIdentity: "100",
    fetchLatestVersion: vi.fn(async () => NEWER),
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
    expect(deps.runInstallScript).toHaveBeenCalledOnce();
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
});

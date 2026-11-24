/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandCenterContribution } from "@/command-center/contributions";
import type { SidebarCalloutOptions } from "@/contexts/sidebar-callout-context";
import type { DesktopAppUpdateCheckResult } from "@/desktop/updates/desktop-updates";
import { summarizeLocalHostActivity } from "@/desktop/updates/install-when-idle";
import { buildFakeCheckResult } from "@/desktop/updates/test-utils/fake-desktop-app-updater-port";
import { UpdateCalloutSource } from "./update-callout-source";

const port = vi.hoisted(() => ({
  check: vi.fn<() => Promise<DesktopAppUpdateCheckResult>>(),
}));
const callouts = vi.hoisted(() => ({
  show: vi.fn<(options: SidebarCalloutOptions) => () => void>(),
}));
const toast = vi.hoisted(() => ({ show: vi.fn(), error: vi.fn() }));
const palette = vi.hoisted(() => ({ actions: [] as CommandCenterContribution[] }));
// Hooks return stable values, as the real ones do; a fresh reporter per render rebuilds the updater.
const stable = vi.hoisted(() => ({
  reportError: () => {},
  desktopSettings: { settings: { releaseChannel: "stable" } },
  appSettings: { settings: { autoInstallUpdatesWhenIdle: false } },
}));

vi.mock("react-native-unistyles", () => ({
  useUnistyles: () => ({ theme: { colors: { foregroundMuted: "#888" }, iconSize: { sm: 16 } } }),
  withUnistyles: (component: unknown) => component,
}));
vi.mock("@/components/sidebar-callout", () => ({ SidebarCalloutDescriptionText: () => null }));
vi.mock("@/desktop/updates/desktop-updates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/desktop/updates/desktop-updates")>()),
  shouldShowDesktopUpdateSection: () => true,
  checkDesktopAppUpdate: port.check,
  installDesktopAppUpdate: vi.fn(),
}));
vi.mock("@/desktop/settings/desktop-settings", () => ({
  useDesktopSettings: () => stable.desktopSettings,
}));
vi.mock("@/desktop/hooks/desktop-ipc-error", () => ({
  useDesktopIpcErrorReporter: () => stable.reportError,
}));
vi.mock("@/desktop/updates/use-install-when-idle", () => {
  const activity = summarizeLocalHostActivity(null);
  return { useInstallWhenIdle: () => {}, useLocalHostActivity: () => activity };
});
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => stable.appSettings,
}));
vi.mock("@/contexts/sidebar-callout-context", () => ({ useSidebarCallouts: () => callouts }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/command-center/provider", () => ({
  useCommandCenterActions: ({ actions }: { actions: CommandCenterContribution[] }) => {
    palette.actions = actions;
  },
}));
vi.mock("@/changelog", () => ({ openChangelog: vi.fn() }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));

function paletteIds(): string[] {
  return palette.actions.map((action) => action.id);
}

async function mountUpToDate() {
  port.check.mockResolvedValue(buildFakeCheckResult({ currentVersion: "0.15.3-b245e51" }));
  render(<UpdateCalloutSource />);
  await waitFor(() => expect(paletteIds()).toEqual(["check-paseo-updates"]));
  port.check.mockClear();
}

async function runCheck() {
  const action = palette.actions.find((entry) => entry.id === "check-paseo-updates");
  await act(async () => {
    action?.run();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  palette.actions = [];
  callouts.show.mockImplementation(() => () => {});
});

afterEach(() => {
  cleanup();
});

describe("Check for Paseo updates", () => {
  it("reports a failed check in a toast without raising the Update failed callout", async () => {
    await mountUpToDate();
    const message = "Couldn't check for FSH updates: GitHub answered 403.";
    port.check.mockResolvedValue(buildFakeCheckResult({ errorMessage: message }));

    await runCheck();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(callouts.show).not.toHaveBeenCalled();
    expect(paletteIds()).toEqual(["check-paseo-updates"]);
  });

  it("swaps itself for Update Paseo when the check finds a ready update", async () => {
    await mountUpToDate();
    port.check.mockResolvedValue(
      buildFakeCheckResult({ hasUpdate: true, readyToInstall: true, latestVersion: "0.15.4-abc" }),
    );

    await runCheck();

    await waitFor(() => expect(paletteIds()).toEqual(["update-paseo"]));
    expect(toast.show).toHaveBeenLastCalledWith("Update ready: v0.15.4-abc", {
      variant: "success",
    });
    expect(callouts.show).toHaveBeenCalled();
  });
});

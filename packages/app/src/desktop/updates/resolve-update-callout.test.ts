import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  resolveUpdateCalloutDescriptor,
  type ResolveUpdateCalloutInput,
} from "./resolve-update-callout";

function input(overrides: Partial<ResolveUpdateCalloutInput> = {}): ResolveUpdateCalloutInput {
  return {
    isDesktopApp: true,
    status: "available",
    isInstalling: false,
    availableUpdate: { latestVersion: "1.2.3" },
    errorMessage: null,
    ...overrides,
  };
}

describe("resolveUpdateCalloutDescriptor", () => {
  it("returns null when not running as a desktop app", () => {
    expect(resolveUpdateCalloutDescriptor(input({ isDesktopApp: false }))).toBeNull();
  });

  it("returns null for idle / checking / up-to-date / pending statuses", () => {
    for (const status of ["idle", "checking", "up-to-date", "pending"] as const) {
      expect(resolveUpdateCalloutDescriptor(input({ status }))).toBeNull();
    }
  });

  it("builds an update-available descriptor with changelog + install actions", () => {
    const descriptor = resolveUpdateCalloutDescriptor(input());

    expect(descriptor).not.toBeNull();
    expect(descriptor?.id).toBe("desktop-update");
    expect(descriptor?.priority).toBe(200);
    expect(descriptor?.testID).toBe("update-callout");
    expect(descriptor?.title).toBe("Update available");
    expect(descriptor?.variant).toBe("default");
    expect(descriptor?.showGiftIcon).toBe(true);
    expect(descriptor?.body).toEqual({ kind: "available", versionLabel: "v1.2.3" });
    expect(descriptor?.actions).toEqual([
      { role: "changelog", label: "What's new" },
      { role: "install", label: "Install & restart", variant: "primary", disabled: false },
    ]);
    expect(descriptor?.dismissalKey).toBe("desktop-update:available:1.2.3");
  });

  it("offers install-when-idle in place of the changelog while local agents work", () => {
    const descriptor = resolveUpdateCalloutDescriptor(input({ localHostActivity: "busy" }));

    expect(descriptor?.actions).toEqual([
      { role: "installWhenIdle", label: "Install when idle" },
      { role: "install", label: "Install & restart", variant: "primary", disabled: false },
    ]);
  });

  it("builds a waiting descriptor with changelog + install-now actions", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ waitingForIdle: true, localHostActivity: "busy" }),
    );

    expect(descriptor?.title).toBe("Update waiting");
    expect(descriptor?.body).toEqual({
      kind: "waiting",
      versionLabel: "v1.2.3",
      message: "Installs as soon as no local agent is working.",
    });
    expect(descriptor?.showGiftIcon).toBe(true);
    expect(descriptor?.actions).toEqual([
      { role: "changelog", label: "What's new" },
      { role: "install", label: "Install now", variant: "primary" },
    ]);
    // Same key as the available callout: dismissing one hides both for this version.
    expect(descriptor?.dismissalKey).toBe("desktop-update:available:1.2.3");
  });

  it("updates a queued alert as local work finishes and resumes", () => {
    const describeActivity = (localHostActivity: "busy" | "idle" | "unknown") =>
      resolveUpdateCalloutDescriptor(input({ waitingForIdle: true, localHostActivity }));
    expect(describeActivity("busy")?.title).toBe("Update waiting");
    const idle = describeActivity("idle");
    expect(idle?.title).toBe("Installing soon");
    expect(idle?.body).toEqual({
      kind: "waiting",
      versionLabel: "v1.2.3",
      message: "No local agents are working. Installing after 15 seconds of inactivity.",
    });
    expect(describeActivity("busy")?.title).toBe("Update waiting");
    expect(describeActivity("unknown")?.body).toEqual({
      kind: "waiting",
      versionLabel: "v1.2.3",
      message: "Checking local workspace activity before installing.",
    });
    expect(idle?.dismissalKey).toBe(describeActivity("busy")?.dismissalKey);
  });

  it("ignores waitingForIdle once the install has started", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "installing", isInstalling: true, waitingForIdle: true }),
    );
    expect(descriptor?.body).toEqual({ kind: "installing" });
  });

  it("normalizes a leading v in the latest version", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ availableUpdate: { latestVersion: "v2.0.0" } }),
    );
    expect(descriptor?.body).toEqual({ kind: "available", versionLabel: "v2.0.0" });
  });

  it("omits the version label when no latest version is known", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ availableUpdate: { latestVersion: null } }),
    );
    expect(descriptor?.body).toEqual({ kind: "available", versionLabel: null });
    expect(descriptor?.dismissalKey).toBe("desktop-update:available:unknown");
  });

  it("disables the install action and labels it Installing... while installing", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "installing", isInstalling: true }),
    );

    expect(descriptor?.title).toBe("Installing update");
    expect(descriptor?.body).toEqual({ kind: "installing" });
    expect(descriptor?.showGiftIcon).toBe(false);
    expect(descriptor?.variant).toBe("default");
    expect(descriptor?.actions).toEqual([
      { role: "changelog", label: "What's new" },
      { role: "install", label: "Installing...", variant: "primary", disabled: true },
    ]);
    expect(descriptor?.dismissalKey).toBe("desktop-update:installing:1.2.3");
  });

  it("shows a retry action and surfaces the error message on error", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "error", errorMessage: "Download failed", availableUpdate: null }),
    );

    expect(descriptor?.title).toBe("Update failed");
    expect(descriptor?.body).toEqual({ kind: "error", message: "Download failed" });
    expect(descriptor?.variant).toBe("error");
    expect(descriptor?.showGiftIcon).toBe(false);
    expect(descriptor?.actions).toEqual([
      { role: "changelog", label: "What's new" },
      { role: "retry", label: "Retry", variant: "primary" },
    ]);
    expect(descriptor?.dismissalKey).toBe("desktop-update:error:unknown");
  });

  it("falls back to a generic error message when none is provided", () => {
    const descriptor = resolveUpdateCalloutDescriptor(
      input({ status: "error", errorMessage: null, availableUpdate: null }),
    );
    expect(descriptor?.body).toEqual({ kind: "error", message: "Something went wrong." });
  });

  it("encodes status and version into the dismissal key", () => {
    expect(
      resolveUpdateCalloutDescriptor(input({ availableUpdate: { latestVersion: "1.2.4" } }))
        ?.dismissalKey,
    ).toBe("desktop-update:available:1.2.4");
  });

  it("uses the active app language for local callout chrome", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      const descriptor = resolveUpdateCalloutDescriptor(input());

      expect(descriptor?.title).toBe("有可用更新");
      expect(descriptor?.actions).toEqual([
        { role: "changelog", label: "更新内容" },
        { role: "install", label: "安装并重启", variant: "primary", disabled: false },
      ]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

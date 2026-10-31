import type { DesktopAppUpdateStatus } from "@/desktop/updates/use-desktop-app-updater";
import { IDLE_INSTALL_QUIET_MS, type LocalHostActivity } from "./install-when-idle";
import { i18n } from "@/i18n/i18next";

export type UpdateCalloutBody =
  | { kind: "available"; versionLabel: string | null }
  | { kind: "waiting"; versionLabel: string | null; message: string }
  | { kind: "installing" }
  | { kind: "error"; message: string };

export type UpdateCalloutActionRole = "changelog" | "install" | "installWhenIdle" | "retry";

export interface UpdateCalloutActionDescriptor {
  role: UpdateCalloutActionRole;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export interface UpdateCalloutDescriptor {
  id: "desktop-update";
  dismissalKey: string;
  priority: number;
  title: string;
  body: UpdateCalloutBody;
  showGiftIcon: boolean;
  variant: "default" | "error";
  actions: UpdateCalloutActionDescriptor[];
  testID: "update-callout";
}

export interface ResolveUpdateCalloutInput {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  isInstalling: boolean;
  availableUpdate: { latestVersion?: string | null } | null;
  errorMessage: string | null;
  /** FSH: the update installs on its own once the local host goes idle. */
  waitingForIdle?: boolean;
  localHostActivity?: LocalHostActivity;
}

function formatVersionLabel(latestVersion: string | null | undefined): string | null {
  if (!latestVersion) return null;
  return `v${latestVersion.replace(/^v/i, "")}`;
}

function resolveActions(state: {
  isError: boolean;
  isInstalling: boolean;
  isWaiting: boolean;
  offerInstallWhenIdle: boolean;
}): UpdateCalloutActionDescriptor[] {
  const { isError, isInstalling, isWaiting } = state;
  // The callout shows two actions. While local agents are working, an update that isn't waiting
  // yet offers "Install when idle" in place of the changelog.
  const actions: UpdateCalloutActionDescriptor[] = [];
  if (state.offerInstallWhenIdle) {
    actions.push({
      role: "installWhenIdle",
      label: i18n.t("desktop.updates.callout.installWhenIdle"),
    });
  } else {
    actions.push({ role: "changelog", label: i18n.t("desktop.updates.callout.whatsNew") });
  }
  if (isError) {
    actions.push({ role: "retry", label: i18n.t("common.actions.retry"), variant: "primary" });
  } else if (isWaiting) {
    actions.push({
      role: "install",
      label: i18n.t("desktop.updates.callout.installNow"),
      variant: "primary",
    });
  } else {
    actions.push({
      role: "install",
      label: isInstalling
        ? i18n.t("desktop.updates.callout.installingAction")
        : i18n.t("desktop.updates.callout.installAndRestart"),
      variant: "primary",
      disabled: isInstalling,
    });
  }
  return actions;
}

export function resolveUpdateCalloutDescriptor(
  input: ResolveUpdateCalloutInput,
): UpdateCalloutDescriptor | null {
  if (!input.isDesktopApp) return null;
  if (input.status !== "available" && input.status !== "installing" && input.status !== "error") {
    return null;
  }

  const isError = input.status === "error";
  const isInstalling = input.isInstalling;
  const isAvailable = !isInstalling && !isError;
  const isWaiting = isAvailable && input.waitingForIdle === true;

  const latestVersion = input.availableUpdate?.latestVersion ?? null;
  const dismissalKey = `desktop-update:${input.status}:${latestVersion ?? "unknown"}`;

  let title: string;
  let body: UpdateCalloutBody;
  if (isInstalling) {
    title = i18n.t("desktop.updates.callout.installingTitle");
    body = { kind: "installing" };
  } else if (isError) {
    title = i18n.t("desktop.updates.callout.failedTitle");
    body = {
      kind: "error",
      message: input.errorMessage ?? i18n.t("desktop.updates.callout.genericError"),
    };
  } else if (isWaiting) {
    title = i18n.t(
      input.localHostActivity === "idle"
        ? "desktop.updates.callout.idleTitle"
        : "desktop.updates.callout.waitingTitle",
    );
    body = {
      kind: "waiting",
      versionLabel: formatVersionLabel(latestVersion),
      message: i18n.t(
        {
          idle: "desktop.updates.callout.idleDescription",
          busy: "desktop.updates.callout.waitingDescription",
          unknown: "desktop.updates.callout.checkingActivityDescription",
        }[input.localHostActivity ?? "unknown"],
        { seconds: IDLE_INSTALL_QUIET_MS / 1000 },
      ),
    };
  } else {
    title = i18n.t("desktop.updates.callout.availableTitle");
    body = { kind: "available", versionLabel: formatVersionLabel(latestVersion) };
  }

  const actions = resolveActions({
    isError,
    isInstalling,
    isWaiting,
    offerInstallWhenIdle: isAvailable && !isWaiting && input.localHostActivity === "busy",
  });

  return {
    id: "desktop-update",
    dismissalKey,
    priority: 200,
    title,
    body,
    showGiftIcon: isAvailable,
    variant: isError ? "error" : "default",
    actions,
    testID: "update-callout",
  };
}

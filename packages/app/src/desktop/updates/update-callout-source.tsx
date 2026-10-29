import { Gift } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUnistyles } from "react-native-unistyles";
import {
  type SidebarCalloutAction,
  SidebarCalloutDescriptionText,
} from "@/components/sidebar-callout";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import {
  resolveUpdateCalloutDescriptor,
  type UpdateCalloutActionDescriptor,
  type UpdateCalloutBody,
} from "@/desktop/updates/resolve-update-callout";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { useInstallWhenIdle, useLocalHostActivity } from "@/desktop/updates/use-install-when-idle";
import { useAppSettings } from "@/hooks/use-settings";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openChangelog } from "@/changelog";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function renderBody(body: UpdateCalloutBody, t: ReturnType<typeof useTranslation>["t"]): ReactNode {
  if (body.kind === "installing") return t("desktop.updates.callout.installingDescription");
  if (body.kind === "error") return body.message;
  return (
    <UpdateAvailableDescription
      versionLabel={body.versionLabel ?? undefined}
      waiting={body.kind === "waiting"}
      t={t}
    />
  );
}

function materializeActions(
  actions: readonly UpdateCalloutActionDescriptor[],
  handlers: Record<UpdateCalloutActionDescriptor["role"], () => void>,
): SidebarCalloutAction[] {
  return actions.map((action) => ({
    label: action.label,
    onPress: handlers[action.role],
    variant: action.variant,
    disabled: action.disabled,
  }));
}

export function UpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { theme } = useUnistyles();
  const {
    isDesktopApp,
    status,
    availableUpdate,
    errorMessage,
    checkForUpdates,
    installUpdate,
    isInstalling,
  } = useDesktopAppUpdater();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoInstallWhenIdle = useAppSettings().settings.autoInstallUpdatesWhenIdle;
  // Per-version choice from the callout; overrides the setting for that version only.
  const [idleChoice, setIdleChoice] = useState<{ version: string; wait: boolean } | null>(null);
  const latestVersion = availableUpdate?.latestVersion ?? "";
  const waitingForIdle =
    status === "available" &&
    !isInstalling &&
    (idleChoice?.version === latestVersion ? idleChoice.wait : autoInstallWhenIdle);

  const install = useStableEvent(() => {
    void installUpdate();
  });
  const retry = useStableEvent(() => {
    void checkForUpdates();
  });
  const installWhenIdle = useStableEvent(() => {
    setIdleChoice({ version: latestVersion, wait: true });
  });
  const cancelWaiting = useStableEvent(() => {
    setIdleChoice({ version: latestVersion, wait: false });
  });
  const localHostActivity = useLocalHostActivity();
  useInstallWhenIdle({ activity: localHostActivity, enabled: waitingForIdle, onIdle: install });
  useEffect(() => {
    if (!isDesktopApp) return;

    void checkForUpdates({ intent: "automatic", silent: true });

    intervalRef.current = setInterval(() => {
      void checkForUpdates({ intent: "automatic", silent: true });
    }, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isDesktopApp, checkForUpdates]);

  useEffect(() => {
    const descriptor = resolveUpdateCalloutDescriptor({
      isDesktopApp,
      status,
      isInstalling,
      availableUpdate,
      errorMessage,
      waitingForIdle,
      localHostBusy: localHostActivity === "busy",
    });
    if (!descriptor) return;

    return callouts.show({
      id: descriptor.id,
      dismissalKey: descriptor.dismissalKey,
      priority: descriptor.priority,
      title: descriptor.title,
      description: renderBody(descriptor.body, t),
      icon: descriptor.showGiftIcon ? (
        <Gift size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      ) : undefined,
      variant: descriptor.variant,
      actions: materializeActions(descriptor.actions, {
        changelog: openChangelog,
        install,
        installWhenIdle,
        retry,
      }),
      // Dismissing a waiting update also stops the wait.
      onDismiss: waitingForIdle ? cancelWaiting : undefined,
      testID: descriptor.testID,
    });
  }, [
    availableUpdate,
    callouts,
    cancelWaiting,
    errorMessage,
    install,
    installWhenIdle,
    isDesktopApp,
    isInstalling,
    localHostActivity,
    retry,
    status,
    waitingForIdle,
    theme.colors.foregroundMuted,
    theme.iconSize.sm,
    t,
  ]);

  return null;
}

function UpdateAvailableDescription({
  versionLabel,
  waiting,
  t,
}: {
  versionLabel?: string;
  waiting: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <>
      <SidebarCalloutDescriptionText>
        {versionLabel
          ? t("desktop.updates.callout.versionReady", { version: versionLabel })
          : t("desktop.updates.callout.newVersionReady")}
      </SidebarCalloutDescriptionText>
      {waiting ? (
        <SidebarCalloutDescriptionText>
          {t("desktop.updates.callout.waitingDescription")}
        </SidebarCalloutDescriptionText>
      ) : null}
      <SidebarCalloutDescriptionText>
        {t("desktop.updates.callout.restartWarning")}
      </SidebarCalloutDescriptionText>
    </>
  );
}

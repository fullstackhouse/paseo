import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { DesktopPermissionRow } from "@/desktop/components/desktop-permission-row";
import { useDesktopPermissions } from "@/desktop/permissions/use-desktop-permissions";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import {
  previewNotificationSound,
  useNotificationSounds,
} from "@/desktop/settings/notification-sounds";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { SettingsRevealText } from "@/components/settings/reveal-text";

const ThemedRotateCw = withUnistyles(RotateCw, (theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foregroundMuted,
}));

export function DesktopNotificationsSection() {
  const { t } = useTranslation();
  const { settings, isSaving, updateSettings } = useDesktopSettings();
  const {
    isDesktopApp,
    snapshot,
    isRefreshing,
    requestingPermission,
    testNotificationState,
    refreshPermissions,
    requestPermission,
    sendTestNotification,
  } = useDesktopPermissions();

  const handleRefreshPress = useCallback(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  const handleRequestNotifications = useCallback(() => {
    void requestPermission("notifications");
  }, [requestPermission]);

  const handlePlaySoundChange = useCallback(
    (playSound: boolean) => {
      void updateSettings({ notifications: { playSound } }).catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      });
    },
    [updateSettings],
  );

  const handleSoundChange = useCallback(
    (sound: string | null) => {
      if (sound) {
        previewNotificationSound(sound);
      }
      void updateSettings({ notifications: { sound } }).catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      });
    },
    [updateSettings],
  );

  const handleSendTestNotification = useCallback(() => {
    void sendTestNotification();
  }, [sendTestNotification]);

  const isPermissionBusy = isRefreshing || requestingPermission !== null;
  const isSendingTestNotification = testNotificationState.status === "sending";
  const refreshIcon = useMemo(() => <ThemedRotateCw />, []);
  const refreshButton = useMemo(
    () => (
      <Button
        variant="ghost"
        leftIcon={refreshIcon}
        onPress={handleRefreshPress}
        disabled={isPermissionBusy}
        accessibilityLabel={t("settings.notifications.refreshAccessibility")}
      >
        {isRefreshing ? t("settings.permissions.refreshing") : t("settings.permissions.refresh")}
      </Button>
    ),
    [handleRefreshPress, isPermissionBusy, isRefreshing, refreshIcon, t],
  );
  const permissionLabels = useMemo(
    () => ({
      granted: t("settings.permissions.actions.granted"),
      request: t("settings.permissions.actions.request"),
      requesting: t("settings.permissions.actions.requesting"),
    }),
    [t],
  );

  if (!isDesktopApp) {
    return null;
  }

  const notificationsGranted = snapshot?.notifications.state === "granted";

  return (
    <SettingsSection title={t("settings.notifications.title")} trailing={refreshButton}>
      <View style={settingsStyles.card}>
        <DesktopPermissionRow
          title={t("settings.notifications.permission")}
          status={snapshot?.notifications ?? null}
          isRequesting={requestingPermission === "notifications"}
          onRequest={handleRequestNotifications}
          labels={permissionLabels}
        />
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <SettingsRevealText style={settingsStyles.rowTitle}>
              {t("settings.notifications.playSound")}
            </SettingsRevealText>
            <Text style={settingsStyles.rowHint}>{t("settings.notifications.playSoundHint")}</Text>
          </View>
          <Switch
            value={settings.notifications.playSound}
            onValueChange={handlePlaySoundChange}
            disabled={isSaving}
            accessibilityLabel={t("settings.notifications.playSound")}
            testID="desktop-notifications-play-sound-switch"
          />
        </View>
        <NotificationSoundRow
          value={settings.notifications.sound}
          disabled={isSaving || !settings.notifications.playSound}
          onChange={handleSoundChange}
        />
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <SettingsRevealText style={settingsStyles.rowTitle}>
              {t("settings.notifications.test")}
            </SettingsRevealText>
            <Text style={settingsStyles.rowHint}>
              {notificationsGranted
                ? t("settings.notifications.testHint")
                : t("settings.notifications.permissionRequired")}
            </Text>
          </View>
          <Button
            variant="outline"
            onPress={handleSendTestNotification}
            disabled={!notificationsGranted || isPermissionBusy || isSendingTestNotification}
          >
            {isSendingTestNotification
              ? t("settings.notifications.sending")
              : t("settings.notifications.send")}
          </Button>
        </View>
      </View>
      {testNotificationState.status === "success" ? (
        <Alert
          size="sm"
          variant="success"
          title={t("settings.notifications.sentTitle")}
          description={t("settings.notifications.sentDescription")}
          testID="desktop-notifications-test-success"
        />
      ) : null}
      {testNotificationState.status === "error" ? (
        <Alert
          size="sm"
          variant="error"
          title={t("settings.notifications.sendFailedTitle")}
          description={testNotificationState.message}
          testID="desktop-notifications-test-error"
        />
      ) : null}
    </SettingsSection>
  );
}

function NotificationSoundRow({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (sound: string | null) => void;
}) {
  const { t } = useTranslation();
  const sounds = useNotificationSounds();
  if (sounds.length === 0) {
    return null;
  }
  const label = t("settings.notifications.sound");
  const selectedLabel = value ?? t("settings.notifications.soundDefault");
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <SettingsRevealText style={settingsStyles.rowTitle}>{label}</SettingsRevealText>
        <Text style={settingsStyles.rowHint}>{t("settings.notifications.soundHint")}</Text>
      </View>
      <DropdownMenu>
        <DropdownTrigger
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${selectedLabel}`}
          testID="desktop-notifications-sound-trigger"
        >
          {selectedLabel}
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={220} maxHeight={360} scrollable>
          <SoundOption
            sound={null}
            label={t("settings.notifications.soundDefault")}
            selected={value === null}
            onSelect={onChange}
          />
          {sounds.map((sound) => (
            <SoundOption
              key={sound}
              sound={sound}
              label={sound}
              selected={sound === value}
              onSelect={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function SoundOption({
  sound,
  label,
  selected,
  onSelect,
}: {
  sound: string | null;
  label: string;
  selected: boolean;
  onSelect: (sound: string | null) => void;
}) {
  const select = useCallback(() => onSelect(sound), [onSelect, sound]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select}>
      {label}
    </DropdownMenuItem>
  );
}

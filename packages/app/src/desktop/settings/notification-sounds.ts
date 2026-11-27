import { getIsElectron } from "@/constants/platform";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { useFetchQuery } from "@/data/query";

/**
 * Sounds the desktop notification can name on this OS: system and user sounds on
 * macOS, the freedesktop sound theme on Linux. Empty where the OS picks the sound
 * (Windows), so callers hide the picker.
 */
export function useNotificationSounds(): string[] {
  const { data } = useFetchQuery<string[]>({
    queryKey: ["desktop-notification-sounds"],
    queryFn: async () => {
      const sounds = await invokeDesktopCommand<unknown>("list_notification_sounds");
      return Array.isArray(sounds)
        ? sounds.filter((sound): sound is string => typeof sound === "string")
        : [];
    },
    enabled: getIsElectron(),
    dataShape: "value",
    // Refetch now and then so sounds added to ~/Library/Sounds show up.
    staleTimeMs: 60_000,
    retry: false,
  });
  return data ?? [];
}

/** Plays a sound once while the user chooses. Best effort: a missing player stays silent. */
export function previewNotificationSound(name: string): void {
  void invokeDesktopCommand("preview_notification_sound", { name }).catch(() => {});
}

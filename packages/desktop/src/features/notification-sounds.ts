import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The notification server plays the sound, so only platforms that let us name
// one list sounds. Windows toasts take no sound name from Electron; it keeps the
// system sound.
//
// macOS: Electron passes the name to UNNotificationSound, which looks the file up
// in these folders. Users add their own sounds to ~/Library/Sounds.
// Linux: the notify-send `sound-name` hint names a sound from the XDG sound
// theme; every theme falls back to `freedesktop`, so its names always resolve.

export interface NotificationSound {
  name: string;
  filePath: string;
}

const SOUND_EXTENSIONS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: [".aiff", ".aif", ".caf", ".wav", ".m4a", ".mp3"],
  linux: [".oga", ".ogg", ".wav"],
};

// Names longer than this, or with a path separator, never name a sound we listed.
const MAX_SOUND_NAME_LENGTH = 100;

export function isNotificationSoundName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SOUND_NAME_LENGTH &&
    value.trim() === value &&
    !/[/\\]/.test(value) &&
    !value.includes("\0")
  );
}

export function notificationSoundDirectories(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string[] {
  if (platform === "darwin") {
    return [
      path.join(homeDir, "Library/Sounds"),
      "/Library/Sounds",
      "/Network/Library/Sounds",
      "/System/Library/Sounds",
    ];
  }
  if (platform === "linux") {
    const dataHome = env.XDG_DATA_HOME || path.join(homeDir, ".local/share");
    const dataDirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
      .split(":")
      .filter(Boolean);
    return [dataHome, ...dataDirs].map((dir) => path.join(dir, "sounds/freedesktop/stereo"));
  }
  return [];
}

type ReadDir = (dir: string) => Promise<string[]>;

const readDirNames: ReadDir = (dir) => readdir(dir);

/** Sounds in the first directory win, so a user's sound shadows a system one of the same name. */
export async function listNotificationSounds(
  platform: NodeJS.Platform = process.platform,
  directories: string[] = notificationSoundDirectories(platform, process.env, os.homedir()),
  readDirFn: ReadDir = readDirNames,
): Promise<NotificationSound[]> {
  const extensions = SOUND_EXTENSIONS[platform];
  if (!extensions) {
    return [];
  }
  const byName = new Map<string, NotificationSound>();
  for (const dir of directories) {
    let entries: string[];
    try {
      entries = await readDirFn(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const extension = path.extname(entry);
      const name = path.basename(entry, extension);
      if (!extensions.includes(extension.toLowerCase()) || !isNotificationSoundName(name)) {
        continue;
      }
      if (!byName.has(name)) {
        byName.set(name, { name, filePath: path.join(dir, entry) });
      }
    }
  }
  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

const PREVIEW_PLAYERS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "afplay",
  linux: "paplay",
};

/** Plays a listed sound once so the user hears it while choosing. Unknown names do nothing. */
export async function previewNotificationSound(name: unknown): Promise<boolean> {
  const player = PREVIEW_PLAYERS[process.platform];
  if (!player || !isNotificationSoundName(name)) {
    return false;
  }
  const sound = (await listNotificationSounds()).find((candidate) => candidate.name === name);
  if (!sound) {
    return false;
  }
  const child = spawn(player, [sound.filePath], { stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  return true;
}

export function createNotificationSoundCommandHandlers(): Record<
  string,
  (args?: Record<string, unknown>) => unknown
> {
  return {
    list_notification_sounds: async () =>
      (await listNotificationSounds()).map((sound) => sound.name),
    preview_notification_sound: (args) => previewNotificationSound(args?.name),
  };
}

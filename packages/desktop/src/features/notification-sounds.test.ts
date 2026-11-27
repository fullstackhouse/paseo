import { describe, expect, it } from "vitest";

import {
  isNotificationSoundName,
  listNotificationSounds,
  notificationSoundDirectories,
} from "./notification-sounds";

function fakeDirs(tree: Record<string, string[]>) {
  return async (dir: string) => {
    const entries = tree[dir];
    if (!entries) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return entries;
  };
}

describe("notification sounds", () => {
  it("lists macOS sounds by name, user sounds shadowing system ones", async () => {
    const sounds = await listNotificationSounds(
      "darwin",
      ["/Users/me/Library/Sounds", "/Library/Sounds", "/System/Library/Sounds"],
      fakeDirs({
        "/Users/me/Library/Sounds": ["Glass.caf", "chime.wav", "notes.txt", ".DS_Store"],
        "/System/Library/Sounds": ["Glass.aiff", "Basso.aiff", "Tink.aiff"],
      }),
    );

    expect(sounds).toEqual([
      { name: "Basso", filePath: "/System/Library/Sounds/Basso.aiff" },
      { name: "chime", filePath: "/Users/me/Library/Sounds/chime.wav" },
      { name: "Glass", filePath: "/Users/me/Library/Sounds/Glass.caf" },
      { name: "Tink", filePath: "/System/Library/Sounds/Tink.aiff" },
    ]);
  });

  it("lists freedesktop theme sounds on Linux", async () => {
    const directories = notificationSoundDirectories(
      "linux",
      { XDG_DATA_DIRS: "/usr/share" },
      "/home/me",
    );
    expect(directories).toEqual([
      "/home/me/.local/share/sounds/freedesktop/stereo",
      "/usr/share/sounds/freedesktop/stereo",
    ]);

    const sounds = await listNotificationSounds(
      "linux",
      directories,
      fakeDirs({
        "/usr/share/sounds/freedesktop/stereo": ["bell.oga", "complete.oga", "index.theme"],
      }),
    );
    expect(sounds.map((sound) => sound.name)).toEqual(["bell", "complete"]);
  });

  it("lists nothing where the notification can't name a sound", async () => {
    expect(notificationSoundDirectories("win32", {}, "C:\\Users\\me")).toEqual([]);
    expect(await listNotificationSounds("win32", ["C:\\Windows\\Media"], fakeDirs({}))).toEqual([]);
  });

  it("accepts only plain sound names", () => {
    expect(isNotificationSoundName("Glass")).toBe(true);
    expect(isNotificationSoundName("message-new-instant")).toBe(true);
    expect(isNotificationSoundName("")).toBe(false);
    expect(isNotificationSoundName(" Glass")).toBe(false);
    expect(isNotificationSoundName("../Glass")).toBe(false);
    expect(isNotificationSoundName("a".repeat(101))).toBe(false);
    expect(isNotificationSoundName(null)).toBe(false);
  });
});

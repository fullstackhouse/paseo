import { spawn, type ChildProcess } from "node:child_process";

// Electron sends Linux notifications through libnotify without a `sound-name`
// hint, and GNOME and KDE play nothing without one. Electron exposes no hint
// option, so notifications that should chime go through notify-send instead.
// The notification server plays the sound itself, which keeps Do Not Disturb,
// per-app sound settings and the sound theme in charge.
export const LINUX_NOTIFICATION_SOUND_NAME = "message-new-instant";

const CLICK_ACTION = "default";

// With an action, notify-send waits until the notification closes. KDE keeps
// notifications in its history and never closes them, so stop waiting after
// this long; a click from the history after that does nothing.
const WAIT_FOR_CLICK_MS = 30 * 60 * 1000;

export interface LinuxNotificationInput {
  appName: string;
  title: string;
  body?: string;
  iconPath: string | null;
}

export interface LinuxNotificationHandlers {
  onClick: () => void;
  /** notify-send is missing or the server refused the notification. */
  onFailed: () => void;
}

export type SpawnNotifySend = (command: string, args: string[]) => ChildProcess;

const waiting = new Set<() => void>();

/** Stops every notify-send still waiting for a click, so none outlive the app. */
export function stopWaitingForLinuxNotifications(): void {
  for (const stop of waiting) {
    stop();
  }
}

const spawnNotifySend: SpawnNotifySend = (command, args) =>
  spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });

export function buildNotifySendArgs(input: LinuxNotificationInput): string[] {
  return [
    `--app-name=${input.appName}`,
    "--urgency=normal",
    `--hint=string:desktop-entry:${input.appName}`,
    `--hint=string:sound-name:${LINUX_NOTIFICATION_SOUND_NAME}`,
    `--action=${CLICK_ACTION}=Open`,
    ...(input.iconPath ? [`--icon=${input.iconPath}`] : []),
    "--",
    input.title,
    ...(input.body ? [input.body] : []),
  ];
}

export function showLinuxNotificationWithSound(
  input: LinuxNotificationInput,
  handlers: LinuxNotificationHandlers,
  spawnFn: SpawnNotifySend = spawnNotifySend,
): void {
  let child: ChildProcess;
  try {
    child = spawnFn("notify-send", buildNotifySendArgs(input));
  } catch {
    handlers.onFailed();
    return;
  }

  let settled = false;
  let stdout = "";

  const settle = (outcome: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(stopTimer);
    waiting.delete(stop);
    outcome();
  };
  // Settle first: notify-send may exit non-zero on the signal, which must not
  // count as a failed notification.
  const stop = () => settle(() => child.kill());
  const stopTimer = setTimeout(stop, WAIT_FOR_CLICK_MS);
  stopTimer.unref();
  waiting.add(stop);

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.once("error", () => settle(handlers.onFailed));
  child.once("close", (code) => {
    if (code !== null && code !== 0) {
      settle(handlers.onFailed);
      return;
    }
    const clicked = stdout.split("\n").some((line) => line.trim() === CLICK_ACTION);
    settle(clicked ? handlers.onClick : () => {});
  });
}

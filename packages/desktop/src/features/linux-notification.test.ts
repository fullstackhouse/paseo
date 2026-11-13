import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  buildNotifySendArgs,
  showLinuxNotificationWithSound,
  stopWaitingForLinuxNotifications,
} from "./linux-notification";

class FakeNotifySend extends EventEmitter {
  stdout = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit("close", 1);
    return true;
  }
}

function show(child: FakeNotifySend) {
  const outcomes: string[] = [];
  showLinuxNotificationWithSound(
    { appName: "Paseo", title: "Agent finished", body: "Done", iconPath: null },
    { onClick: () => outcomes.push("click"), onFailed: () => outcomes.push("failed") },
    () => child as unknown as ChildProcess,
  );
  return outcomes;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("linux notification with sound", () => {
  it("asks the notification server to play the sound", () => {
    expect(
      buildNotifySendArgs({
        appName: "Paseo",
        title: "-starts with a dash",
        body: "Done",
        iconPath: "/opt/Paseo/icon.png",
      }),
    ).toEqual([
      "--app-name=Paseo",
      "--urgency=normal",
      "--hint=string:desktop-entry:Paseo",
      "--hint=string:sound-name:message-new-instant",
      "--action=default=Open",
      "--icon=/opt/Paseo/icon.png",
      "--",
      "-starts with a dash",
      "Done",
    ]);
  });

  it("reports a click when notify-send prints the default action", async () => {
    const child = new FakeNotifySend();
    const outcomes = show(child);

    child.stdout.write("default\n");
    await flush();
    child.emit("close", 0);

    expect(outcomes).toEqual(["click"]);
  });

  it("does nothing when the notification is dismissed", () => {
    const child = new FakeNotifySend();
    const outcomes = show(child);

    child.emit("close", 0);

    expect(outcomes).toEqual([]);
  });

  it("fails over when notify-send is missing or the server refuses it", () => {
    const missing = new FakeNotifySend();
    const missingOutcomes = show(missing);
    missing.emit("error", new Error("spawn notify-send ENOENT"));
    missing.emit("close", -2);

    const refused = new FakeNotifySend();
    const refusedOutcomes = show(refused);
    refused.emit("close", 1);

    expect(missingOutcomes).toEqual(["failed"]);
    expect(refusedOutcomes).toEqual(["failed"]);
  });

  it("stops waiting on quit without counting it as a failure", () => {
    const child = new FakeNotifySend();
    const outcomes = show(child);

    stopWaitingForLinuxNotifications();

    expect(child.killed).toBe(true);
    expect(outcomes).toEqual([]);
  });
});

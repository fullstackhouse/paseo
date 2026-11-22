import { describe, expect, it } from "vitest";
import type { BrowserLiveFocus } from "@getpaseo/protocol/browser-automation/live-view";
import {
  createBrowserControl,
  getControlAvailability,
  getScreenScale,
  toScreenPoint,
  type BrowserControlClient,
  type BrowserControlState,
} from "./control";

const SENTINEL = "LV3-SENTINEL-app";
const FIELD: BrowserLiveFocus = {
  targetId: "target-1",
  kind: "password",
  origin: "https://idp.example",
  topOrigin: "https://app.example",
};
const REFUSE = (code: string) => ({ focus: null, error: { code, message: "English detail" } });

function createHarness() {
  const calls: unknown[] = [];
  const states: BrowserControlState[] = [];
  const answers = {
    take: { focus: FIELD as BrowserLiveFocus | null, error: null } as
      | ReturnType<typeof REFUSE>
      | object,
    input: { focus: null, error: null } as object,
    release: { error: null } as object,
  };
  let failWith: Error | null = null;
  const answer = async (kind: keyof typeof answers, streamId: string) => {
    if (failWith) throw failWith;
    return { requestId: "r", streamId, ...answers[kind] };
  };
  const client = {
    takeBrowserLiveControl: (streamId: string) => {
      calls.push(["take", streamId]);
      return answer("take", streamId);
    },
    sendBrowserLiveInput: (streamId: string, input: unknown) => {
      calls.push(["input", streamId, input]);
      return answer("input", streamId);
    },
    releaseBrowserLiveControl: (streamId: string) => {
      calls.push(["release", streamId]);
      return answer("release", streamId);
    },
  } as unknown as BrowserControlClient;
  const control = createBrowserControl({ client, onChange: (state) => states.push(state) });
  const state = () => states.at(-1)!;
  const watch = (held = false, streamId = "s1") =>
    control.setStream({ streamId, control: { held } });
  const controlled = async () => {
    watch();
    control.setOrigin("https://app.example");
    await control.take();
  };
  const type = () => control.send({ kind: "insert_text", targetId: "target-1", text: SENTINEL });
  return {
    control,
    calls,
    answers,
    states,
    state,
    watch,
    controlled,
    type,
    fail: (error: Error) => (failWith = error),
  };
}

describe("createBrowserControl", () => {
  it("stays read-only until Take control, and sends no input before that", async () => {
    const harness = createHarness();
    harness.watch();

    await harness.control.send({ kind: "tap", documentId: "s1:0", x: 1, y: 2 });

    expect(harness.calls).toEqual([]);
    expect(harness.state()).toMatchObject({
      held: false,
      focus: null,
      desktopSupportsControl: true,
    });
  });

  it("shows the focused field's origins after taking control", async () => {
    const harness = createHarness();
    await harness.controlled();
    expect(harness.state()).toMatchObject({ held: true, focus: FIELD, notice: null, busy: null });
  });

  it("stays read-only and says why when taking control fails", async () => {
    const harness = createHarness();
    harness.answers.take = REFUSE("agent_busy");
    harness.watch();
    await harness.control.take();
    expect(harness.state()).toMatchObject({ held: false, notice: "agent_busy", busy: null });
  });

  it("marks a desktop that can only be watched", () => {
    const harness = createHarness();
    harness.control.setStream({ streamId: "s1", control: null });
    expect(harness.state().desktopSupportsControl).toBe(false);
  });

  it("keeps the field and its binding through backgrounding for a password manager", async () => {
    const harness = createHarness();
    await harness.controlled();

    harness.control.setStream(null);
    expect(harness.state()).toMatchObject({ held: true, connected: false, focus: FIELD });

    harness.watch(true, "s2");
    expect(harness.state()).toMatchObject({ held: true, connected: true, focus: FIELD });
    await harness.type();
    expect(harness.calls.at(-1)).toEqual([
      "input",
      "s2",
      { kind: "insert_text", targetId: "target-1", text: SENTINEL },
    ]);
  });

  it("says so when control ran out while the phone was away", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.control.setStream(null);
    harness.watch(false, "s2");
    expect(harness.state()).toMatchObject({ held: false, focus: null, notice: "released" });
  });

  it("stops showing control when the daemon says it's over", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.control.streamEnded(false);
    expect(harness.state()).toMatchObject({ held: false, focus: null, notice: "released" });
  });

  it.each([true, null])("keeps control through an end that says held: %s", async (held) => {
    const harness = createHarness();
    await harness.controlled();
    harness.control.streamEnded(held);
    expect(harness.state()).toMatchObject({ held: true, focus: FIELD });
  });

  it("keeps control when only the stream is gone", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.answers.input = REFUSE("stream_ended");
    await harness.control.send({ kind: "key", key: "Tab" });
    expect(harness.state()).toMatchObject({ held: true, focus: FIELD, notice: "stream_ended" });
  });

  it("drops the field when a tap was refused for a page change", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.answers.input = REFUSE("page_changed");
    await harness.control.send({ kind: "tap", documentId: "s1:0", x: 1, y: 2 });
    expect(harness.state()).toMatchObject({ held: true, focus: null, notice: "page_changed" });
  });

  it("drops control when a hand-back finds this device no longer has it", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.answers.release = { error: { code: "not_controller", message: "English detail" } };
    await harness.control.handBack();
    expect(harness.state()).toMatchObject({ held: false, focus: null, notice: "released" });
  });

  it("drops the field when the page moves to another origin", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.control.setOrigin("https://elsewhere.example");
    expect(harness.state()).toMatchObject({
      origin: "https://elsewhere.example",
      focus: null,
      notice: "target_changed",
    });
  });

  it("keeps the field when the frames catch up with the origin it was shown with", async () => {
    const harness = createHarness();
    harness.watch();
    harness.control.setOrigin("https://previous.example");
    await harness.control.take();
    harness.control.setOrigin("https://app.example");
    expect(harness.state()).toMatchObject({ focus: FIELD, notice: null });
  });

  it.each(["target_changed", "unconfirmed"])(
    "drops the field after %s and never sends the text again",
    async (code) => {
      const harness = createHarness();
      await harness.controlled();
      harness.answers.input = REFUSE(code);

      await harness.type();

      expect(harness.state()).toMatchObject({ held: true, focus: null, notice: code });
      expect(JSON.stringify(harness.calls).split(SENTINEL)).toHaveLength(2);
    },
  );

  it("treats a text send that threw as unconfirmed, without echoing it", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.fail(new Error(`Request failed: ${SENTINEL}`));

    await harness.type();

    expect(harness.state()).toMatchObject({ focus: null, notice: "unconfirmed" });
    expect(JSON.stringify(harness.states)).not.toContain(SENTINEL);
  });

  it("keeps the field when only a key was refused", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.answers.input = REFUSE("key_unsupported");
    await harness.control.send({ kind: "key", key: "Enter" });
    expect(harness.state()).toMatchObject({ focus: FIELD, notice: "key_unsupported" });
  });

  it("follows focus after the user's own input", async () => {
    const harness = createHarness();
    await harness.controlled();
    const next = { ...FIELD, targetId: "target-2", kind: "one_time_code" };
    harness.answers.input = { focus: next, error: null };
    await harness.control.send({ kind: "key", key: "Tab" });
    expect(harness.state()).toMatchObject({ focus: next, notice: null });
  });

  it("sends one input at a time", async () => {
    const harness = createHarness();
    await harness.controlled();
    await Promise.all([
      harness.control.send({ kind: "key", key: "Tab" }),
      harness.control.send({ kind: "key", key: "Enter" }),
    ]);
    expect(harness.calls.filter((call) => (call as string[])[0] === "input")).toHaveLength(1);
  });

  it("drops control when the daemon says this device no longer has it", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.answers.input = REFUSE("not_controller");
    await harness.control.send({ kind: "key", key: "Tab" });
    expect(harness.state()).toMatchObject({ held: false, focus: null, notice: "released" });
  });

  it("hands back", async () => {
    const harness = createHarness();
    await harness.controlled();
    await harness.control.handBack();
    expect(harness.calls.at(-1)).toEqual(["release", "s1"]);
    expect(harness.state()).toMatchObject({ held: false, focus: null, notice: null });
  });

  it("keeps control when the hand-back failed", async () => {
    const harness = createHarness();
    await harness.controlled();
    harness.answers.release = { error: { code: "failed", message: "English detail" } };
    await harness.control.handBack();
    expect(harness.state()).toMatchObject({ held: true, notice: "failed" });
  });
});

describe("getControlAvailability", () => {
  const watching = { desktopSupportsControl: true, held: false };
  it("names what to update", () => {
    expect(getControlAvailability(false, watching)).toBe("update_host");
    expect(getControlAvailability(true, { ...watching, desktopSupportsControl: false })).toBe(
      "update_desktop",
    );
    expect(getControlAvailability(true, { ...watching, desktopSupportsControl: null })).toBe(
      "unknown",
    );
    expect(getControlAvailability(true, watching)).toBe("ready");
  });
});

describe("toScreenPoint", () => {
  const screen = { width: 1000, height: 500, offsetTop: 0 };
  const tall = { width: 400, height: 600 };

  it("maps through the letterbox of a contained image", () => {
    expect(getScreenScale(tall, screen)).toBe(0.4);
    expect(toScreenPoint({ x: 200, y: 300 }, tall, screen)).toEqual({ x: 500, y: 250 });
    expect(toScreenPoint({ x: 0, y: 200 }, tall, screen)).toEqual({ x: 0, y: 0 });
  });

  it("ignores touches outside the image", () => {
    expect(toScreenPoint({ x: 200, y: 100 }, tall, screen)).toBeNull();
  });

  it("subtracts the top offset", () => {
    expect(toScreenPoint({ x: 200, y: 300 }, tall, { ...screen, offsetTop: 10 })).toEqual({
      x: 500,
      y: 240,
    });
  });
});

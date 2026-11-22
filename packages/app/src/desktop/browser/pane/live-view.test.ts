import { describe, expect, it } from "vitest";
import type { BrowserLiveFrame } from "@getpaseo/protocol/binary-frames/browser-live";
import type { BrowserLiveEnded } from "@getpaseo/protocol/browser-automation/live-view";
import {
  createBrowserLiveView,
  type BrowserLiveViewClient,
  type BrowserLiveViewState,
  type BrowserLiveViewStreamInfo,
} from "./live-view";

type StartResult = Awaited<ReturnType<BrowserLiveViewClient["startBrowserLiveView"]>>;
type EndedPayload = BrowserLiveEnded["payload"];

const OPTIONS = { maxFps: 5, jpegQuality: 60, maxWidth: 1080 };
const METADATA = {
  deviceWidth: 1280,
  deviceHeight: 800,
  offsetTop: 0,
  pageScaleFactor: 1,
  scrollOffsetX: 0,
  scrollOffsetY: 0,
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function startedResult(streamId: string): StartResult {
  return { requestId: "r", streamId, viewport: { width: 1280, height: 800 }, error: null };
}

function createHarness() {
  const starts: Array<ReturnType<typeof createDeferred<StartResult>>> = [];
  const startInputs: unknown[] = [];
  const stops: string[] = [];
  const acks: Array<[string, number]> = [];
  const frameHandlers = new Set<(frame: BrowserLiveFrame) => void>();
  const endedHandlers = new Set<(ended: EndedPayload) => void>();
  const states: BrowserLiveViewState[] = [];
  const streams: Array<BrowserLiveViewStreamInfo | null> = [];

  const client: BrowserLiveViewClient = {
    startBrowserLiveView(input) {
      startInputs.push(input);
      const deferred = createDeferred<StartResult>();
      starts.push(deferred);
      return deferred.promise;
    },
    stopBrowserLiveView(streamId) {
      stops.push(streamId);
      return Promise.resolve({ requestId: "r", streamId, error: null });
    },
    ackBrowserLiveFrame(streamId, frameSeq) {
      acks.push([streamId, frameSeq]);
    },
    subscribeBrowserLiveFrames(handler) {
      frameHandlers.add(handler);
      return () => frameHandlers.delete(handler);
    },
  };

  const view = createBrowserLiveView({
    client,
    subscribeEnded(handler) {
      endedHandlers.add(handler);
      return () => endedHandlers.delete(handler);
    },
    browserId: "tab-1",
    options: OPTIONS,
    onChange: (state) => states.push(state),
    onStreamChange: (stream) => streams.push(stream),
  });

  function sendFrame(
    streamId: string,
    frameSeq: number,
    jpeg = [0xff, 0xd8, frameSeq],
    origin?: string,
    documentId?: string,
  ) {
    const metadata = {
      ...METADATA,
      ...(origin ? { origin } : {}),
      ...(documentId ? { documentId } : {}),
    };
    for (const handler of frameHandlers) {
      handler({ streamId, frameSeq, metadata, jpeg: Uint8Array.from(jpeg) });
    }
  }

  function sendEnded(payload: EndedPayload) {
    for (const handler of endedHandlers) handler(payload);
  }

  async function activate(streamId: string) {
    view.setActive(true);
    starts.at(-1)!.resolve(startedResult(streamId));
    await flush();
  }

  return {
    view,
    starts,
    startInputs,
    stops,
    acks,
    states,
    streams,
    frameHandlers,
    endedHandlers,
    sendFrame,
    sendEnded,
    activate,
    lastState: () => states.at(-1),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const SCREEN = { width: 1280, height: 800, offsetTop: 0 };

function frameUri(bytes: number[]): string {
  return `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
}

describe("createBrowserLiveView", () => {
  it("starts the stream when it becomes active and shows connecting until the first frame", async () => {
    const harness = createHarness();

    harness.view.setActive(true);

    expect(harness.startInputs).toEqual([{ browserId: "tab-1", ...OPTIONS }]);
    expect(harness.lastState()).toEqual({ status: "connecting" });

    harness.starts[0].resolve(startedResult("s1"));
    await flush();
    expect(harness.lastState()).toEqual({ status: "connecting" });

    harness.sendFrame("s1", 0, [1, 2, 3]);
    expect(harness.lastState()).toEqual({
      status: "live",
      frame: { seq: 0, uri: frameUri([1, 2, 3]), screen: SCREEN, origin: null, documentId: null },
      shown: null,
    });
  });

  it("acks a frame only after it rendered, once", async () => {
    const harness = createHarness();
    await harness.activate("s1");

    harness.sendFrame("s1", 4);
    expect(harness.acks).toEqual([]);

    harness.view.frameRendered(4);
    harness.view.frameRendered(4);
    expect(harness.acks).toEqual([["s1", 4]]);
  });

  it("acks an identical frame right away because it never re-renders", async () => {
    const harness = createHarness();
    await harness.activate("s1");
    harness.sendFrame("s1", 1, [9, 9]);
    harness.view.frameRendered(1);

    harness.sendFrame("s1", 2, [9, 9]);

    expect(harness.acks).toEqual([
      ["s1", 1],
      ["s1", 2],
    ]);
    const frame = {
      seq: 1,
      uri: frameUri([9, 9]),
      screen: SCREEN,
      origin: null,
      documentId: null,
    };
    expect(harness.lastState()).toEqual({ status: "live", frame, shown: frame });
  });

  it("ignores frames from other streams", async () => {
    const harness = createHarness();
    await harness.activate("s1");

    harness.sendFrame("other", 0);

    expect(harness.lastState()).toEqual({ status: "connecting" });
  });

  it("stops the stream when it goes inactive and restarts when active again", async () => {
    const harness = createHarness();
    await harness.activate("s1");
    harness.sendFrame("s1", 0);

    harness.view.setActive(false);
    expect(harness.stops).toEqual(["s1"]);
    expect(harness.lastState()).toEqual({ status: "idle" });

    harness.sendFrame("s1", 1);
    harness.view.frameRendered(1);
    expect(harness.acks).toEqual([]);

    await harness.activate("s2");
    expect(harness.startInputs).toHaveLength(2);
    harness.sendFrame("s2", 0);
    expect(harness.lastState()).toMatchObject({ status: "live", frame: { seq: 0 } });
  });

  it("stops a stream whose start response arrives after it went inactive", async () => {
    const harness = createHarness();
    harness.view.setActive(true);
    harness.view.setActive(false);

    harness.starts[0].resolve(startedResult("late"));
    await flush();

    expect(harness.stops).toEqual(["late"]);
    expect(harness.lastState()).toEqual({ status: "idle" });
  });

  it("shows the ended state when the daemon ends the stream, and retries", async () => {
    const harness = createHarness();
    await harness.activate("s1");
    harness.sendFrame("s1", 0);

    harness.sendEnded({
      streamId: "s1",
      error: {
        code: "browser_tab_closed",
        message: "Browser tab tab-1 was closed.",
        retryable: false,
      },
    });
    expect(harness.lastState()).toEqual({
      status: "ended",
      code: "browser_tab_closed",
      held: null,
    });

    harness.view.frameRendered(0);
    expect(harness.acks).toEqual([]);

    harness.view.retry();
    expect(harness.startInputs).toHaveLength(2);
    expect(harness.lastState()).toEqual({ status: "connecting" });
  });

  it("reports each stream and whether this device controls the tab", async () => {
    const harness = createHarness();
    harness.view.setActive(true);
    harness.starts[0].resolve({ ...startedResult("s1"), control: { held: true } });
    await flush();
    expect(harness.streams.at(-1)).toEqual({ streamId: "s1", control: { held: true } });

    harness.view.setActive(false);
    expect(harness.streams.at(-1)).toBeNull();

    await harness.activate("s2");
    expect(harness.streams.at(-1)).toEqual({ streamId: "s2", control: null });
  });

  it("updates the origin of an identical image without stalling the stream", async () => {
    const harness = createHarness();
    await harness.activate("s1");
    harness.sendFrame("s1", 1, [9, 9], "https://first.example");
    harness.view.frameRendered(1);
    harness.sendFrame("s1", 2, [9, 9], "https://second.example");

    expect(harness.acks).toEqual([
      ["s1", 1],
      ["s1", 2],
    ]);
    expect(harness.lastState()).toMatchObject({ frame: { origin: "https://second.example" } });
  });

  it("keeps the origin and document of the image on screen until the next one renders", async () => {
    const harness = createHarness();
    await harness.activate("s1");
    harness.sendFrame("s1", 1, [1], "https://first.example", "s1:0");
    harness.view.frameRendered(1);
    harness.sendFrame("s1", 2, [2], "https://second.example", "s1:1");

    expect(harness.lastState()).toMatchObject({
      frame: { seq: 2 },
      shown: { origin: "https://first.example", documentId: "s1:0" },
    });

    harness.view.frameRendered(2);
    expect(harness.lastState()).toMatchObject({
      shown: { origin: "https://second.example", documentId: "s1:1" },
    });
  });

  it("moves an identical image on screen to the document it now stands for", async () => {
    const harness = createHarness();
    await harness.activate("s1");
    harness.sendFrame("s1", 1, [9], "https://first.example", "s1:0");
    harness.view.frameRendered(1);
    harness.sendFrame("s1", 2, [9], "https://first.example", "s1:1");
    expect(harness.lastState()).toMatchObject({ shown: { documentId: "s1:1" } });
  });

  it("passes on whether control outlived the stream", async () => {
    const harness = createHarness();
    await harness.activate("s1");
    harness.sendEnded({ streamId: "s1", error: null, control: { held: true } });
    expect(harness.lastState()).toEqual({ status: "ended", code: null, held: true });
  });

  it("ignores ended messages for other streams", async () => {
    const harness = createHarness();
    await harness.activate("s1");

    harness.sendEnded({ streamId: "other", error: null });

    expect(harness.lastState()).toEqual({ status: "connecting" });
  });

  it("shows the start error, such as an out-of-date desktop", async () => {
    const harness = createHarness();
    harness.view.setActive(true);

    harness.starts[0].resolve({
      requestId: "r",
      streamId: null,
      viewport: null,
      error: {
        code: "browser_unsupported",
        message: "Live view is not supported by the desktop app. Update Paseo desktop.",
        retryable: false,
      },
    });
    await flush();

    expect(harness.lastState()).toEqual({
      status: "ended",
      code: "browser_unsupported",
      held: null,
    });
  });

  it("shows a failed start request as ended", async () => {
    const harness = createHarness();
    harness.view.setActive(true);

    harness.starts[0].reject(new Error("Request timed out"));
    await flush();

    expect(harness.lastState()).toEqual({ status: "ended", code: "connection", held: null });
  });

  it("does not retry while inactive", () => {
    const harness = createHarness();

    harness.view.retry();

    expect(harness.startInputs).toEqual([]);
  });

  it("stops the stream and unsubscribes on dispose", async () => {
    const harness = createHarness();
    await harness.activate("s1");

    harness.view.dispose();

    expect(harness.stops).toEqual(["s1"]);
    expect(harness.frameHandlers.size).toBe(0);
    expect(harness.endedHandlers.size).toBe(0);
  });
});

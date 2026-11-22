import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { BrowserLiveEnded } from "@getpaseo/protocol/browser-automation/live-view";

export type BrowserLiveViewClient = Pick<
  DaemonClient,
  | "startBrowserLiveView"
  | "stopBrowserLiveView"
  | "ackBrowserLiveFrame"
  | "subscribeBrowserLiveFrames"
>;

export interface BrowserLiveViewFrame {
  seq: number;
  uri: string;
}

export type BrowserLiveViewState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "live"; frame: BrowserLiveViewFrame }
  | { status: "ended"; message: string };

export interface BrowserLiveViewOptions {
  maxFps: number;
  jpegQuality: number;
  maxWidth: number;
}

export interface BrowserLiveView {
  /** Streams while active; going inactive stops the stream, going active again restarts it. */
  setActive(active: boolean): void;
  retry(): void;
  /** Acks a frame once it is on screen, which releases the next one. */
  frameRendered(seq: number): void;
  dispose(): void;
}

const IDLE: BrowserLiveViewState = { status: "idle" };
const ENDED_FALLBACK_MESSAGE = "The live view ended";

/**
 * One viewer of one desktop browser tab. Holds at most one stream; the daemon sends the
 * next frame only after the previous one is acked, so acking after render paces the stream.
 */
export function createBrowserLiveView(input: {
  client: BrowserLiveViewClient;
  subscribeEnded: (handler: (ended: BrowserLiveEnded["payload"]) => void) => () => void;
  browserId: string;
  options: BrowserLiveViewOptions;
  onChange: (state: BrowserLiveViewState) => void;
}): BrowserLiveView {
  const { client, browserId, options, onChange } = input;
  let state: BrowserLiveViewState = IDLE;
  let active = false;
  // Bumped on every start and stop, so a start response that lands late is discarded.
  let generation = 0;
  let streamId: string | null = null;
  let unackedSeq: number | null = null;

  function setState(next: BrowserLiveViewState): void {
    state = next;
    onChange(next);
  }

  function end(message: string): void {
    streamId = null;
    unackedSeq = null;
    setState({ status: "ended", message });
  }

  async function start(): Promise<void> {
    const startGeneration = ++generation;
    setState({ status: "connecting" });
    let result: Awaited<ReturnType<BrowserLiveViewClient["startBrowserLiveView"]>>;
    try {
      result = await client.startBrowserLiveView({ browserId, ...options });
    } catch (error) {
      // Timeouts and disconnects reject; the user sees them and can retry.
      if (startGeneration === generation) {
        end(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (startGeneration !== generation) {
      if (result.streamId) stopStream(result.streamId);
      return;
    }
    if (!result.streamId) {
      end(result.error?.message ?? ENDED_FALLBACK_MESSAGE);
      return;
    }
    streamId = result.streamId;
  }

  function stop(): void {
    generation++;
    const current = streamId;
    streamId = null;
    unackedSeq = null;
    if (current) stopStream(current);
  }

  function stopStream(id: string): void {
    // The stream may already be gone on the daemon (ended, or the host disconnected); nothing to do then.
    void client.stopBrowserLiveView(id).catch(() => {});
  }

  const unsubscribeFrames = client.subscribeBrowserLiveFrames((frame) => {
    if (frame.streamId !== streamId) return;
    const uri = `data:image/jpeg;base64,${bytesToBase64(frame.jpeg)}`;
    // An identical image never re-renders, so ack it now or the stream stalls.
    if (state.status === "live" && state.frame.uri === uri) {
      client.ackBrowserLiveFrame(frame.streamId, frame.frameSeq);
      return;
    }
    unackedSeq = frame.frameSeq;
    setState({ status: "live", frame: { seq: frame.frameSeq, uri } });
  });

  const unsubscribeEnded = input.subscribeEnded((ended) => {
    if (ended.streamId !== streamId) return;
    end(ended.error?.message ?? ENDED_FALLBACK_MESSAGE);
  });

  return {
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) {
        void start();
        return;
      }
      stop();
      setState(IDLE);
    },
    retry() {
      if (active && state.status === "ended") void start();
    },
    frameRendered(seq) {
      if (!streamId || unackedSeq !== seq) return;
      unackedSeq = null;
      client.ackBrowserLiveFrame(streamId, seq);
    },
    dispose() {
      active = false;
      stop();
      unsubscribeFrames();
      unsubscribeEnded();
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

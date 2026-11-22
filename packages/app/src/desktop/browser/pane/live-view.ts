import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { BrowserLiveEnded } from "@getpaseo/protocol/browser-automation/live-view";

export type BrowserLiveViewClient = Pick<
  DaemonClient,
  | "startBrowserLiveView"
  | "stopBrowserLiveView"
  | "ackBrowserLiveFrame"
  | "subscribeBrowserLiveFrames"
>;

/** The size frames stand for, in the desktop tab's device-independent pixels. */
export interface BrowserLiveScreen {
  width: number;
  height: number;
  offsetTop: number;
}

export interface BrowserLiveViewFrame {
  seq: number;
  uri: string;
  screen: BrowserLiveScreen;
  /** The tab's committed origin when this frame was captured. */
  origin: string | null;
  /** The document it shows, which taps and scrolls on it send back. */
  documentId: string | null;
  /** The page didn't respond then, as behind a dialog. */
  blocked: boolean;
}

export interface BrowserLiveViewStreamInfo {
  streamId: string;
  /** Null when the tab's desktop can only be watched. */
  control: { held: boolean } | null;
}

export type BrowserLiveViewState =
  | { status: "idle" }
  | { status: "connecting" }
  | {
      status: "live";
      frame: BrowserLiveViewFrame;
      /** The frame on screen. frame still decodes until it rendered. */
      shown: BrowserLiveViewFrame | null;
    }
  | { status: "ended"; code: string | null; held: boolean | null };

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
  onStreamChange: (stream: BrowserLiveViewStreamInfo | null) => void;
}): BrowserLiveView {
  const { client, browserId, options, onChange, onStreamChange } = input;
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

  function end(code: string | null, held: boolean | null): void {
    streamId = null;
    unackedSeq = null;
    onStreamChange(null);
    setState({ status: "ended", code, held });
  }

  async function start(): Promise<void> {
    const startGeneration = ++generation;
    setState({ status: "connecting" });
    let result: Awaited<ReturnType<BrowserLiveViewClient["startBrowserLiveView"]>>;
    try {
      result = await client.startBrowserLiveView({ browserId, ...options });
    } catch {
      // Timeouts and disconnects reject; the user sees them and can retry.
      if (startGeneration === generation) end("connection", null);
      return;
    }
    if (startGeneration !== generation) {
      if (result.streamId) stopStream(result.streamId);
      return;
    }
    if (!result.streamId) {
      end(result.error?.code ?? null, result.control?.held ?? null);
      return;
    }
    streamId = result.streamId;
    onStreamChange({ streamId, control: result.control ?? null });
  }

  function stop(): void {
    generation++;
    const current = streamId;
    streamId = null;
    unackedSeq = null;
    if (!current) return;
    onStreamChange(null);
    stopStream(current);
  }

  function stopStream(id: string): void {
    // The stream may already be gone on the daemon (ended, or the host disconnected); nothing to do then.
    void client.stopBrowserLiveView(id).catch(() => {});
  }

  const unsubscribeFrames = client.subscribeBrowserLiveFrames((frame) => {
    if (frame.streamId !== streamId) return;
    const uri = `data:image/jpeg;base64,${bytesToBase64(frame.jpeg)}`;
    const {
      deviceWidth,
      deviceHeight,
      offsetTop,
      origin = null,
      documentId = null,
      blocked = false,
    } = frame.metadata;
    const screen = { width: deviceWidth, height: deviceHeight, offsetTop };
    // An identical image never re-renders, so ack it now or the stream stalls.
    if (state.status === "live" && state.frame.uri === uri) {
      client.ackBrowserLiveFrame(frame.streamId, frame.frameSeq);
      const last = state.frame;
      if (last.origin !== origin || last.documentId !== documentId || last.blocked !== blocked) {
        const same = { ...last, origin, documentId, blocked };
        const isShown = state.shown?.seq === state.frame.seq;
        setState({ status: "live", frame: same, shown: isShown ? same : state.shown });
      }
      return;
    }
    unackedSeq = frame.frameSeq;
    setState({
      status: "live",
      frame: { seq: frame.frameSeq, uri, screen, origin, documentId, blocked },
      shown: state.status === "live" ? state.shown : null,
    });
  });

  const unsubscribeEnded = input.subscribeEnded((ended) => {
    if (ended.streamId !== streamId) return;
    end(ended.error?.code ?? null, ended.control?.held ?? null);
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
      if (state.status === "live") setState({ ...state, shown: state.frame });
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

import type { BrowserLiveFrameMetadata } from "@getpaseo/protocol/binary-frames/browser-live";
import type { BrowserLiveViewport } from "@getpaseo/protocol/browser-automation/live-view";
import type { TabContents } from "./service.js";

const DEFAULT_MAX_FPS = 5;
const DEFAULT_JPEG_QUALITY = 60;
const DEFAULT_MAX_WIDTH = 1280;
// Chromium composites at up to 60 Hz; everyNthFrame approximates a frame-rate cap.
const COMPOSITOR_FPS = 60;

export interface BrowserLiveViewFrame {
  streamId: string;
  frameSeq: number;
  metadata: BrowserLiveFrameMetadata;
  jpeg: Uint8Array;
}

export interface BrowserLiveViewOptions {
  maxFps?: number;
  jpegQuality?: number;
  maxWidth?: number;
}

/** CDP events of the tab's debugger session. Both return an unsubscribe. */
export interface BrowserLiveViewEvents {
  onMessage(listener: (method: string, params: Record<string, unknown>) => void): () => void;
  /** The tab was destroyed or its debugger session detached. */
  onGone(listener: () => void): () => void;
}

type LiveViewTab = Pick<TabContents, "invalidate" | "isDestroyed" | "withFrameProduction"> & {
  sendDebugCommand(command: string, params?: Record<string, unknown>): Promise<unknown>;
};

/**
 * One CDP screencast of a tab. Chromium sends the next Page.screencastFrame only after
 * Page.screencastFrameAck, and this stream sends that ack only after the viewer acked the
 * frame, so exactly one frame is in flight from tab to viewer.
 */
export class BrowserLiveViewStream {
  private nextFrameSeq = 0;
  private unackedFrame: { frameSeq: number; sessionId: number } | null = null;
  private stopped = false;
  private readonly unsubscribers: Array<() => void> = [];
  private releaseFrameProduction: () => void = () => {};

  public constructor(
    private readonly params: {
      streamId: string;
      tab: LiveViewTab;
      events: BrowserLiveViewEvents;
      onFrame: (frame: BrowserLiveViewFrame) => void;
      /** Called once when the stream ends for any reason, including stop(). */
      onEnded: () => void;
    },
  ) {}

  public async start(options: BrowserLiveViewOptions): Promise<BrowserLiveViewport> {
    const { tab, events } = this.params;
    this.unsubscribers.push(
      events.onMessage((method, params) => this.handleMessage(method, params)),
      events.onGone(() => this.end()),
    );
    // Hidden tabs throttle painting; keep frames coming for as long as the stream lives.
    const produced = new Promise<void>((resolve) => {
      this.releaseFrameProduction = resolve;
    });
    void tab.withFrameProduction(() => produced).catch(() => {});

    try {
      await tab.sendDebugCommand("Page.enable");
      const metrics = (await tab.sendDebugCommand("Page.getLayoutMetrics")) as {
        cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
      };
      const maxFps = options.maxFps ?? DEFAULT_MAX_FPS;
      await tab.sendDebugCommand("Page.startScreencast", {
        format: "jpeg",
        quality: options.jpegQuality ?? DEFAULT_JPEG_QUALITY,
        maxWidth: options.maxWidth ?? DEFAULT_MAX_WIDTH,
        everyNthFrame: Math.max(1, Math.round(COMPOSITOR_FPS / maxFps)),
      });
      // A static page produces no frame on its own; request one paint.
      tab.invalidate();
      return {
        width: metrics.cssLayoutViewport?.clientWidth ?? 0,
        height: metrics.cssLayoutViewport?.clientHeight ?? 0,
      };
    } catch (error) {
      this.end();
      throw error;
    }
  }

  /** The viewer rendered frameSeq; let Chromium produce the next frame. */
  public ack(frameSeq: number): void {
    const frame = this.unackedFrame;
    if (this.stopped || !frame || frame.frameSeq !== frameSeq) {
      return;
    }
    this.unackedFrame = null;
    void this.params.tab
      .sendDebugCommand("Page.screencastFrameAck", { sessionId: frame.sessionId })
      .catch(() => {});
  }

  public async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.end();
    if (this.params.tab.isDestroyed()) {
      return;
    }
    await this.params.tab.sendDebugCommand("Page.stopScreencast").catch(() => {});
  }

  private handleMessage(method: string, params: Record<string, unknown>): void {
    if (this.stopped || method !== "Page.screencastFrame") {
      return;
    }
    const sessionId = params.sessionId;
    const data = params.data;
    if (typeof sessionId !== "number" || typeof data !== "string") {
      return;
    }
    const frameSeq = this.nextFrameSeq++;
    this.unackedFrame = { frameSeq, sessionId };
    this.params.onFrame({
      streamId: this.params.streamId,
      frameSeq,
      metadata: readFrameMetadata(params.metadata),
      jpeg: new Uint8Array(Buffer.from(data, "base64")),
    });
  }

  private end(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.unackedFrame = null;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.releaseFrameProduction();
    this.params.onEnded();
  }
}

function readFrameMetadata(value: unknown): BrowserLiveFrameMetadata {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const read = (key: string, fallback: number) =>
    typeof record[key] === "number" ? (record[key] as number) : fallback;
  return {
    deviceWidth: read("deviceWidth", 0),
    deviceHeight: read("deviceHeight", 0),
    offsetTop: read("offsetTop", 0),
    pageScaleFactor: read("pageScaleFactor", 1),
    scrollOffsetX: read("scrollOffsetX", 0),
    scrollOffsetY: read("scrollOffsetY", 0),
    ...(typeof record.timestamp === "number" ? { timestamp: record.timestamp } : {}),
  };
}

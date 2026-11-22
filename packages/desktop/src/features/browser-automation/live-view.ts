import type { BrowserLiveFrameMetadata } from "@getpaseo/protocol/binary-frames/browser-live";
import type { BrowserLiveViewport } from "@getpaseo/protocol/browser-automation/live-view";
import type { TabContents } from "./service.js";

const DEFAULT_MAX_FPS = 5;
const DEFAULT_JPEG_QUALITY = 60;
const DEFAULT_MAX_WIDTH = 1280;
const RESPONSE_TIMEOUT_MS = 2_000;
// Chromium clears a page's old pixels 4 seconds after a commit that painted nothing.
const NEW_CONTENT_TIMEOUT_MS = 5_000;

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
  onMessage(
    listener: (method: string, params: Record<string, unknown>, sessionId?: string) => void,
  ): () => void;
  /** The tab was destroyed or its debugger session detached. */
  onGone(listener: () => void): () => void;
}

type LiveViewTab = Pick<TabContents, "invalidate" | "isDestroyed"> & {
  /** Outside the tab's CDP queue, which a dialog holds up. */
  sendDebugCommand(command: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Asked in an isolated world, where the page can't lie. Hangs while the page is blocked. */
  hasPainted(): Promise<boolean>;
  /**
   * Keeps a hidden guest compositing, unthrottled, until the returned release runs. A hidden
   * or occluded <webview> produces no screencast frames on its own.
   */
  holdPainting(): () => void;
};

/** Why a stream ended: stopped on request, failed to start, or the tab went away. */
export type BrowserLiveViewEndReason = "stopped" | "failed" | "gone";

interface ScreencastFrame {
  sessionId: number;
  data: string;
  metadata: BrowserLiveFrameMetadata;
}

/**
 * One CDP screencast of a tab. Chromium keeps up to two Page.screencastFrame unacked, so
 * this stream forwards one frame at a time: while the viewer still holds one, or the
 * frame-rate delay runs, only the newest waits, and older ones are acked with the next ack.
 * The newest must not be dropped: a page that stops painting never sends another. For the
 * same reason, once two were unacked, when Chromium drops what it paints next, the stream
 * restarts the screencast after catching up: that begins with the current paint, and
 * invalidate() doesn't produce one.
 * Exactly one frame is in flight from tab to viewer.
 *
 * A frame belongs to the document and origin it arrived with. Until that document's first paint
 * Chromium can still copy the old one's pixels, stamped after the commit, so frames are held
 * until then and the screencast asked again.
 *
 * Watching is read-only: a dialog is reported on the frames, never answered.
 */
export class BrowserLiveViewStream {
  private nextFrameSeq = 0;
  private unackedFrame: { frameSeq: number; sessionId: number; receivedAt: number } | null = null;
  private minFrameIntervalMs = 1000 / DEFAULT_MAX_FPS;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private waitingFrame: ScreencastFrame | null = null;
  private mayHaveMissedPaint = false;
  private screencast: Record<string, unknown> = {};
  /** Screencast sessions of dropped frames, acked together with the forwarded one. */
  private droppedSessionIds: number[] = [];
  private stopped = false;
  private documentSeq = 0;
  private loaderId: string | null = null;
  private holding = true;
  private showingSince = 0;
  private paintTimer: ReturnType<typeof setTimeout> | null = null;
  private blocked = false;
  private readonly unsubscribers: Array<() => void> = [];

  public constructor(
    private readonly params: {
      streamId: string;
      tab: LiveViewTab;
      events: BrowserLiveViewEvents;
      /** The tab's committed top-level origin. */
      readOrigin: () => string | undefined;
      onFrame: (frame: BrowserLiveViewFrame) => void;
      /** Called once when the stream ends for any reason, including stop(). */
      onEnded: (reason: BrowserLiveViewEndReason) => void;
    },
  ) {}

  public async start(options: BrowserLiveViewOptions): Promise<BrowserLiveViewport> {
    const { tab, events } = this.params;
    this.unsubscribers.push(
      events.onMessage((method, params, sessionId) =>
        this.handleMessage(method, params, sessionId),
      ),
      events.onGone(() => this.end("gone")),
      tab.holdPainting(),
    );

    // everyNthFrame counts painted frames, not time, so the frame rate is capped by
    // delaying the ack instead.
    this.minFrameIntervalMs = 1000 / (options.maxFps ?? DEFAULT_MAX_FPS);
    const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
    this.screencast = {
      format: "jpeg",
      quality: options.jpegQuality ?? DEFAULT_JPEG_QUALITY,
      maxWidth,
      maxHeight: maxWidth * 2,
      everyNthFrame: 1,
    };
    this.holdUntilPaint();
    // All sent at once: a blocked page answers none of them and still gets screencast.
    const responses = Promise.all([
      tab.sendDebugCommand("Page.enable"),
      tab.sendDebugCommand("Page.getLayoutMetrics"),
      tab.sendDebugCommand("Page.setLifecycleEventsEnabled", { enabled: true }),
      tab.sendDebugCommand("Page.startScreencast", this.screencast),
    ]);
    // A static page produces no frame on its own; request one paint.
    tab.invalidate();
    const { documentSeq } = this;
    void tab
      .hasPainted()
      .catch(() => false)
      .then((painted) => {
        if (painted && documentSeq === this.documentSeq) this.showFrames();
        return undefined;
      });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const noAnswer = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), RESPONSE_TIMEOUT_MS);
    });
    try {
      const answered = await Promise.race([responses, noAnswer]);
      if (!answered) {
        this.setBlocked(true);
        responses.then(
          () => this.setBlocked(false),
          () => this.end("gone"),
        );
        return { width: 0, height: 0 };
      }
      const metrics = answered[1] as {
        cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
      };
      return {
        width: metrics.cssLayoutViewport?.clientWidth ?? 0,
        height: metrics.cssLayoutViewport?.clientHeight ?? 0,
      };
    } catch (error) {
      this.end("failed");
      if (!tab.isDestroyed()) void tab.sendDebugCommand("Page.stopScreencast").catch(() => {});
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** The viewer rendered frameSeq; let Chromium produce the next frame. */
  public ack(frameSeq: number): void {
    const frame = this.unackedFrame;
    if (this.stopped || !frame || frame.frameSeq !== frameSeq) {
      return;
    }
    this.unackedFrame = null;
    const send = () => {
      this.ackTimer = null;
      if (this.stopped) return;
      for (const sessionId of [frame.sessionId, ...this.droppedSessionIds.splice(0)]) {
        void this.params.tab
          .sendDebugCommand("Page.screencastFrameAck", { sessionId })
          .catch(() => {});
      }
      const waiting = this.waitingFrame;
      this.waitingFrame = null;
      if (waiting) {
        this.forward(waiting);
      } else if (this.mayHaveMissedPaint && !this.holding) {
        this.mayHaveMissedPaint = false;
        this.restartScreencast();
      }
    };
    const wait = frame.receivedAt + this.minFrameIntervalMs - Date.now();
    if (wait <= 0) send();
    else this.ackTimer = setTimeout(send, wait);
  }

  public async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.end("stopped");
    if (this.params.tab.isDestroyed()) {
      return;
    }
    // Not awaited: a blocked page doesn't answer.
    void this.params.tab.sendDebugCommand("Page.stopScreencast").catch(() => {});
  }

  /** Whether the tab still shows the document of the frames that carry this id. */
  public showsDocument(documentId: string): boolean {
    return !this.stopped && documentId === this.documentId;
  }

  private get documentId(): string {
    return `${this.params.streamId}:${this.documentSeq}`;
  }

  private handleMessage(
    method: string,
    params: Record<string, unknown>,
    targetSessionId?: string,
  ): void {
    // Only the tab's own session: an iframe's reports that iframe's documents.
    if (this.stopped || targetSessionId) return;
    if (method === "Page.frameNavigated") {
      const { frame } = params as { frame?: { parentId?: string; loaderId?: string } };
      if (frame && !frame.parentId) this.documentCommitted(frame.loaderId ?? null);
      return;
    }
    if (method === "Page.lifecycleEvent") {
      const painted = params.name === "firstPaint" && params.loaderId === this.loaderId;
      if (painted && this.holding) this.showFrames();
      return;
    }
    if (method === "Page.javascriptDialogOpening") {
      if (params.type !== "beforeunload") this.setBlocked(true);
      return;
    }
    if (method === "Page.javascriptDialogClosed") this.setBlocked(false);
    else if (method === "Page.screencastFrame") this.handleFrame(params);
  }

  private handleFrame(params: Record<string, unknown>): void {
    const sessionId = params.sessionId;
    const data = params.data;
    if (typeof sessionId !== "number" || typeof data !== "string") {
      return;
    }
    const metadata = readFrameMetadata(params.metadata);
    const isFree = !this.unackedFrame && !this.ackTimer;
    const tooOld =
      metadata.timestamp !== undefined && metadata.timestamp * 1000 < this.showingSince;
    if (this.holding || tooOld) {
      if (isFree) {
        void this.params.tab
          .sendDebugCommand("Page.screencastFrameAck", { sessionId })
          .catch(() => {});
      } else {
        this.droppedSessionIds.push(sessionId);
      }
      this.missedPaint();
      return;
    }
    const origin = this.params.readOrigin();
    const frame = {
      sessionId,
      data,
      metadata: { ...metadata, ...(origin ? { origin } : {}), documentId: this.documentId },
    };
    if (isFree) {
      this.forward(frame);
      return;
    }
    if (this.waitingFrame) this.droppedSessionIds.push(this.waitingFrame.sessionId);
    this.waitingFrame = frame;
    this.mayHaveMissedPaint = true;
  }

  private forward({ sessionId, data, metadata }: ScreencastFrame): void {
    const frameSeq = this.nextFrameSeq++;
    this.unackedFrame = { frameSeq, sessionId, receivedAt: Date.now() };
    this.params.onFrame({
      streamId: this.params.streamId,
      frameSeq,
      metadata: this.blocked ? { ...metadata, blocked: true } : metadata,
      jpeg: new Uint8Array(Buffer.from(data, "base64")),
    });
  }

  private documentCommitted(loaderId: string | null): void {
    this.documentSeq += 1;
    this.loaderId = loaderId;
    this.holdUntilPaint();
    this.mayHaveMissedPaint = true;
    if (!this.waitingFrame) return;
    this.droppedSessionIds.push(this.waitingFrame.sessionId);
    this.waitingFrame = null;
  }

  private holdUntilPaint(): void {
    this.holding = true;
    if (this.paintTimer) clearTimeout(this.paintTimer);
    this.paintTimer = setTimeout(() => this.showFrames(), NEW_CONTENT_TIMEOUT_MS);
  }

  private showFrames(): void {
    if (this.stopped || !this.holding) return;
    this.holding = false;
    this.showingSince = Date.now();
    if (this.paintTimer) clearTimeout(this.paintTimer);
    this.paintTimer = null;
    if (this.mayHaveMissedPaint) this.missedPaint();
  }

  private setBlocked(blocked: boolean): void {
    if (this.stopped || this.blocked === blocked) return;
    this.blocked = blocked;
    // The phone learns it from the next frame, which a blocked page doesn't paint.
    this.missedPaint();
  }

  /** Asks for the current paint, now or once the viewer and the hold allow it. */
  private missedPaint(): void {
    this.mayHaveMissedPaint = true;
    if (this.holding || this.unackedFrame || this.ackTimer) return;
    this.mayHaveMissedPaint = false;
    this.restartScreencast();
  }

  private restartScreencast(): void {
    const { tab } = this.params;
    // Sent together, so a stop() can't land between them and leave a screencast running.
    void Promise.all([
      tab.sendDebugCommand("Page.stopScreencast"),
      tab.sendDebugCommand("Page.startScreencast", this.screencast),
    ]).catch(() => {});
  }

  private end(reason: BrowserLiveViewEndReason): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.unackedFrame = null;
    this.waitingFrame = null;
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    if (this.paintTimer) clearTimeout(this.paintTimer);
    this.paintTimer = null;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.params.onEnded(reason);
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

import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { OwnedSubscription } from "../session/owned-subscriptions/index.js";
import type { BrowserToolsBroker } from "./broker.js";

type StartRequest = Extract<SessionInboundMessage, { type: "browser.live.start.request" }>;
type StopRequest = Extract<SessionInboundMessage, { type: "browser.live.stop.request" }>;
type FrameAck = Extract<SessionInboundMessage, { type: "browser.live.frame_ack" }>;

interface ViewerStream {
  browserId: string;
  subscription: OwnedSubscription;
}

/**
 * One session's live view streams. Each stream is an owned subscription of the
 * requesting source, so a disconnect releases it and stops the screencast.
 */
export class SessionLiveViews {
  private readonly streams = new Map<string, ViewerStream>();

  public constructor(
    private readonly deps: {
      broker: BrowserToolsBroker;
      viewerId: string;
      createStreamId: () => string;
      /** Opens an owned subscription for the current request; `stop` runs on release. */
      begin: (stop: () => Promise<void>) => OwnedSubscription;
      /** Replies to the current request. */
      emit: (message: SessionOutboundMessage) => void;
    },
  ) {}

  public async start(request: StartRequest): Promise<void> {
    const { broker, viewerId } = this.deps;
    // The same viewer restarting a tab replaces its stream.
    for (const entry of this.streams.values()) {
      if (entry.browserId === request.browserId) await entry.subscription.release();
    }

    const streamId = this.deps.createStreamId();
    const subscription = this.deps.begin(() => this.stopStream(streamId));
    this.streams.set(streamId, { browserId: request.browserId, subscription });

    await broker.startLiveView({
      streamId,
      browserId: request.browserId,
      viewerId,
      options: {
        ...(request.maxFps !== undefined ? { maxFps: request.maxFps } : {}),
        ...(request.jpegQuality !== undefined ? { jpegQuality: request.jpegQuality } : {}),
        ...(request.maxWidth !== undefined ? { maxWidth: request.maxWidth } : {}),
      },
      sink: {
        sendFrame: (frame) => subscription.emitBinary(frame),
        ended: (failure) => {
          if (this.streams.get(streamId)?.subscription !== subscription) return;
          this.streams.delete(streamId);
          subscription.emit({ type: "browser.live.ended", payload: { streamId, error: failure } });
          void subscription.release().catch(() => {});
        },
      },
      respond: (result) => {
        if (!result.ok) {
          this.streams.delete(streamId);
          void subscription.release().catch(() => {});
        }
        this.deps.emit({
          type: "browser.live.start.response",
          payload: result.ok
            ? {
                requestId: request.requestId,
                streamId,
                viewport: result.viewport,
                error: null,
              }
            : { requestId: request.requestId, streamId: null, viewport: null, error: result.error },
        });
      },
    });
  }

  public async stop(request: StopRequest): Promise<void> {
    const entry = this.streams.get(request.streamId);
    if (!entry) {
      this.deps.emit({
        type: "browser.live.stop.response",
        payload: {
          requestId: request.requestId,
          streamId: request.streamId,
          error: {
            code: "browser_tab_not_found",
            message: `Live view stream ${request.streamId} is not active.`,
            retryable: false,
          },
        },
      });
      return;
    }
    this.streams.delete(request.streamId);
    const { error } = await this.deps.broker.stopLiveView({
      streamId: request.streamId,
      viewerId: this.deps.viewerId,
    });
    this.deps.emit({
      type: "browser.live.stop.response",
      payload: { requestId: request.requestId, streamId: request.streamId, error },
    });
    await entry.subscription.release();
  }

  public ack(message: FrameAck): void {
    if (!this.streams.has(message.streamId)) return;
    this.deps.broker.ackLiveFrame({
      streamId: message.streamId,
      frameSeq: message.frameSeq,
      viewerId: this.deps.viewerId,
    });
  }

  private async stopStream(streamId: string): Promise<void> {
    if (!this.streams.delete(streamId)) return;
    await this.deps.broker.stopLiveView({ streamId, viewerId: this.deps.viewerId });
  }
}

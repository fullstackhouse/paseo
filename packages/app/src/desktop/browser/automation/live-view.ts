import {
  encodeBrowserLiveFrame,
  type BrowserLiveFrameMetadata,
} from "@getpaseo/protocol/binary-frames/browser-live";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { DesktopHostBridge } from "@/desktop/host";

export const BROWSER_LIVE_FRAME_EVENT = "browser-live-frame";
export const BROWSER_LIVE_ENDED_EVENT = "browser-live-ended";

type BrowserHostLiveMessage = Extract<
  SessionOutboundMessage,
  {
    type:
      | "browser.host.live.start.request"
      | "browser.host.live.stop.request"
      | "browser.host.live.frame_ack";
  }
>;
type BrowserHostLiveResponse = Extract<
  SessionInboundMessage,
  {
    type:
      | "browser.host.live.start.response"
      | "browser.host.live.stop.response"
      | "browser.host.live.ended";
  }
>;

export interface BrowserLiveViewHostClient {
  sendBrowserHostLiveMessage(message: BrowserHostLiveResponse): void;
  sendBrowserLiveFrame(frame: Uint8Array): Promise<void>;
}

interface DesktopLiveFrame {
  streamId: string;
  frameSeq: number;
  metadata: BrowserLiveFrameMetadata;
  jpeg: Uint8Array;
}

export interface BrowserLiveViewHost {
  /** Returns true when the message was a browser.host.live.* message. */
  handle(message: { type: string }): boolean;
  /**
   * Stops every stream. Call when the daemon registration is lost or replaced: the daemon
   * forgot those streams, so nothing would ack or stop them.
   */
  reset(): void;
  dispose(): void;
}

export function isBrowserLiveViewSupported(getHost: () => DesktopHostBridge | null): boolean {
  const browser = getHost()?.browser;
  return Boolean(browser?.startLiveView && browser.stopLiveView && browser.ackLiveFrame);
}

/**
 * Forwards the daemon's browser.host.live.* requests to Electron main and relays the
 * screencast frames main emits back to the daemon as binary browser_live frames.
 * Only frames of streams this daemon client started are relayed.
 */
export function createBrowserLiveViewHost(options: {
  client: BrowserLiveViewHostClient;
  getHost: () => DesktopHostBridge | null;
}): BrowserLiveViewHost {
  const { client, getHost } = options;
  const streamIds = new Set<string>();
  let disposed = false;
  const unsubscribers: Array<() => void> = [];

  function listen(event: string, handler: (payload: unknown) => void): void {
    const subscription = getHost()?.events?.on?.(event, handler);
    void Promise.resolve(subscription).then((unsubscribe) => {
      if (!unsubscribe) return undefined;
      if (disposed) unsubscribe();
      else unsubscribers.push(unsubscribe);
      return undefined;
    });
  }

  listen(BROWSER_LIVE_FRAME_EVENT, (payload) => {
    const frame = payload as DesktopLiveFrame;
    if (!streamIds.has(frame.streamId)) return;
    client
      .sendBrowserLiveFrame(encodeBrowserLiveFrame(frame))
      .catch((error) => console.warn("Failed to send browser live frame", error));
  });
  listen(BROWSER_LIVE_ENDED_EVENT, (payload) => {
    const ended = payload as Extract<
      BrowserHostLiveResponse,
      { type: "browser.host.live.ended" }
    >["payload"];
    if (!streamIds.delete(ended.streamId)) return;
    client.sendBrowserHostLiveMessage({ type: "browser.host.live.ended", payload: ended });
  });

  function stopAll(): void {
    const browser = getHost()?.browser;
    for (const streamId of streamIds) {
      void browser?.stopLiveView?.({
        type: "browser.host.live.stop.request",
        requestId: `reset:${streamId}`,
        streamId,
      });
    }
    streamIds.clear();
  }

  async function start(
    message: Extract<BrowserHostLiveMessage, { type: "browser.host.live.start.request" }>,
  ): Promise<void> {
    const browser = getHost()?.browser;
    // Frames can reach the renderer before the start call returns.
    streamIds.add(message.streamId);
    let payload: Extract<
      BrowserHostLiveResponse,
      { type: "browser.host.live.start.response" }
    >["payload"];
    try {
      if (!browser?.startLiveView) throw new Error("Live view is not available in this app build.");
      payload = await browser.startLiveView(message);
    } catch (error) {
      payload = {
        requestId: message.requestId,
        viewport: null,
        error: {
          code: "browser_unsupported",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      };
    }
    if (payload.error) streamIds.delete(message.streamId);
    client.sendBrowserHostLiveMessage({
      type: "browser.host.live.start.response",
      payload: { ...payload, requestId: message.requestId },
    });
  }

  async function stop(
    message: Extract<BrowserHostLiveMessage, { type: "browser.host.live.stop.request" }>,
  ): Promise<void> {
    streamIds.delete(message.streamId);
    let payload: Extract<
      BrowserHostLiveResponse,
      { type: "browser.host.live.stop.response" }
    >["payload"];
    try {
      payload = (await getHost()?.browser?.stopLiveView?.(message)) ?? {
        requestId: message.requestId,
        error: null,
      };
    } catch (error) {
      payload = {
        requestId: message.requestId,
        error: {
          code: "browser_unknown_error",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      };
    }
    client.sendBrowserHostLiveMessage({
      type: "browser.host.live.stop.response",
      payload: { ...payload, requestId: message.requestId },
    });
  }

  return {
    handle(message) {
      const live = message as BrowserHostLiveMessage;
      switch (live.type) {
        case "browser.host.live.start.request":
          void start(live);
          return true;
        case "browser.host.live.stop.request":
          void stop(live);
          return true;
        case "browser.host.live.frame_ack":
          if (streamIds.has(live.streamId)) void getHost()?.browser?.ackLiveFrame?.(live);
          return true;
        default:
          return false;
      }
    },
    reset: stopAll,
    dispose() {
      disposed = true;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      stopAll();
    },
  };
}

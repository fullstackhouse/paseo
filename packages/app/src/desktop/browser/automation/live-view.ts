import {
  encodeBrowserLiveFrame,
  type BrowserLiveFrameMetadata,
} from "@getpaseo/protocol/binary-frames/browser-live";
import type {
  BrowserLiveControlError,
  BrowserLiveControlErrorCode,
  BrowserLiveFocusResult,
} from "@getpaseo/protocol/browser-automation/live-view";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { DesktopHostBridge } from "@/desktop/host";

export const BROWSER_LIVE_FRAME_EVENT = "browser-live-frame";
export const BROWSER_LIVE_ENDED_EVENT = "browser-live-ended";
export const BROWSER_LIVE_CONTROL_ENDED_EVENT = "browser-live-control-ended";

type BrowserHostLiveMessage = Extract<
  SessionOutboundMessage,
  {
    type:
      | "browser.host.live.start.request"
      | "browser.host.live.stop.request"
      | "browser.host.live.take_control.request"
      | "browser.host.live.send_input.request"
      | "browser.host.live.release_control.request"
      | "browser.host.live.frame_ack";
  }
>;
type BrowserHostLiveResponse = Extract<
  SessionInboundMessage,
  {
    type:
      | "browser.host.live.start.response"
      | "browser.host.live.stop.response"
      | "browser.host.live.take_control.response"
      | "browser.host.live.send_input.response"
      | "browser.host.live.release_control.response"
      | "browser.host.live.control_ended"
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
   * Stops every stream and discards and releases all control. Call when the daemon registration is lost or replaced: the daemon
   * forgot those streams, so nothing would ack or stop them.
   */
  reset(): void;
  dispose(): void;
}

export function isBrowserLiveViewSupported(getHost: () => DesktopHostBridge | null): boolean {
  const browser = getHost()?.browser;
  return Boolean(browser?.startLiveView && browser.stopLiveView && browser.ackLiveFrame);
}

export function isBrowserLiveInputSupported(getHost: () => DesktopHostBridge | null): boolean {
  const browser = getHost()?.browser;
  return Boolean(browser?.takeLiveControl && browser.sendLiveInput && browser.releaseLiveControl);
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
  const controlIds = new Set<string>();
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

  listen(BROWSER_LIVE_CONTROL_ENDED_EVENT, (payload) => {
    const ended = payload as { controlId: string };
    if (!controlIds.delete(ended.controlId)) return;
    client.sendBrowserHostLiveMessage({ type: "browser.host.live.control_ended", payload: ended });
  });

  function stopAll(): void {
    const browser = getHost()?.browser;
    for (const controlId of controlIds) {
      // Discarded, not just unlocked: the agent could read what the user typed.
      void browser?.releaseLiveControl?.({
        type: "browser.host.live.release_control.request",
        requestId: `reset:${controlId}`,
        controlId,
        discardInput: true,
      });
    }
    controlIds.clear();
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

  // Failures are answered with fixed text: an error thrown here could quote an input.
  async function takeControl(
    message: Extract<BrowserHostLiveMessage, { type: "browser.host.live.take_control.request" }>,
  ): Promise<void> {
    const { requestId, streamId, controlId } = message;
    const takeLiveControl = getHost()?.browser?.takeLiveControl;
    let payload = { requestId, ...controlFailure("update_desktop") };
    if (takeLiveControl && streamIds.has(streamId)) {
      // Known before it is granted, so a reset meanwhile releases it too.
      controlIds.add(controlId);
      const result = await takeLiveControl(message).catch(() => controlFailure("failed"));
      if (result.error) controlIds.delete(controlId);
      payload = { ...result, requestId };
    }
    client.sendBrowserHostLiveMessage({ type: "browser.host.live.take_control.response", payload });
  }

  async function sendInput(
    message: Extract<BrowserHostLiveMessage, { type: "browser.host.live.send_input.request" }>,
  ): Promise<void> {
    const { requestId, streamId, controlId } = message;
    const sendLiveInput = getHost()?.browser?.sendLiveInput;
    let payload = { requestId, ...controlFailure("not_controller") };
    if (sendLiveInput && streamIds.has(streamId) && controlIds.has(controlId)) {
      const result = await sendLiveInput(message).catch(() => controlFailure("unconfirmed"));
      payload = { ...result, requestId };
    }
    client.sendBrowserHostLiveMessage({ type: "browser.host.live.send_input.response", payload });
  }

  async function releaseControl(
    message: Extract<BrowserHostLiveMessage, { type: "browser.host.live.release_control.request" }>,
  ): Promise<void> {
    const { requestId, controlId } = message;
    const releaseLiveControl = getHost()?.browser?.releaseLiveControl;
    let error: BrowserLiveControlError | null = null;
    if (releaseLiveControl && controlIds.has(controlId)) {
      const result = await releaseLiveControl(message).catch(() => controlFailure("failed"));
      error = result.error;
      if (!error) controlIds.delete(controlId);
    }
    client.sendBrowserHostLiveMessage({
      type: "browser.host.live.release_control.response",
      payload: { requestId, error },
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
        case "browser.host.live.take_control.request":
          void takeControl(live);
          return true;
        case "browser.host.live.send_input.request":
          void sendInput(live);
          return true;
        case "browser.host.live.release_control.request":
          void releaseControl(live);
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

function controlFailure(code: BrowserLiveControlErrorCode): BrowserLiveFocusResult {
  return { focus: null, error: { code, message: "The desktop couldn't complete the request." } };
}

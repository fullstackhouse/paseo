import { randomUUID } from "node:crypto";
import {
  BrowserAutomationExecuteRequestSchema,
  BrowserAutomationExecuteResponseSchema,
  type BrowserAutomationCommand,
  type BrowserAutomationCommandName,
  type BrowserAutomationExecuteRequest,
  type BrowserAutomationExecuteResponse,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type {
  BrowserHostLiveControlEnded,
  BrowserHostLiveEnded,
  BrowserHostLiveOutboundMessage,
  BrowserHostLiveReleaseControlResponse,
  BrowserHostLiveSendInputResponse,
  BrowserHostLiveStartResponse,
  BrowserHostLiveStopResponse,
  BrowserHostLiveTakeControlResponse,
  BrowserLiveControlError,
  BrowserLiveControlErrorCode,
  BrowserLiveFocusResult,
  BrowserLiveInput,
  BrowserLiveViewport,
} from "@getpaseo/protocol/browser-automation/live-view";
import type { BrowserLiveFrameHeader } from "@getpaseo/protocol/binary-frames/browser-live";
import {
  browserHumanControlFailure,
  browserToolsFailure,
  type BrowserToolsCallPayload,
  type BrowserToolsErrorPayload,
  type BrowserToolsResponsePayload,
} from "./errors.js";
import {
  BrowserHumanControl,
  type BrowserHostControlAnswer,
  type BrowserHostControlRequest,
} from "./human-control.js";
import { BrowserTabNotes } from "./tab-notes.js";

export interface BrowserHostClient {
  id: string;
  hostKind: string;
  supportedCommands: readonly BrowserAutomationCommandName[];
  sendBrowserAutomationRequest(request: BrowserAutomationExecuteRequest): void | Promise<void>;
  /** Present when the host registered with liveView support. */
  liveView?: {
    /** Present when the host also registered with liveViewInput support. */
    input?: boolean;
    send(message: BrowserHostLiveOutboundMessage): void | Promise<void>;
  };
}

/** Where a live view stream delivers to: the viewing session. */
export interface BrowserLiveViewSink {
  /** Receives the host's binary browser_live frame unchanged. */
  sendFrame(frame: Uint8Array): void;
  /** The stream ended without a stop from the viewer. */
  ended(error: BrowserToolsErrorPayload): void;
}

export interface BrowserLiveViewOptions {
  maxFps?: number;
  jpegQuality?: number;
  maxWidth?: number;
}

export type BrowserLiveViewStartResult =
  | {
      ok: true;
      streamId: string;
      viewport: BrowserLiveViewport;
      /** Present when the host can hand over control. */
      control?: { held: boolean };
    }
  | { ok: false; error: BrowserToolsErrorPayload };

interface BrowserLiveViewStream {
  streamId: string;
  browserId: string;
  viewerId: string;
  /** Stable across the viewer's sessions: who may hold control. */
  ownerId: string;
  hostClientId: string;
  startedAt: number;
  sink: BrowserLiveViewSink;
  /** False until the host confirmed the screencast and the viewer got its response. */
  active: boolean;
  /** A frame that arrived before activation, delivered right after it. */
  earlyFrame: { frameSeq: number; bytes: Uint8Array } | null;
  /** The frame relayed to the viewer and not yet acked. The host sends no other meanwhile. */
  inFlightFrameSeq: number | null;
}

type BrowserHostLiveResponsePayload =
  | BrowserHostLiveStartResponse["payload"]
  | BrowserHostLiveStopResponse["payload"];

interface PendingLiveRequest {
  clientId: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (payload: BrowserHostLiveResponsePayload) => void;
}

type BrowserHostControlResponsePayload =
  | BrowserHostLiveTakeControlResponse["payload"]
  | BrowserHostLiveSendInputResponse["payload"]
  | BrowserHostLiveReleaseControlResponse["payload"];

interface PendingControlRequest {
  clientId: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (answer: BrowserHostControlAnswer | null) => void;
}

/** Names the viewer's stream and, in ownerId, who they are. */
export interface BrowserLiveViewerRef {
  streamId: string;
  viewerId: string;
  ownerId: string;
}

export interface BrowserToolsExecuteInput {
  command: BrowserAutomationCommand;
  agentId?: string;
  cwd?: string;
  workspaceId?: string;
  requestId?: string;
  timeoutMs?: number;
}

interface PendingBrowserToolsRequest {
  clientId: string;
  rememberAffinity: boolean;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (payload: BrowserToolsResponsePayload) => void;
}

interface RegisteredBrowserHost {
  client: BrowserHostClient;
  registeredAt: number;
  supportedCommands: ReadonlySet<BrowserAutomationCommandName>;
}

export interface BrowserToolsBrokerOptions {
  defaultTimeoutMs?: number;
  createRequestId?: () => string;
  // COMPAT(browserLiveViewFlag): experimental opt-in added after v0.15.4, remove once live view ships on by default.
  /** Whether viewers may start live views (the host's browserLiveView setting). Off when absent. */
  isLiveViewEnabled?: () => boolean;
  /** Human control of a tab ended; `note` is safe to show and to persist. */
  onHumanControlEnded?: (ending: { agentIds: string[]; note: string }) => void;
}

const DEFAULT_BROWSER_TOOLS_TIMEOUT_MS = 15_000;

export class BrowserToolsBroker {
  private readonly defaultTimeoutMs: number;
  private readonly createRequestId: () => string;
  private readonly isLiveViewEnabled: () => boolean;
  private readonly clients = new Map<string, RegisteredBrowserHost>();
  private readonly pending = new Map<string, PendingBrowserToolsRequest>();
  private readonly browserHostByBrowserId = new Map<string, string>();
  private readonly strandedBrowserHostByBrowserId = new Map<string, string>();
  private registrationSequence = 0;
  private readonly notes = new BrowserTabNotes();
  private readonly control: BrowserHumanControl;
  private readonly liveViews = new LiveViewRegistry((stream) =>
    this.control.viewerLeft(stream.browserId),
  );
  private readonly pendingLive = new Map<string, PendingLiveRequest>();
  private readonly pendingControl = new Map<string, PendingControlRequest>();

  public constructor(options: BrowserToolsBrokerOptions) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BROWSER_TOOLS_TIMEOUT_MS;
    this.createRequestId = options.createRequestId ?? (() => `browser_${randomUUID()}`);
    this.isLiveViewEnabled = options.isLiveViewEnabled ?? (() => false);
    this.control = new BrowserHumanControl({
      createId: this.createRequestId,
      send: (hostClientId, request, timeoutMs) =>
        this.sendControlRequest(hostClientId, request, timeoutMs),
      hasViewer: (browserId) => this.liveViews.getByBrowserId(browserId) !== undefined,
      onTaken: (browserId) => this.notes.discard(browserId),
      onEnded: (browserId, note) => {
        const agentIds = this.notes.add(browserId, note);
        options.onHumanControlEnded?.({ agentIds, note });
      },
    });
  }

  public registerClient(client: BrowserHostClient): () => void {
    this.unregisterClient(client.id);
    const registeredAt = ++this.registrationSequence;
    this.clients.set(client.id, {
      client,
      registeredAt,
      supportedCommands: new Set(client.supportedCommands),
    });
    return () => this.unregisterClient(client.id, registeredAt);
  }

  public unregisterClient(clientId: string, registeredAt?: number): void {
    const current = this.clients.get(clientId);
    if (!current || (registeredAt !== undefined && current.registeredAt !== registeredAt)) {
      return;
    }
    this.clients.delete(clientId);

    for (const [browserId, ownerClientId] of this.browserHostByBrowserId) {
      if (ownerClientId !== clientId) {
        continue;
      }
      this.browserHostByBrowserId.delete(browserId);
      this.strandedBrowserHostByBrowserId.set(browserId, clientId);
    }

    for (const [requestId, pending] of this.pending) {
      if (pending.clientId !== clientId) {
        continue;
      }
      this.pending.delete(requestId);
      clearTimeout(pending.timeout);
      pending.resolve(
        browserToolsFailure({
          requestId,
          code: "browser_no_host",
          message: "The browser automation host disconnected before responding.",
          retryable: true,
        }),
      );
    }

    for (const [requestId, pending] of this.pendingLive) {
      if (pending.clientId !== clientId) {
        continue;
      }
      this.pendingLive.delete(requestId);
      clearTimeout(pending.timeout);
      pending.resolve({
        requestId,
        viewport: null,
        error: {
          code: "browser_no_host",
          message: "The browser host disconnected before responding.",
          retryable: true,
        },
      });
    }

    // Before the streams go, so no grace timer starts. That desktop unlocks by itself.
    this.control.hostGone(clientId);
    for (const [requestId, pending] of this.pendingControl) {
      if (pending.clientId !== clientId) continue;
      settleControlRequest(this.pendingControl, requestId, null);
    }

    for (const stream of this.liveViews.removeForHost(clientId)) {
      stream.sink.ended({
        code: "browser_no_host",
        message: `The app hosting browser tab ${stream.browserId} disconnected.`,
        retryable: true,
      });
    }
  }

  public getPendingRequestCount(): number {
    return this.pending.size;
  }

  public getRegisteredClientCount(): number {
    return this.clients.size;
  }

  public async execute(input: BrowserToolsExecuteInput): Promise<BrowserToolsCallPayload> {
    const requestId = input.requestId ?? this.createRequestId();

    const request = BrowserAutomationExecuteRequestSchema.safeParse({
      type: "browser.automation.execute.request",
      requestId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      command: input.command,
    });

    if (!request.success) {
      return browserToolsFailure({
        requestId,
        code: "browser_unknown_error",
        message: formatBrowserAutomationValidationError(request.error.issues[0]?.message),
      });
    }

    const payload = await this.executeUnlessHeld(
      request.data,
      input.timeoutMs ?? this.defaultTimeoutMs,
    );
    const { agentId } = input;
    if (!agentId) return payload;

    const browserId = getBrowserIdForCommand(request.data.command);
    if (browserId && (payload.ok || this.control.isHeld(browserId))) {
      this.notes.recordUse(browserId, agentId);
    } else if (payload.ok && payload.result.command === "new_tab") {
      this.notes.recordUse(payload.result.browserId, agentId);
    }
    const userNotes = this.notes.deliver(agentId, browserId);
    return userNotes.length > 0 ? { ...payload, userNotes } : payload;
  }

  private async executeUnlessHeld(
    request: BrowserAutomationExecuteRequest,
    timeoutMs: number,
  ): Promise<BrowserToolsCallPayload> {
    const { command, requestId } = request;
    if (command.command === "list_tabs") {
      return this.withholdHeldTabs(await this.executeListTabs({ request, timeoutMs }));
    }

    // Before host selection, so nothing about a held tab leaks through routing errors either.
    const browserId = getBrowserIdForCommand(command);
    if (browserId && this.control.isHeld(browserId)) {
      return browserHumanControlFailure(requestId);
    }

    const host = this.selectHostForCommand(command, requestId);
    if (!host.ok) {
      return host.payload;
    }

    const unsupported = this.unsupportedCommandFailure({
      host: host.value,
      commandName: command.command,
      requestId,
    });
    if (unsupported) {
      return unsupported;
    }

    const payload = await this.sendRequest({ host: host.value, request, timeoutMs });
    // Sent just before the take, and refused by the desktop's lock.
    const refusedByLock = !payload.ok && payload.error.code === "browser_denied";
    return refusedByLock && browserId && this.control.isHeld(browserId)
      ? browserHumanControlFailure(requestId)
      : payload;
  }

  private withholdHeldTabs(payload: BrowserToolsResponsePayload): BrowserToolsResponsePayload {
    if (!payload.ok || payload.result.command !== "list_tabs") return payload;
    if (!payload.result.tabs.some((tab) => this.control.isHeld(tab.browserId))) return payload;
    const tabs = payload.result.tabs.map((tab) =>
      this.control.isHeld(tab.browserId) ? { ...tab, url: "", title: "", humanControl: true } : tab,
    );
    return { ...payload, result: { ...payload.result, tabs } };
  }

  public receiveResponse(
    response: BrowserAutomationExecuteResponse,
    clientIds?: readonly string[],
  ): boolean {
    const parsed = BrowserAutomationExecuteResponseSchema.safeParse(response);
    if (!parsed.success) {
      const requestId = getBrowserAutomationResponseRequestId(response);
      if (!requestId) {
        return false;
      }

      const pending = this.pending.get(requestId);
      if (!pending || (clientIds && !clientIds.includes(pending.clientId))) {
        return false;
      }

      this.pending.delete(requestId);
      clearTimeout(pending.timeout);
      pending.resolve(
        browserToolsFailure({
          requestId,
          code: "browser_unknown_error",
          message: formatBrowserAutomationResponseValidationError(parsed.error.issues[0]?.message),
        }),
      );
      return true;
    }

    const pending = this.pending.get(parsed.data.payload.requestId);
    if (!pending || (clientIds && !clientIds.includes(pending.clientId))) {
      return false;
    }

    this.pending.delete(parsed.data.payload.requestId);
    clearTimeout(pending.timeout);
    if (pending.rememberAffinity) {
      this.rememberBrowserHostForPayload(pending.clientId, parsed.data.payload);
    }
    pending.resolve(parsed.data.payload);
    return true;
  }

  /**
   * Starts streaming a tab to one viewer. One stream per tab: any second start is
   * refused until the first stops. `respond` runs before any frame reaches the sink,
   * so the viewer learns the stream before its first frame.
   */
  public async startLiveView(input: {
    streamId: string;
    browserId: string;
    viewerId: string;
    ownerId: string;
    options: BrowserLiveViewOptions;
    sink: BrowserLiveViewSink;
    respond: (result: BrowserLiveViewStartResult) => void;
    timeoutMs?: number;
  }): Promise<void> {
    if (!this.isLiveViewEnabled()) {
      input.respond({
        ok: false,
        error: {
          code: "browser_unsupported",
          message: "Browser live view is turned off in Host settings.",
          retryable: false,
        },
      });
      return;
    }
    if (this.control.isHeldByOther(input.browserId, input.ownerId)) {
      input.respond({
        ok: false,
        error: {
          // Not browser_human_control, which phones that predate it can't parse.
          code: "browser_denied",
          message: `Browser tab ${input.browserId} is controlled from another device.`,
          retryable: true,
        },
      });
      return;
    }
    if (this.liveViews.getByBrowserId(input.browserId)) {
      input.respond({
        ok: false,
        error: {
          code: "browser_denied",
          message: `Browser tab ${input.browserId} is already being viewed.`,
          retryable: true,
        },
      });
      return;
    }

    const requestId = this.createRequestId();
    const host = this.selectHostForBrowserId(input.browserId, requestId);
    if (!host.ok) {
      input.respond({ ok: false, error: failureError(host.payload) });
      return;
    }
    const liveView = host.value.client.liveView;
    if (!liveView) {
      input.respond({
        ok: false,
        error: {
          code: "browser_unsupported",
          message: `Live view is not supported by the ${describeBrowserHost(host.value)}. Update Paseo desktop.`,
          retryable: false,
        },
      });
      return;
    }

    const stream: BrowserLiveViewStream = {
      streamId: input.streamId,
      browserId: input.browserId,
      viewerId: input.viewerId,
      ownerId: input.ownerId,
      hostClientId: host.value.client.id,
      startedAt: Date.now(),
      sink: input.sink,
      active: false,
      earlyFrame: null,
      inFlightFrameSeq: null,
    };
    this.liveViews.add(stream);

    const response = await this.sendLiveRequest({
      host: host.value,
      message: {
        type: "browser.host.live.start.request",
        requestId,
        streamId: stream.streamId,
        browserId: input.browserId,
        ...controlIdField(this.control.controllerOf(input.browserId, input.ownerId)),
        ...input.options,
      },
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
    });

    if (this.liveViews.get(stream.streamId) !== stream) {
      // Stopped while starting (viewer left or host gone). The host may have started anyway.
      this.stopOrphanedHostStream(stream);
      input.respond({
        ok: false,
        error: {
          code: "browser_tab_closed",
          message: "The live view stopped before it started.",
          retryable: true,
        },
      });
      return;
    }

    if (response.error || !("viewport" in response) || !response.viewport) {
      this.liveViews.remove(stream.streamId);
      // A timeout or lost answer does not mean the host never started; stopping is idempotent.
      this.stopOrphanedHostStream(stream);
      input.respond({
        ok: false,
        error: response.error ?? {
          code: "browser_unknown_error",
          message: "The browser host started the live view without a viewport.",
          retryable: false,
        },
      });
      return;
    }

    stream.active = true;
    this.control.viewerArrived(stream.browserId);
    const held = this.control.controllerOf(stream.browserId, stream.ownerId)?.held === true;
    input.respond({
      ok: true,
      streamId: stream.streamId,
      viewport: response.viewport,
      ...(liveView.input ? { control: { held } } : {}),
    });
    const early = stream.earlyFrame;
    stream.earlyFrame = null;
    if (early) {
      this.relayLiveFrame(stream, early.frameSeq, early.bytes);
    }
  }

  public async stopLiveView(input: {
    streamId: string;
    viewerId: string;
  }): Promise<{ error: BrowserToolsErrorPayload | null }> {
    const { streamId, viewerId } = input;
    const stream = this.liveViews.get(streamId);
    if (!stream || stream.viewerId !== viewerId) {
      return {
        error: {
          code: "browser_tab_not_found",
          message: `Live view stream ${streamId} is not active.`,
          retryable: false,
        },
      };
    }
    this.liveViews.remove(streamId);
    if (!this.clients.has(stream.hostClientId)) {
      return { error: null };
    }
    const response = await this.sendStopToHost(stream, this.createRequestId());
    return { error: response.error };
  }

  /** Locks the watched tab for this viewer. Watching alone never locks it. */
  public async takeControl(viewer: BrowserLiveViewerRef): Promise<BrowserLiveFocusResult> {
    if (!this.isLiveViewEnabled()) {
      return controlRefusal("disabled", "Browser live view is turned off in Host settings.");
    }
    const stream = this.streamOfViewer(viewer);
    if (!stream) return controlRefusal("not_controller", "The live view isn't active.");
    if (!this.clients.get(stream.hostClientId)?.client.liveView?.input) {
      return controlRefusal("update_desktop", "Update Paseo desktop to take control.");
    }
    return this.control.take(stream, viewer.ownerId);
  }

  /** The input can be a secret: it goes to the host and nowhere else. */
  public async sendLiveInput(
    input: BrowserLiveViewerRef & { input: BrowserLiveInput },
  ): Promise<BrowserLiveFocusResult> {
    const stream = this.streamOfViewer(input);
    if (!stream) return controlRefusal("not_controller", "The live view isn't active.");
    return this.control.input(stream, input.ownerId, input.input);
  }

  /** The user's hand-back. */
  public async releaseControl(
    viewer: BrowserLiveViewerRef,
  ): Promise<{ error: BrowserLiveControlError | null }> {
    const stream = this.streamOfViewer(viewer);
    if (!stream) {
      return { error: controlRefusal("not_controller", "The live view isn't active.").error };
    }
    return { error: await this.control.handBack(stream, viewer.ownerId) };
  }

  public receiveControlEnded(input: {
    payload: BrowserHostLiveControlEnded["payload"];
    clientIds: readonly string[];
  }): boolean {
    return this.control.tabGone(input.payload.controlId, input.clientIds);
  }

  private streamOfViewer(viewer: BrowserLiveViewerRef): BrowserLiveViewStream | null {
    const stream = this.liveViews.get(viewer.streamId);
    if (!stream?.active) return null;
    return stream.viewerId === viewer.viewerId && stream.ownerId === viewer.ownerId ? stream : null;
  }

  /** Forwards the viewer's ack for the frame in flight; stale or foreign acks are dropped. */
  public ackLiveFrame(input: { streamId: string; frameSeq: number; viewerId: string }): boolean {
    const { streamId, frameSeq, viewerId } = input;
    const stream = this.liveViews.get(streamId);
    if (!stream || stream.viewerId !== viewerId || stream.inFlightFrameSeq !== frameSeq) {
      return false;
    }
    const host = this.clients.get(stream.hostClientId);
    if (!host?.client.liveView) {
      return false;
    }
    stream.inFlightFrameSeq = null;
    void Promise.resolve(
      host.client.liveView.send({ type: "browser.host.live.frame_ack", streamId, frameSeq }),
    ).catch(() => {});
    return true;
  }

  /** Relays a host's binary frame to the stream's viewer without decoding the image. */
  public receiveLiveFrame(input: {
    header: BrowserLiveFrameHeader;
    bytes: Uint8Array;
    clientIds: readonly string[];
  }): boolean {
    const { header, bytes, clientIds } = input;
    const stream = this.liveViews.get(header.streamId);
    if (!stream || !clientIds.includes(stream.hostClientId)) {
      return false;
    }
    if (!stream.active) {
      stream.earlyFrame = { frameSeq: header.frameSeq, bytes };
      return true;
    }
    this.relayLiveFrame(stream, header.frameSeq, bytes);
    return true;
  }

  public receiveLiveResponse(input: {
    payload: BrowserHostLiveResponsePayload | BrowserHostControlResponsePayload;
    clientIds: readonly string[];
  }): boolean {
    const { payload, clientIds } = input;
    const control = this.pendingControl.get(payload.requestId);
    if (control && clientIds.includes(control.clientId)) {
      const { requestId, ...answer } = payload as BrowserHostControlResponsePayload;
      return settleControlRequest(this.pendingControl, requestId, answer);
    }
    const pending = this.pendingLive.get(payload.requestId);
    if (!pending || !clientIds.includes(pending.clientId)) {
      return false;
    }
    return settleLiveRequest(this.pendingLive, payload as BrowserHostLiveResponsePayload);
  }

  /** The host's screencast ended on its own (tab closed or gone); tell the viewer. */
  public receiveLiveEnded(input: {
    payload: BrowserHostLiveEnded["payload"];
    clientIds: readonly string[];
  }): boolean {
    const stream = this.liveViews.get(input.payload.streamId);
    if (!stream || !input.clientIds.includes(stream.hostClientId)) {
      return false;
    }
    this.liveViews.remove(stream.streamId);
    stream.sink.ended(
      input.payload.error ?? {
        code: "browser_tab_closed",
        message: `The live view of browser tab ${stream.browserId} ended on the desktop.`,
        retryable: false,
      },
    );
    return true;
  }

  /** Ends every stream, e.g. when live view is switched off. Viewers get browser.live.ended. */
  public stopAllLiveViews(): void {
    for (const stream of this.liveViews.removeAll()) {
      this.stopOrphanedHostStream(stream);
      stream.sink.ended({
        code: "browser_unsupported",
        message: "Browser live view was turned off in Host settings.",
        retryable: false,
      });
    }
    this.control.releaseAll();
  }

  public getLiveViewCount(): number {
    return this.liveViews.size;
  }

  private endLiveViewForClosedTab(browserId: string): void {
    const stream = this.liveViews.getByBrowserId(browserId);
    if (!stream) return;
    this.liveViews.remove(stream.streamId);
    stream.sink.ended({
      code: "browser_tab_closed",
      message: `Browser tab ${browserId} was closed.`,
      retryable: false,
    });
  }

  private stopOrphanedHostStream(stream: BrowserLiveViewStream): void {
    if (this.clients.has(stream.hostClientId)) {
      void this.sendStopToHost(stream, this.createRequestId());
    }
  }

  private relayLiveFrame(stream: BrowserLiveViewStream, frameSeq: number, bytes: Uint8Array): void {
    stream.inFlightFrameSeq = frameSeq;
    stream.sink.sendFrame(bytes);
  }

  private sendStopToHost(
    stream: BrowserLiveViewStream,
    requestId: string,
  ): Promise<BrowserHostLiveResponsePayload> {
    const host = this.clients.get(stream.hostClientId);
    if (!host) {
      return Promise.resolve({ requestId, error: null });
    }
    return this.sendLiveRequest({
      host,
      message: { type: "browser.host.live.stop.request", requestId, streamId: stream.streamId },
      timeoutMs: this.defaultTimeoutMs,
    });
  }

  private sendLiveRequest(params: {
    host: RegisteredBrowserHost;
    message: Extract<
      BrowserHostLiveOutboundMessage,
      { type: "browser.host.live.start.request" | "browser.host.live.stop.request" }
    >;
    timeoutMs: number;
  }): Promise<BrowserHostLiveResponsePayload> {
    const { host, message, timeoutMs } = params;
    const requestId = message.requestId;
    const liveView = host.client.liveView;
    return new Promise((resolve) => {
      const fail = (error: BrowserToolsErrorPayload) =>
        settleLiveRequest(this.pendingLive, { requestId, viewport: null, error });
      const timeout = setTimeout(
        () =>
          fail({
            code: "browser_timeout",
            message: `The browser host did not answer the live view request after ${timeoutMs}ms.`,
            retryable: true,
          }),
        timeoutMs,
      );
      this.pendingLive.set(requestId, { clientId: host.client.id, timeout, resolve });
      try {
        if (!liveView) throw new Error("The browser host does not support live view");
        Promise.resolve(liveView.send(message)).catch((error: unknown) =>
          fail({
            code: "browser_unknown_error",
            message: formatBrowserAutomationSendError(error),
            retryable: false,
          }),
        );
      } catch (error) {
        fail({
          code: "browser_unknown_error",
          message: formatBrowserAutomationSendError(error),
          retryable: false,
        });
      }
    });
  }

  private sendControlRequest(
    hostClientId: string,
    request: BrowserHostControlRequest,
    timeoutMs: number,
  ): Promise<BrowserHostControlAnswer | null> {
    const liveView = this.clients.get(hostClientId)?.client.liveView;
    if (!liveView) return Promise.resolve(null);
    const { requestId } = request;
    return new Promise((resolve) => {
      const giveUp = () => settleControlRequest(this.pendingControl, requestId, null);
      const timeout = setTimeout(giveUp, timeoutMs);
      this.pendingControl.set(requestId, { clientId: hostClientId, timeout, resolve });
      try {
        // A send error is dropped on purpose: the request can hold a secret.
        Promise.resolve(liveView.send(request)).catch(giveUp);
      } catch {
        giveUp();
      }
    });
  }

  private async executeListTabs(params: {
    request: BrowserAutomationExecuteRequest;
    timeoutMs: number;
  }): Promise<BrowserToolsResponsePayload> {
    const hosts = Array.from(this.clients.values());
    if (hosts.length === 0) {
      return this.noBrowserHostFailure(params.request.requestId);
    }

    for (const host of hosts) {
      const unsupported = this.unsupportedCommandFailure({
        host,
        commandName: "list_tabs",
        requestId: params.request.requestId,
      });
      if (unsupported) {
        return unsupported;
      }
    }

    if (hosts.length === 1) {
      return this.sendRequest({
        host: hosts[0],
        request: params.request,
        timeoutMs: params.timeoutMs,
      });
    }

    const hostResponses = await Promise.all(
      hosts.map(async (host) => ({
        host,
        payload: await this.sendRequest({
          host,
          request: {
            ...params.request,
            requestId: `${params.request.requestId}:${host.client.id}`,
          },
          rememberAffinity: false,
          timeoutMs: params.timeoutMs,
        }),
      })),
    );

    const failed = hostResponses.find(({ payload }) => !payload.ok);
    if (failed) {
      return withBrowserToolsRequestId(failed.payload, params.request.requestId);
    }

    for (const { host, payload } of hostResponses) {
      this.rememberBrowserHostForPayload(host.client.id, payload);
    }

    return {
      requestId: params.request.requestId,
      ok: true,
      result: {
        command: "list_tabs",
        tabs: hostResponses.flatMap(({ payload }) =>
          payload.ok && payload.result.command === "list_tabs" ? payload.result.tabs : [],
        ),
      },
    };
  }

  private selectHostForCommand(
    command: BrowserAutomationCommand,
    requestId: string,
  ):
    | { ok: true; value: RegisteredBrowserHost }
    | { ok: false; payload: BrowserToolsResponsePayload } {
    if (command.command === "new_tab") {
      const host = this.selectMostRecentlyRegisteredHost();
      return host
        ? { ok: true, value: host }
        : { ok: false, payload: this.noBrowserHostFailure(requestId) };
    }

    const browserId = getBrowserIdForCommand(command);
    if (!browserId) {
      const host = this.selectMostRecentlyRegisteredHost();
      return host
        ? { ok: true, value: host }
        : { ok: false, payload: this.noBrowserHostFailure(requestId) };
    }

    return this.selectHostForBrowserId(browserId, requestId);
  }

  private selectHostForBrowserId(
    browserId: string,
    requestId: string,
  ):
    | { ok: true; value: RegisteredBrowserHost }
    | { ok: false; payload: BrowserToolsResponsePayload } {
    const ownerClientId = this.browserHostByBrowserId.get(browserId);
    if (ownerClientId) {
      const host = this.clients.get(ownerClientId);
      if (host) {
        return { ok: true, value: host };
      }
      return {
        ok: false,
        payload: this.strandedBrowserTabFailure({ requestId, browserId }),
      };
    }

    const strandedOwnerClientId = this.strandedBrowserHostByBrowserId.get(browserId);
    if (strandedOwnerClientId) {
      const reconnectedHost = this.clients.get(strandedOwnerClientId);
      if (reconnectedHost) {
        this.strandedBrowserHostByBrowserId.delete(browserId);
        this.browserHostByBrowserId.set(browserId, strandedOwnerClientId);
        return { ok: true, value: reconnectedHost };
      }
      return {
        ok: false,
        payload: this.strandedBrowserTabFailure({ requestId, browserId }),
      };
    }

    if (this.clients.size === 1) {
      const host = this.selectMostRecentlyRegisteredHost();
      if (host) {
        return { ok: true, value: host };
      }
    }

    if (this.clients.size === 0) {
      return { ok: false, payload: this.noBrowserHostFailure(requestId) };
    }

    return {
      ok: false,
      payload: browserToolsFailure({
        requestId,
        code: "browser_tab_not_found",
        message: `Browser tab ${browserId} is not associated with a connected browser automation host. Call browser_list_tabs and use one of the returned browserId values.`,
      }),
    };
  }

  private selectMostRecentlyRegisteredHost(): RegisteredBrowserHost | null {
    let selected: RegisteredBrowserHost | null = null;
    for (const host of this.clients.values()) {
      selected = host;
    }
    return selected;
  }

  private unsupportedCommandFailure(params: {
    host: RegisteredBrowserHost;
    commandName: BrowserAutomationCommandName;
    requestId: string;
  }): BrowserToolsResponsePayload | null {
    if (params.host.supportedCommands.has(params.commandName)) {
      return null;
    }
    return browserToolsFailure({
      requestId: params.requestId,
      code: "browser_unsupported",
      message: `Browser automation command "${params.commandName}" is not supported by the ${describeBrowserHost(params.host)}.`,
    });
  }

  private noBrowserHostFailure(requestId: string): BrowserToolsResponsePayload {
    return browserToolsFailure({
      requestId,
      code: "browser_no_host",
      message: "No browser automation host is connected.",
      retryable: true,
    });
  }

  private strandedBrowserTabFailure(params: {
    requestId: string;
    browserId: string;
  }): BrowserToolsResponsePayload {
    return browserToolsFailure({
      requestId: params.requestId,
      code: "browser_no_host",
      message: `The app hosting browser tab ${params.browserId} disconnected.`,
      retryable: true,
    });
  }

  private rememberBrowserHostForPayload(
    clientId: string,
    payload: BrowserToolsResponsePayload,
  ): void {
    if (!payload.ok) {
      return;
    }

    if (payload.result.command === "list_tabs") {
      for (const tab of payload.result.tabs) {
        this.browserHostByBrowserId.set(tab.browserId, clientId);
        this.strandedBrowserHostByBrowserId.delete(tab.browserId);
      }
      return;
    }

    if (payload.result.command === "close_tab") {
      this.endLiveViewForClosedTab(payload.result.browserId);
      this.browserHostByBrowserId.delete(payload.result.browserId);
      this.strandedBrowserHostByBrowserId.delete(payload.result.browserId);
      return;
    }

    if ("browserId" in payload.result) {
      this.browserHostByBrowserId.set(payload.result.browserId, clientId);
      this.strandedBrowserHostByBrowserId.delete(payload.result.browserId);
    }
  }

  private sendRequest(params: {
    host: RegisteredBrowserHost;
    request: BrowserAutomationExecuteRequest;
    rememberAffinity?: boolean;
    timeoutMs: number;
  }): Promise<BrowserToolsResponsePayload> {
    const { host, request, timeoutMs } = params;
    const client = host.client;

    return new Promise<BrowserToolsResponsePayload>((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(request.requestId)) {
          return;
        }
        resolve(
          browserToolsFailure({
            requestId: request.requestId,
            code: "browser_timeout",
            message: `Browser automation timed out after ${timeoutMs}ms.`,
            retryable: true,
          }),
        );
      }, timeoutMs);

      this.pending.set(request.requestId, {
        clientId: client.id,
        rememberAffinity: params.rememberAffinity ?? true,
        timeout,
        resolve,
      });

      try {
        Promise.resolve(client.sendBrowserAutomationRequest(request)).catch((error: unknown) => {
          resolveSendFailure({
            requestId: request.requestId,
            pending: this.pending,
            timeout,
            resolve,
            error,
          });
        });
      } catch (error) {
        resolveSendFailure({
          requestId: request.requestId,
          pending: this.pending,
          timeout,
          resolve,
          error,
        });
      }
    });
  }
}

function settleLiveRequest(
  pendingLive: Map<string, PendingLiveRequest>,
  payload: BrowserHostLiveResponsePayload,
): boolean {
  const pending = pendingLive.get(payload.requestId);
  if (!pending) return false;
  pendingLive.delete(payload.requestId);
  clearTimeout(pending.timeout);
  pending.resolve(payload);
  return true;
}

function settleControlRequest(
  pendingControl: Map<string, PendingControlRequest>,
  requestId: string,
  answer: BrowserHostControlAnswer | null,
): boolean {
  const pending = pendingControl.get(requestId);
  if (!pending) return false;
  pendingControl.delete(requestId);
  clearTimeout(pending.timeout);
  pending.resolve(answer);
  return true;
}

function controlRefusal(code: BrowserLiveControlErrorCode, message: string) {
  return { focus: null, error: { code, message } };
}

function controlIdField(control: { controlId: string } | null): { controlId?: string } {
  return control ? { controlId: control.controlId } : {};
}

class LiveViewRegistry {
  private readonly byStreamId = new Map<string, BrowserLiveViewStream>();
  private readonly streamIdByBrowserId = new Map<string, string>();

  public constructor(private readonly onRemoved: (stream: BrowserLiveViewStream) => void) {}

  public get size(): number {
    return this.byStreamId.size;
  }

  public get(streamId: string): BrowserLiveViewStream | undefined {
    return this.byStreamId.get(streamId);
  }

  public getByBrowserId(browserId: string): BrowserLiveViewStream | undefined {
    const streamId = this.streamIdByBrowserId.get(browserId);
    return streamId ? this.byStreamId.get(streamId) : undefined;
  }

  public add(stream: BrowserLiveViewStream): void {
    this.byStreamId.set(stream.streamId, stream);
    this.streamIdByBrowserId.set(stream.browserId, stream.streamId);
  }

  public remove(streamId: string): BrowserLiveViewStream | undefined {
    const stream = this.byStreamId.get(streamId);
    if (!stream) return undefined;
    this.byStreamId.delete(streamId);
    if (this.streamIdByBrowserId.get(stream.browserId) === streamId) {
      this.streamIdByBrowserId.delete(stream.browserId);
    }
    this.onRemoved(stream);
    return stream;
  }

  public removeAll(): BrowserLiveViewStream[] {
    const removed = [...this.byStreamId.values()];
    this.byStreamId.clear();
    this.streamIdByBrowserId.clear();
    for (const stream of removed) this.onRemoved(stream);
    return removed;
  }

  public removeForHost(hostClientId: string): BrowserLiveViewStream[] {
    const removed: BrowserLiveViewStream[] = [];
    for (const stream of this.byStreamId.values()) {
      if (stream.hostClientId === hostClientId) {
        this.remove(stream.streamId);
        removed.push(stream);
      }
    }
    return removed;
  }
}

function failureError(payload: BrowserToolsResponsePayload): BrowserToolsErrorPayload {
  return payload.ok
    ? {
        code: "browser_unknown_error",
        message: "Unexpected browser host result.",
        retryable: false,
      }
    : payload.error;
}

function getBrowserIdForCommand(command: BrowserAutomationCommand): string | null {
  if (command.command === "list_tabs" || command.command === "new_tab") {
    return null;
  }
  return command.args.browserId;
}

function describeBrowserHost(host: RegisteredBrowserHost): string {
  const hostKind = host.client.hostKind.trim();
  return hostKind || "browser host";
}

function withBrowserToolsRequestId(
  payload: BrowserToolsResponsePayload,
  requestId: string,
): BrowserToolsResponsePayload {
  return { ...payload, requestId } as BrowserToolsResponsePayload;
}

function resolveSendFailure(params: {
  requestId: string;
  pending: Map<string, PendingBrowserToolsRequest>;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (payload: BrowserToolsResponsePayload) => void;
  error: unknown;
}): void {
  if (!params.pending.delete(params.requestId)) {
    return;
  }
  clearTimeout(params.timeout);
  params.resolve(
    browserToolsFailure({
      requestId: params.requestId,
      code: "browser_unknown_error",
      message: formatBrowserAutomationSendError(params.error),
    }),
  );
}

function formatBrowserAutomationValidationError(message: string | undefined): string {
  if (!message) {
    return "Browser automation request is invalid.";
  }
  return `Browser automation request is invalid: ${message}.`;
}

function formatBrowserAutomationResponseValidationError(message: string | undefined): string {
  if (!message) {
    return "Browser automation response is invalid.";
  }
  return `Browser automation response is invalid: ${message}.`;
}

function formatBrowserAutomationSendError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `Browser automation request failed to send: ${error.message}`;
  }
  return `Browser automation request failed to send: ${String(error)}`;
}

function getBrowserAutomationResponseRequestId(response: unknown): string | null {
  if (!isRecord(response)) {
    return null;
  }
  const payload = response.payload;
  if (!isRecord(payload) || typeof payload.requestId !== "string") {
    return null;
  }
  return payload.requestId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

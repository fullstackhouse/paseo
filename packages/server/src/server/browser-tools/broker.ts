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
  BrowserHostLiveOutboundMessage,
  BrowserHostLiveStartResponse,
  BrowserHostLiveStopResponse,
  BrowserLiveViewport,
} from "@getpaseo/protocol/browser-automation/live-view";
import type { BrowserLiveFrameHeader } from "@getpaseo/protocol/binary-frames/browser-live";
import {
  browserToolsFailure,
  type BrowserToolsErrorPayload,
  type BrowserToolsResponsePayload,
} from "./errors.js";

export interface BrowserHostClient {
  id: string;
  hostKind: string;
  supportedCommands: readonly BrowserAutomationCommandName[];
  sendBrowserAutomationRequest(request: BrowserAutomationExecuteRequest): void | Promise<void>;
  /** Present when the host registered with liveView support. */
  liveView?: {
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
  | { ok: true; streamId: string; viewport: BrowserLiveViewport }
  | { ok: false; error: BrowserToolsErrorPayload };

interface BrowserLiveViewStream {
  streamId: string;
  browserId: string;
  viewerId: string;
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
}

const DEFAULT_BROWSER_TOOLS_TIMEOUT_MS = 15_000;

export class BrowserToolsBroker {
  private readonly defaultTimeoutMs: number;
  private readonly createRequestId: () => string;
  private readonly clients = new Map<string, RegisteredBrowserHost>();
  private readonly pending = new Map<string, PendingBrowserToolsRequest>();
  private readonly browserHostByBrowserId = new Map<string, string>();
  private readonly strandedBrowserHostByBrowserId = new Map<string, string>();
  private registrationSequence = 0;
  private readonly liveViews = new LiveViewRegistry();
  private readonly pendingLive = new Map<string, PendingLiveRequest>();

  public constructor(options: BrowserToolsBrokerOptions) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BROWSER_TOOLS_TIMEOUT_MS;
    this.createRequestId = options.createRequestId ?? (() => `browser_${randomUUID()}`);
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

  public async execute(input: BrowserToolsExecuteInput): Promise<BrowserToolsResponsePayload> {
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

    if (request.data.command.command === "list_tabs") {
      return this.executeListTabs({
        request: request.data,
        timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
      });
    }

    const host = this.selectHostForCommand(request.data.command, requestId);
    if (!host.ok) {
      return host.payload;
    }

    const unsupported = this.unsupportedCommandFailure({
      host: host.value,
      commandName: request.data.command.command,
      requestId,
    });
    if (unsupported) {
      return unsupported;
    }

    return this.sendRequest({
      host: host.value,
      request: request.data,
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
    });
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
    options: BrowserLiveViewOptions;
    sink: BrowserLiveViewSink;
    respond: (result: BrowserLiveViewStartResult) => void;
    timeoutMs?: number;
  }): Promise<void> {
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
        ...input.options,
      },
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
    });

    if (this.liveViews.get(stream.streamId) !== stream) {
      // Stopped while starting (viewer left or host gone). Make sure the host is not left streaming.
      if (!response.error && this.clients.has(stream.hostClientId)) {
        void this.sendStopToHost(stream, this.createRequestId());
      }
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
    input.respond({ ok: true, streamId: stream.streamId, viewport: response.viewport });
    const early = stream.earlyFrame;
    stream.earlyFrame = null;
    if (early) {
      this.relayLiveFrame(stream, early.frameSeq, early.bytes);
    }
  }

  public async stopLiveView(
    streamId: string,
    viewerId: string,
  ): Promise<{ error: BrowserToolsErrorPayload | null }> {
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

  /** Forwards the viewer's ack for the frame in flight; stale or foreign acks are dropped. */
  public ackLiveFrame(streamId: string, frameSeq: number, viewerId: string): boolean {
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
  public receiveLiveFrame(
    header: BrowserLiveFrameHeader,
    bytes: Uint8Array,
    clientIds: readonly string[],
  ): boolean {
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

  public receiveLiveResponse(
    payload: BrowserHostLiveResponsePayload,
    clientIds: readonly string[],
  ): boolean {
    const pending = this.pendingLive.get(payload.requestId);
    if (!pending || !clientIds.includes(pending.clientId)) {
      return false;
    }
    return settleLiveRequest(this.pendingLive, payload);
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

class LiveViewRegistry {
  private readonly byStreamId = new Map<string, BrowserLiveViewStream>();
  private readonly streamIdByBrowserId = new Map<string, string>();

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
    return stream;
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

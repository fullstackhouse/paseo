import { ipcMain } from "electron";
import { BrowserAutomationExecuteRequestSchema } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import {
  BrowserHostLiveFrameAckSchema,
  BrowserHostLiveStartRequestSchema,
  BrowserHostLiveStopRequestSchema,
  type BrowserHostLiveStartResponse,
  type BrowserHostLiveStopResponse,
} from "@getpaseo/protocol/browser-automation/live-view";
import { BrowserLiveViewStream, type BrowserLiveViewEvents } from "./live-view.js";
import type {
  BrowserAutomationConsoleLogEntry,
  BrowserAutomationDialogEvent,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type { TabContents, BrowserRegistry, TabImage } from "./service.js";
import type { IsolatedKeyboardInputEvent } from "./trusted-input.js";
import { CdpSessionQueue } from "./cdp-session-queue.js";
import { FrameProduction } from "./frame-production.js";
import {
  dialogAcceptValue,
  handledDialogEvent,
  MAX_DIALOGS_PER_COMMAND,
  promptShimDrainScript,
  promptShimInstallScript,
  promptShimRestoreScript,
} from "./dialog-handling.js";
import { BrowserTabClosedError, executeAutomationCommand } from "./service.js";
import { BrowserSnapshotEngine } from "./snapshot-engine.js";
import {
  listRegisteredPaseoBrowserIds,
  listRegisteredPaseoBrowserIdsForWorkspace,
  getPaseoBrowserWebContentsForHostWindow,
  getWorkspaceActivePaseoBrowserIdForHostWindow,
  getPaseoBrowserWorkspaceId,
} from "../browser-webviews/index.js";

const MAX_CONSOLE_MESSAGES_PER_TAB = 200;
const consoleMessagesByContentsId = new Map<number, BrowserAutomationConsoleLogEntry[]>();
const cdpQueuesByContentsId = new Map<number, CdpSessionQueue>();
const dialogMonitorsByContentsId = new Map<number, DialogMonitor>();
const observedContentsIds = new Set<number>();
const frameProductionByContentsId = new Map<number, FrameProduction>();

interface IpcHandlerRegistry {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

interface HostWebContents {
  readonly id: number;
  once(event: "destroyed", listener: () => void): void;
}

interface LiveViewHostWebContents extends HostWebContents {
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

export const BROWSER_LIVE_FRAME_EVENT = "paseo:event:browser-live-frame";
export const BROWSER_LIVE_ENDED_EVENT = "paseo:event:browser-live-ended";

export class HostSnapshotEngineRegistry {
  private readonly entries = new Map<
    number,
    { hostContents: HostWebContents; snapshotEngine: BrowserSnapshotEngine }
  >();

  public get(hostContents: HostWebContents): BrowserSnapshotEngine {
    const existing = this.entries.get(hostContents.id);
    if (existing) {
      return existing.snapshotEngine;
    }
    const snapshotEngine = new BrowserSnapshotEngine();
    const entry = { hostContents, snapshotEngine };
    this.entries.set(hostContents.id, entry);
    hostContents.once("destroyed", () => {
      if (this.entries.get(hostContents.id) === entry) {
        this.entries.delete(hostContents.id);
      }
    });
    return snapshotEngine;
  }
}

const hostSnapshotEngines = new HostSnapshotEngineRegistry();

interface WebContentsDebugger {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  sendCommand(command: string, params?: Record<string, unknown>): Promise<unknown>;
  on?(
    event: "message",
    listener: (event: unknown, method: string, params?: Record<string, unknown>) => void,
  ): void;
  on?(event: "detach", listener: () => void): void;
  removeListener?(
    event: "message",
    listener: (event: unknown, method: string, params?: Record<string, unknown>) => void,
  ): void;
  removeListener?(event: "detach", listener: () => void): void;
}

interface ConsoleMessageEmitter {
  on(
    event: "console-message",
    listener: (
      event: unknown,
      level: unknown,
      message: unknown,
      line: unknown,
      sourceId: unknown,
    ) => void,
  ): void;
  once(event: "destroyed", listener: () => void): void;
}

interface BrowserAutomationWebContents extends ConsoleMessageEmitter {
  removeListener(event: "destroyed", listener: () => void): void;
  readonly id: number;
  readonly debugger: WebContentsDebugger;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  isLoading(): boolean;
  isDestroyed(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  beginFrameSubscription(onlyDirty: boolean, callback: (image: TabImage) => void): void;
  endFrameSubscription(): void;
  invalidate(): void;
  getBackgroundThrottling(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
  sendInputEvent(event: IsolatedKeyboardInputEvent): void;
  insertText(text: string): Promise<void>;
}

export function adaptWebContents(
  contents: BrowserAutomationWebContents,
): TabContents & Required<Pick<TabContents, "sendDebugCommand">> & { holdPainting(): () => void } {
  const contentsId = contents.id;
  observeConsoleMessages(contents, contentsId);
  const cdpQueue = getCdpQueue(contentsId);
  const dialogMonitor = getDialogMonitor(contents, contentsId, cdpQueue);
  const frameProduction = getFrameProduction(contents, contentsId);
  return {
    id: contentsId,
    getURL: () => contents.getURL(),
    getTitle: () => contents.getTitle(),
    canGoBack: () => contents.canGoBack(),
    canGoForward: () => contents.canGoForward(),
    isLoading: () => contents.isLoading(),
    isDestroyed: () => contents.isDestroyed(),
    executeJavaScript: (code: string) => contents.executeJavaScript(code),
    loadURL: (url: string) => contents.loadURL(url),
    goBack: () => contents.goBack(),
    goForward: () => contents.goForward(),
    reload: () => contents.reload(),
    captureFrame: (signal) => captureViewportFrame(contents, frameProduction, signal),
    invalidate: () => contents.invalidate(),
    withFrameProduction: async (capture) => {
      const release = frameProduction.holdThrottling();
      try {
        return await capture();
      } finally {
        release();
      }
    },
    sendInputEvent: (event) => contents.sendInputEvent(event),
    insertText: (text) => contents.insertText(text),
    holdPainting: () => frameProduction.holdPainting(),
    getConsoleMessages: () => consoleMessagesByContentsId.get(contentsId) ?? [],
    captureDialogs: (task) => dialogMonitor.capture(task),
    sendDebugCommand: (command: string, params?: Record<string, unknown>) =>
      cdpQueue.run(async () => {
        if (!contents.debugger.isAttached()) {
          contents.debugger.attach("1.3");
        }
        return contents.debugger.sendCommand(command, params ?? {});
      }),
  };
}

function captureViewportFrame(
  contents: BrowserAutomationWebContents,
  frameProduction: FrameProduction,
  signal: AbortSignal,
): Promise<TabImage> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let stopFrames = () => {};
    const stop = () => {
      signal.removeEventListener("abort", abort);
      contents.removeListener("destroyed", destroyed);
      stopFrames();
    };
    const abort = () => {
      stop();
      reject(signal.reason);
    };
    const destroyed = () => {
      stop();
      reject(new BrowserTabClosedError());
    };
    signal.addEventListener("abort", abort, { once: true });
    contents.once("destroyed", destroyed);
    try {
      // A resized resident guest can paint while capturePage's surface-copy
      // request remains pending. Subscribe to its rendered frames instead.
      stopFrames = frameProduction.onFrame((image) => {
        stop();
        resolve(image);
      });
    } catch (error) {
      stop();
      reject(error);
    }
  });
}

function getFrameProduction(
  contents: BrowserAutomationWebContents,
  contentsId: number,
): FrameProduction {
  const existing = frameProductionByContentsId.get(contentsId);
  if (existing) {
    return existing;
  }
  const production = new FrameProduction(contents);
  frameProductionByContentsId.set(contentsId, production);
  return production;
}

function getCdpQueue(contentsId: number): CdpSessionQueue {
  const existing = cdpQueuesByContentsId.get(contentsId);
  if (existing) {
    return existing;
  }
  const queue = new CdpSessionQueue();
  cdpQueuesByContentsId.set(contentsId, queue);
  return queue;
}

function observeConsoleMessages(contents: BrowserAutomationWebContents, contentsId: number): void {
  if (observedContentsIds.has(contentsId)) {
    return;
  }
  observedContentsIds.add(contentsId);
  contents.on("console-message", (_event, level, message, line, sourceId) => {
    const entry = normalizeConsoleMessage({ level, message, line, sourceId });
    const messages = consoleMessagesByContentsId.get(contentsId) ?? [];
    messages.push(entry);
    consoleMessagesByContentsId.set(contentsId, messages.slice(-MAX_CONSOLE_MESSAGES_PER_TAB));
  });
  contents.once("destroyed", () => {
    observedContentsIds.delete(contentsId);
    consoleMessagesByContentsId.delete(contentsId);
    cdpQueuesByContentsId.delete(contentsId);
    dialogMonitorsByContentsId.delete(contentsId);
    frameProductionByContentsId.delete(contentsId);
  });
}

function getDialogMonitor(
  contents: BrowserAutomationWebContents,
  contentsId: number,
  cdpQueue: CdpSessionQueue,
): DialogMonitor {
  const existing = dialogMonitorsByContentsId.get(contentsId);
  if (existing) {
    return existing;
  }
  const monitor = new DialogMonitor(contents, contentsId, cdpQueue);
  dialogMonitorsByContentsId.set(contentsId, monitor);
  return monitor;
}

class DialogMonitor {
  private enabled = false;
  private listenerRegistered = false;
  private detachGeneration = 0;
  private readonly activeCollectors: DialogCollector[] = [];

  public constructor(
    private readonly contents: BrowserAutomationWebContents,
    private readonly contentsId: number,
    private readonly cdpQueue: CdpSessionQueue,
  ) {}

  public async capture<T>(
    task: () => Promise<T>,
  ): Promise<{ result: T; dialogs: BrowserAutomationDialogEvent[] }> {
    const collector: DialogCollector = { dialogs: [] };
    const setupDetachGeneration = this.detachGeneration;
    try {
      await this.enable();
      await this.installPromptShim();
    } catch (error) {
      if (this.contents.isDestroyed() || this.detachGeneration !== setupDetachGeneration) {
        throw error;
      }
      console.warn("[browser-automation] Dialog capture unavailable; running command without it", {
        contentsId: this.contentsId,
        error,
      });
      return { result: await task(), dialogs: [] };
    }
    this.activeCollectors.push(collector);
    try {
      const result = await task();
      this.recordPromptShimDialogs(await this.drainPromptShim());
      return { result, dialogs: collector.dialogs };
    } finally {
      const index = this.activeCollectors.indexOf(collector);
      if (index >= 0) {
        this.activeCollectors.splice(index, 1);
      }
      if (this.activeCollectors.length === 0) {
        await this.restorePromptShim();
      }
    }
  }

  private async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }
    if (!this.contents.debugger.on) {
      return;
    }
    if (!this.listenerRegistered) {
      this.listenerRegistered = true;
      this.contents.debugger.on("message", (_event, method, params) => {
        if (method !== "Page.javascriptDialogOpening") {
          return;
        }
        if (this.activeCollectors.length === 0) {
          return;
        }
        void this.handleOpening(params ?? {});
      });
      this.contents.debugger.on("detach", () => {
        this.enabled = false;
        this.detachGeneration += 1;
      });
    }
    await this.sendDebugCommand("Page.enable");
    this.enabled = true;
  }

  private async handleOpening(params: Record<string, unknown>): Promise<void> {
    const event = handledDialogEvent(params);
    for (const collector of this.activeCollectors) {
      this.recordDialogs(collector, [event]);
    }
    await this.sendDialogResponseCommand("Page.handleJavaScriptDialog", {
      accept: dialogAcceptValue(event.type),
    });
  }

  private async installPromptShim(): Promise<void> {
    await this.sendDebugCommand("Runtime.evaluate", {
      expression: promptShimInstallScript(),
      returnByValue: true,
    });
  }

  private async drainPromptShim(): Promise<BrowserAutomationDialogEvent[]> {
    try {
      const result = (await this.sendDebugCommand("Runtime.evaluate", {
        expression: promptShimDrainScript(),
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      return parsePromptShimDialogs(result.result?.value);
    } catch {
      return [];
    }
  }

  private async restorePromptShim(): Promise<void> {
    try {
      await this.sendDebugCommand("Runtime.evaluate", {
        expression: promptShimRestoreScript(),
        returnByValue: true,
      });
    } catch {
      // Navigation can destroy the execution context before cleanup runs; the next page has no shim.
    }
  }

  private recordDialogs(collector: DialogCollector, dialogs: BrowserAutomationDialogEvent[]): void {
    for (const dialog of dialogs) {
      if (collector.dialogs.length >= MAX_DIALOGS_PER_COMMAND) {
        return;
      }
      collector.dialogs.push(dialog);
    }
  }

  private recordPromptShimDialogs(dialogs: BrowserAutomationDialogEvent[]): void {
    for (const collector of this.activeCollectors) {
      this.recordDialogs(collector, dialogs);
    }
  }

  private async sendDebugCommand(
    command: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.cdpQueue.run(async () => {
      if (!this.contents.debugger.isAttached()) {
        this.contents.debugger.attach("1.3");
      }
      return this.contents.debugger.sendCommand(command, params ?? {});
    });
  }

  private async sendDialogResponseCommand(
    command: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    // Dialogs can block the CDP command that opened them, so the unblocker must not wait behind
    // the per-tab command queue.
    if (!this.contents.debugger.isAttached()) {
      this.contents.debugger.attach("1.3");
    }
    return this.contents.debugger.sendCommand(command, params ?? {});
  }
}

interface DialogCollector {
  dialogs: BrowserAutomationDialogEvent[];
}

function parsePromptShimDialogs(value: unknown): BrowserAutomationDialogEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): BrowserAutomationDialogEvent[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (record.type !== "prompt" || record.action !== "dismissed") {
      return [];
    }
    return [
      {
        type: "prompt",
        message: typeof record.message === "string" ? record.message : "",
        ...(typeof record.defaultValue === "string" ? { defaultValue: record.defaultValue } : {}),
        action: "dismissed",
        timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now(),
      },
    ];
  });
}

function normalizeConsoleMessage(input: {
  level: unknown;
  message: unknown;
  line: unknown;
  sourceId: unknown;
}): BrowserAutomationConsoleLogEntry {
  return {
    level: typeof input.level === "string" ? input.level : String(input.level ?? "log"),
    message: typeof input.message === "string" ? input.message : String(input.message ?? ""),
    ...(typeof input.sourceId === "string" && input.sourceId.length > 0
      ? { source: input.sourceId }
      : {}),
    ...(typeof input.line === "number" ? { line: input.line } : {}),
    timestamp: Date.now(),
  };
}

function createRegistry(hostWebContentsId: number): BrowserRegistry {
  return {
    listRegisteredBrowserIds: listRegisteredPaseoBrowserIds,
    listRegisteredBrowserIdsForWorkspace: listRegisteredPaseoBrowserIdsForWorkspace,
    getTabContents(browserId: string): TabContents | null {
      const contents = getPaseoBrowserWebContentsForHostWindow(browserId, hostWebContentsId);
      return contents ? adaptWebContents(contents) : null;
    },
    getBrowserWorkspaceId: getPaseoBrowserWorkspaceId,
    getWorkspaceActiveBrowserId(workspaceId: string): string | null {
      return getWorkspaceActivePaseoBrowserIdForHostWindow(workspaceId, hostWebContentsId);
    },
  };
}

function liveViewEvents(contents: BrowserAutomationWebContents): BrowserLiveViewEvents {
  return {
    onMessage(listener) {
      const handler = (_event: unknown, method: string, params?: Record<string, unknown>) =>
        listener(method, params ?? {});
      contents.debugger.on?.("message", handler);
      return () => contents.debugger.removeListener?.("message", handler);
    },
    onGone(listener) {
      contents.once("destroyed", listener);
      contents.debugger.on?.("detach", listener);
      return () => {
        contents.removeListener("destroyed", listener);
        contents.debugger.removeListener?.("detach", listener);
      };
    },
  };
}

/** Live view screencasts by streamId, across host windows. */
export class BrowserLiveViewStreams {
  private readonly streams = new Map<string, BrowserLiveViewStream>();
  private readonly streamIdsByHost = new Map<number, Set<string>>();
  // CDP allows one screencast per debugger session, so one stream per tab.
  private readonly streamIdByContentsId = new Map<number, string>();

  public constructor(
    private readonly getTabContents: (
      browserId: string,
      hostWebContentsId: number,
    ) => BrowserAutomationWebContents | null,
  ) {}

  public get size(): number {
    return this.streams.size;
  }

  public async start(
    hostContents: LiveViewHostWebContents,
    rawRequest: unknown,
  ): Promise<BrowserHostLiveStartResponse["payload"]> {
    const parsed = BrowserHostLiveStartRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return liveFailure(
        readRequestId(rawRequest),
        "browser_unknown_error",
        "Invalid live view request.",
      );
    }
    const request = parsed.data;
    if (this.streams.has(request.streamId)) {
      return liveFailure(request.requestId, "browser_denied", "Live view stream already exists.");
    }
    const contents = this.getTabContents(request.browserId, hostContents.id);
    if (!contents) {
      return liveFailure(
        request.requestId,
        "browser_tab_not_found",
        `No browser tab found for ID: ${request.browserId}`,
      );
    }
    const contentsId = contents.id;
    if (this.streamIdByContentsId.has(contentsId)) {
      return liveFailure(
        request.requestId,
        "browser_denied",
        `Browser tab ${request.browserId} is already streaming a live view.`,
      );
    }
    const hostStreamIds = this.streamIdsOfHost(hostContents);
    const stream = new BrowserLiveViewStream({
      streamId: request.streamId,
      tab: adaptWebContents(contents),
      events: liveViewEvents(contents),
      onFrame: (frame) => {
        if (!hostContents.isDestroyed()) hostContents.send(BROWSER_LIVE_FRAME_EVENT, frame);
      },
      onEnded: (reason) => {
        if (this.streams.get(request.streamId) !== stream) return;
        this.streams.delete(request.streamId);
        hostStreamIds.delete(request.streamId);
        this.streamIdByContentsId.delete(contentsId);
        // Nobody asked for this end; the daemon still thinks the viewer is watching.
        if (reason === "gone" && !hostContents.isDestroyed()) {
          hostContents.send(BROWSER_LIVE_ENDED_EVENT, {
            streamId: request.streamId,
            error: {
              code: "browser_tab_closed",
              message: `Browser tab ${request.browserId} closed.`,
              retryable: false,
            },
          });
        }
      },
    });
    this.streams.set(request.streamId, stream);
    hostStreamIds.add(request.streamId);
    this.streamIdByContentsId.set(contentsId, request.streamId);
    try {
      const viewport = await stream.start({
        ...(request.maxFps !== undefined ? { maxFps: request.maxFps } : {}),
        ...(request.jpegQuality !== undefined ? { jpegQuality: request.jpegQuality } : {}),
        ...(request.maxWidth !== undefined ? { maxWidth: request.maxWidth } : {}),
      });
      return { requestId: request.requestId, viewport, error: null };
    } catch (error) {
      return liveFailure(
        request.requestId,
        "browser_unknown_error",
        error instanceof Error && error.message ? error.message : "Live view failed to start.",
      );
    }
  }

  public async stop(rawRequest: unknown): Promise<BrowserHostLiveStopResponse["payload"]> {
    const parsed = BrowserHostLiveStopRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return {
        requestId: readRequestId(rawRequest),
        error: {
          code: "browser_unknown_error",
          message: "Invalid live view request.",
          retryable: false,
        },
      };
    }
    // Stopping an unknown stream is a no-op: the daemon may stop a stream that already ended.
    await this.streams.get(parsed.data.streamId)?.stop();
    return { requestId: parsed.data.requestId, error: null };
  }

  public ack(rawAck: unknown): void {
    const parsed = BrowserHostLiveFrameAckSchema.safeParse(rawAck);
    if (parsed.success) this.streams.get(parsed.data.streamId)?.ack(parsed.data.frameSeq);
  }

  private streamIdsOfHost(hostContents: LiveViewHostWebContents): Set<string> {
    const hostId = hostContents.id;
    const existing = this.streamIdsByHost.get(hostId);
    if (existing) return existing;
    const streamIds = new Set<string>();
    this.streamIdsByHost.set(hostId, streamIds);
    // Streams started from a window die with it; nothing else would ack or stop them.
    hostContents.once("destroyed", () => {
      this.streamIdsByHost.delete(hostId);
      for (const streamId of streamIds) void this.streams.get(streamId)?.stop();
    });
    return streamIds;
  }
}

function liveFailure(
  requestId: string,
  code: "browser_unknown_error" | "browser_denied" | "browser_tab_not_found",
  message: string,
): BrowserHostLiveStartResponse["payload"] {
  return { requestId, viewport: null, error: { code, message, retryable: false } };
}

export function registerBrowserAutomationIpc(options?: { ipc?: IpcHandlerRegistry }): void {
  const ipc = options?.ipc ?? ipcMain;
  const liveViews = new BrowserLiveViewStreams(getPaseoBrowserWebContentsForHostWindow);

  ipc.handle("paseo:browser:live-start", (event, rawRequest: unknown) => {
    const hostContents = (event as { sender?: LiveViewHostWebContents }).sender;
    if (!hostContents) {
      return liveFailure(
        readRequestId(rawRequest),
        "browser_unknown_error",
        "Live view requires a host window.",
      );
    }
    return liveViews.start(hostContents, rawRequest);
  });
  ipc.handle("paseo:browser:live-stop", (_event, rawRequest: unknown) =>
    liveViews.stop(rawRequest),
  );
  ipc.handle("paseo:browser:live-frame-ack", (_event, rawAck: unknown) => {
    liveViews.ack(rawAck);
  });

  ipc.handle("paseo:browser:execute-automation-command", async (event, rawRequest: unknown) => {
    const hostContents = (event as { sender?: HostWebContents }).sender;
    const hostWebContentsId = hostContents?.id;
    if (!hostContents || typeof hostWebContentsId !== "number") {
      return {
        requestId: readRequestId(rawRequest),
        ok: false as const,
        error: {
          code: "browser_unsupported" as const,
          message: "Browser automation requires a host window.",
        },
      };
    }
    const registry = createRegistry(hostWebContentsId);
    const parsed = BrowserAutomationExecuteRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return {
        requestId: readRequestId(rawRequest),
        ok: false as const,
        error: {
          code: "browser_unsupported" as const,
          message: `Invalid automation request: ${parsed.error.message}`,
          retryable: false,
        },
      };
    }
    return executeAutomationCommand(parsed.data, registry, {
      snapshotEngine: hostSnapshotEngines.get(hostContents),
    });
  });
}

function readRequestId(rawRequest: unknown): string {
  if (typeof rawRequest !== "object" || rawRequest === null || Array.isArray(rawRequest)) {
    return "unknown";
  }
  const requestId = (rawRequest as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : "unknown";
}

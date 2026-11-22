import { ipcMain } from "electron";
import { BrowserAutomationExecuteRequestSchema } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import {
  BrowserHostLiveFrameAckSchema,
  BrowserHostLiveReleaseControlRequestSchema,
  BrowserHostLiveSendInputRequestSchema,
  BrowserHostLiveStartRequestSchema,
  BrowserHostLiveStopRequestSchema,
  BrowserHostLiveTakeControlRequestSchema,
  type BrowserHostLiveReleaseControlResponse,
  type BrowserHostLiveSendInputResponse,
  type BrowserHostLiveStartResponse,
  type BrowserHostLiveStopResponse,
  type BrowserHostLiveTakeControlResponse,
} from "@getpaseo/protocol/browser-automation/live-view";
import { GUEST_CONTROL_REPLY_CHANNEL, type GuestFrame } from "./guest-frames.js";
import {
  BrowserHumanControls,
  type HumanControlContents,
  type HumanControlTab,
} from "./human-control.js";
import { BrowserLiveViewStream, type BrowserLiveViewEvents } from "./live-view.js";
import type {
  BrowserAutomationConsoleLogEntry,
  BrowserAutomationDialogEvent,
  BrowserAutomationExecuteRequest,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type {
  AutomationCommandPayload,
  TabContents,
  BrowserRegistry,
  TabImage,
} from "./service.js";
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

const humanControls = new BrowserHumanControls();

/** See BrowserHumanControls.hasTypedInto. */
export function hasLiveViewTypedInto(contentsId: number): boolean {
  return humanControls.hasTypedInto(contentsId);
}

interface IpcHandlerRegistry {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: GuestReplyEvent, payload: unknown) => void): void;
}

interface GuestReplyEvent {
  processId: number;
  frameId: number;
}

interface HostWebContents {
  readonly id: number;
  once(event: "destroyed", listener: () => void): void;
}

interface LiveViewHostWebContents extends HostWebContents {
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
  getBackgroundThrottling(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
}

export const BROWSER_LIVE_FRAME_EVENT = "paseo:event:browser-live-frame";
export const BROWSER_LIVE_ENDED_EVENT = "paseo:event:browser-live-ended";
export const BROWSER_LIVE_CONTROL_ENDED_EVENT = "paseo:event:browser-live-control-ended";

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

type DebuggerMessageListener = (
  event: unknown,
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string,
) => void;

interface WebContentsDebugger {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  sendCommand(
    command: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown>;
  on?(event: "message", listener: DebuggerMessageListener): void;
  on?(event: "detach", listener: () => void): void;
  removeListener?(event: "message", listener: DebuggerMessageListener): void;
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
  readonly mainFrame: HumanControlContents["mainFrame"];
  readonly focusedFrame: GuestFrame | null;
  readonly navigationHistory: HumanControlContents["navigationHistory"];
  getZoomFactor(): number;
  isLoadingMainFrame(): boolean;
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
    // browser_logs would read it after hand-back.
    if (humanControls.isHeld(contentsId)) return;
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

function humanControlTab(contents: BrowserAutomationWebContents): HumanControlTab {
  // Adapting registers the tab's observers; sends share its CDP queue.
  const { id } = adaptWebContents(contents);
  const cdpQueue = getCdpQueue(id);
  // Read once: the getter throws once the tab is destroyed, when control still has to clean up,
  // and an exception in that listener takes down Electron main.
  const debuggerApi = contents.debugger;
  return {
    contents: contents as BrowserAutomationWebContents & HumanControlContents,
    send: (command, params, sessionId) =>
      cdpQueue.run(async () => {
        if (contents.isDestroyed()) throw new BrowserTabClosedError();
        if (!debuggerApi.isAttached()) debuggerApi.attach("1.3");
        return debuggerApi.sendCommand(command, params ?? {}, sessionId);
      }),
    answerDialog: async (accept, sessionId) =>
      debuggerApi.sendCommand("Page.handleJavaScriptDialog", { accept }, sessionId),
    onMessage: (listener) => {
      const handler: DebuggerMessageListener = (_event, method, params, sessionId) =>
        listener(method, params ?? {}, sessionId);
      debuggerApi.on?.("message", handler);
      return () => debuggerApi.removeListener?.("message", handler);
    },
  };
}

function readCommittedOrigin(contents: BrowserAutomationWebContents): string | undefined {
  if (contents.isDestroyed()) return undefined;
  const { mainFrame } = contents;
  return mainFrame.isDestroyed() ? undefined : mainFrame.origin;
}

/** Runs an agent's command unless a human controls its tab. */
export async function runAgentCommand(input: {
  request: BrowserAutomationExecuteRequest;
  registry: BrowserRegistry;
  snapshotEngine: BrowserSnapshotEngine;
  controls: BrowserHumanControls;
}): Promise<AutomationCommandPayload> {
  const { request, registry, snapshotEngine, controls } = input;
  const execute = () => executeAutomationCommand(request, registry, { snapshotEngine });
  const { command } = request;
  if (command.command === "list_tabs") {
    return withholdHeldTabs(await execute(), registry, controls);
  }
  if (command.command === "new_tab") return execute();
  const contents = registry.getTabContents(command.args.browserId);
  if (!contents || contents.isDestroyed()) return execute();
  if (controls.isHeld(contents.id)) {
    return {
      requestId: request.requestId,
      ok: false,
      error: {
        // Not browser_human_control: daemons that predate it reject responses with unknown codes.
        code: "browser_denied",
        message:
          "The user is controlling this tab. Wait for hand-back, then call browser_snapshot.",
        retryable: true,
      },
    };
  }
  return controls.track(contents.id, execute);
}

function withholdHeldTabs(
  payload: AutomationCommandPayload,
  registry: BrowserRegistry,
  controls: BrowserHumanControls,
): AutomationCommandPayload {
  if (!payload.ok || payload.result.command !== "list_tabs") return payload;
  const tabs = payload.result.tabs.map((tab) => {
    const contents = registry.getTabContents(tab.browserId);
    const held = contents && !contents.isDestroyed() && controls.isHeld(contents.id);
    return held ? { ...tab, url: "", title: "" } : tab;
  });
  return { ...payload, result: { ...payload.result, tabs } };
}

/** Live view screencasts by streamId, across host windows. */
export class BrowserLiveViewStreams {
  private readonly streams = new Map<string, BrowserLiveViewStream>();
  private readonly streamIdsByHost = new Map<number, Set<string>>();
  // CDP allows one screencast per debugger session, so one stream per tab.
  private readonly streamIdByContentsId = new Map<number, string>();
  private readonly tabByStreamId = new Map<
    string,
    { contents: BrowserAutomationWebContents; hostId: number }
  >();
  private readonly hostThrottlingBefore = new Map<number, boolean>();

  public constructor(
    private readonly getTabContents: (
      browserId: string,
      hostWebContentsId: number,
    ) => BrowserAutomationWebContents | null,
    private readonly controls: BrowserHumanControls = humanControls,
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
    if (this.controls.isHeldByOther(contentsId, request.controlId)) {
      return liveFailure(
        request.requestId,
        "browser_denied",
        `Browser tab ${request.browserId} is being controlled.`,
      );
    }
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
        if (hostContents.isDestroyed()) return;
        const origin = readCommittedOrigin(contents);
        hostContents.send(BROWSER_LIVE_FRAME_EVENT, {
          ...frame,
          metadata: { ...frame.metadata, ...(origin ? { origin } : {}) },
        });
      },
      onEnded: (reason) => {
        if (this.streams.get(request.streamId) !== stream) return;
        this.streams.delete(request.streamId);
        hostStreamIds.delete(request.streamId);
        if (hostStreamIds.size === 0) this.releaseHostWindow(hostContents);
        this.streamIdByContentsId.delete(contentsId);
        this.tabByStreamId.delete(request.streamId);
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
    if (hostStreamIds.size === 0) this.holdHostWindow(hostContents);
    hostStreamIds.add(request.streamId);
    this.streamIdByContentsId.set(contentsId, request.streamId);
    this.tabByStreamId.set(request.streamId, { contents, hostId: hostContents.id });
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

  public async takeControl(
    hostContents: LiveViewHostWebContents,
    rawRequest: unknown,
  ): Promise<BrowserHostLiveTakeControlResponse["payload"]> {
    const parsed = BrowserHostLiveTakeControlRequestSchema.safeParse(rawRequest);
    if (!parsed.success) return invalidControlRequest(rawRequest);
    const { requestId, streamId, controlId } = parsed.data;
    const contents = this.tabOfStream(hostContents, streamId);
    if (!contents) return streamGone(requestId);
    const result = await this.controls.take({
      controlId,
      hostId: hostContents.id,
      tab: humanControlTab(contents),
      onEnded: () => {
        if (hostContents.isDestroyed()) return;
        hostContents.send(BROWSER_LIVE_CONTROL_ENDED_EVENT, { controlId });
      },
    });
    return { requestId, ...result };
  }

  public async sendInput(
    hostContents: LiveViewHostWebContents,
    rawRequest: unknown,
  ): Promise<BrowserHostLiveSendInputResponse["payload"]> {
    const parsed = BrowserHostLiveSendInputRequestSchema.safeParse(rawRequest);
    // The parse error is dropped on purpose: the request can hold a secret.
    if (!parsed.success) return invalidControlRequest(rawRequest);
    const { requestId, streamId, controlId, input } = parsed.data;
    const contents = this.tabOfStream(hostContents, streamId);
    if (!contents) return streamGone(requestId);
    const result = await this.controls.input({
      controlId,
      hostId: hostContents.id,
      contentsId: contents.id,
      input,
    });
    return { requestId, ...result };
  }

  public async releaseControl(
    hostContents: LiveViewHostWebContents,
    rawRequest: unknown,
  ): Promise<BrowserHostLiveReleaseControlResponse["payload"]> {
    const parsed = BrowserHostLiveReleaseControlRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      const { requestId, error } = invalidControlRequest(rawRequest);
      return { requestId, error };
    }
    const { requestId, controlId, discardInput } = parsed.data;
    const error = await this.controls.release({
      controlId,
      hostId: hostContents.id,
      discardInput,
    });
    return { requestId, error };
  }

  private tabOfStream(
    hostContents: LiveViewHostWebContents,
    streamId: string,
  ): BrowserAutomationWebContents | null {
    const tab = this.tabByStreamId.get(streamId);
    return tab?.hostId === hostContents.id && !tab.contents.isDestroyed() ? tab.contents : null;
  }

  public ack(rawAck: unknown): void {
    const parsed = BrowserHostLiveFrameAckSchema.safeParse(rawAck);
    if (parsed.success) this.streams.get(parsed.data.streamId)?.ack(parsed.data.frameSeq);
  }

  /**
   * Guests composite inside their window. A hidden or occluded Paseo window stops painting
   * its guests too, and the phone is usually used away from the desk, so keep the window
   * rendering while it streams.
   */
  private holdHostWindow(hostContents: LiveViewHostWebContents): void {
    this.hostThrottlingBefore.set(hostContents.id, hostContents.getBackgroundThrottling());
    hostContents.setBackgroundThrottling(false);
  }

  private releaseHostWindow(hostContents: LiveViewHostWebContents): void {
    const before = this.hostThrottlingBefore.get(hostContents.id);
    this.hostThrottlingBefore.delete(hostContents.id);
    if (before !== undefined && !hostContents.isDestroyed()) {
      hostContents.setBackgroundThrottling(before);
    }
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

function invalidControlRequest(rawRequest: unknown) {
  return {
    requestId: readRequestId(rawRequest),
    focus: null,
    error: { code: "failed", message: "Invalid live view request." },
  };
}

function streamGone(requestId: string) {
  return {
    requestId,
    focus: null,
    error: { code: "failed", message: "The live view ended." },
  };
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

  ipc.handle("paseo:browser:live-take-control", (event, rawRequest: unknown) =>
    liveViews.takeControl((event as { sender: LiveViewHostWebContents }).sender, rawRequest),
  );
  ipc.handle("paseo:browser:live-send-input", (event, rawRequest: unknown) =>
    liveViews.sendInput((event as { sender: LiveViewHostWebContents }).sender, rawRequest),
  );
  ipc.handle("paseo:browser:live-release-control", (event, rawRequest: unknown) =>
    liveViews.releaseControl((event as { sender: LiveViewHostWebContents }).sender, rawRequest),
  );
  ipc.on(GUEST_CONTROL_REPLY_CHANNEL, (event, reply) => {
    humanControls.frames.receive(event, reply);
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
    return runAgentCommand({
      request: parsed.data,
      registry,
      snapshotEngine: hostSnapshotEngines.get(hostContents),
      controls: humanControls,
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

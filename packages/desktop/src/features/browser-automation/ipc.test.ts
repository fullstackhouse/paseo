import { describe, expect, test, vi } from "vitest";
import { executeAutomationCommand, type BrowserRegistry, type TabImage } from "./service.js";
import type { GuestControlReply, GuestControlRequest } from "./guest-frames.js";
import { BrowserHumanControls } from "./human-control.js";
import {
  adaptWebContents,
  BROWSER_LIVE_CONTROL_ENDED_EVENT,
  BROWSER_LIVE_ENDED_EVENT,
  BROWSER_LIVE_FRAME_EVENT,
  BrowserLiveViewStreams,
  HostSnapshotEngineRegistry,
  runAgentCommand,
} from "./ipc.js";
import type { IsolatedKeyboardInputEvent } from "./trusted-input.js";

class FakeImage implements TabImage {
  public toPNG(): Uint8Array {
    return new Uint8Array([137, 80, 78, 71]);
  }

  public getSize(): { width: number; height: number } {
    return { width: 640, height: 480 };
  }
}

class FakeDebugger {
  public attachedProtocolVersions: string[] = [];
  public commands: Array<{ command: string; params: Record<string, unknown>; sessionId?: string }> =
    [];
  public readonly responses = new Map<
    string,
    (params: Record<string, unknown>, sessionId?: string) => unknown
  >();
  public blockCommands = false;
  public readonly blockedCommandNames = new Set<string>();
  public readonly failedCommandNames = new Set<string>();
  public readonly failedCommandErrors = new Map<string, Error>();
  public readonly promptDialogs: unknown[] = [];
  public failPromptDrain = false;
  public beforeCommand: ((command: string) => void) | null = null;
  private readonly messageListeners = new Set<
    (event: unknown, method: string, params?: Record<string, unknown>, sessionId?: string) => void
  >();
  private readonly detachListeners = new Set<() => void>();
  private readonly blockedCommands: Array<() => void> = [];

  public isAttached(): boolean {
    return this.attachedProtocolVersions.length > 0;
  }

  public attach(protocolVersion?: string): void {
    this.attachedProtocolVersions.push(protocolVersion ?? "");
  }

  public async sendCommand(
    command: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    this.commands.push({ command, params: params ?? {}, ...(sessionId ? { sessionId } : {}) });
    this.beforeCommand?.(command);
    const commandError = this.failedCommandErrors.get(command);
    if (commandError) {
      throw commandError;
    }
    if (this.failedCommandNames.has(command)) {
      throw new Error(`${command} failed`);
    }
    if (this.blockCommands || this.blockedCommandNames.has(command)) {
      await new Promise<void>((resolve) => {
        this.blockedCommands.push(resolve);
      });
    }
    if (command === "Runtime.evaluate" && typeof params?.expression === "string") {
      if (params.expression.includes("state.prompts.splice(0)")) {
        if (this.failPromptDrain) {
          throw new Error("execution context destroyed");
        }
        return { result: { value: this.promptDialogs.splice(0) } };
      }
      return { result: { value: true } };
    }
    const response = this.responses.get(command);
    if (response) return response(params ?? {}, sessionId);
    if (command === "Page.getLayoutMetrics") {
      return { cssLayoutViewport: { clientWidth: 1024, clientHeight: 768 } };
    }
    return { ok: true };
  }

  public on(
    event: "message" | "detach",
    listener:
      | ((event: unknown, method: string, params?: Record<string, unknown>) => void)
      | (() => void),
  ): void {
    if (event === "detach") {
      this.detachListeners.add(listener as () => void);
      return;
    }
    this.messageListeners.add(
      listener as (event: unknown, method: string, params?: Record<string, unknown>) => void,
    );
  }

  public removeListener(
    event: "message" | "detach",
    listener:
      | ((event: unknown, method: string, params?: Record<string, unknown>) => void)
      | (() => void),
  ): void {
    if (event === "detach") {
      this.detachListeners.delete(listener as () => void);
      return;
    }
    this.messageListeners.delete(
      listener as (event: unknown, method: string, params?: Record<string, unknown>) => void,
    );
  }

  public get messageListenerCount(): number {
    return this.messageListeners.size;
  }

  public emitMessage(method: string, params?: Record<string, unknown>, sessionId?: string): void {
    if (this.messageListeners.size === 0) {
      throw new Error("Debugger message listener was not registered");
    }
    for (const listener of this.messageListeners) listener({}, method, params, sessionId);
  }

  public emitDetach(): void {
    this.attachedProtocolVersions.length = 0;
    for (const listener of this.detachListeners) listener();
  }

  public finishNextCommand(): void {
    const resolve = this.blockedCommands.shift();
    if (!resolve) {
      throw new Error("No command is blocked");
    }
    resolve();
  }
}

type ConsoleMessageListener = (
  event: unknown,
  level: unknown,
  message: unknown,
  line: unknown,
  sourceId: unknown,
) => void;

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

class FakeFrame {
  public url: string;
  public detached = false;
  public destroyed = false;
  public readonly children: FakeFrame[] = [];
  public readonly requests: GuestControlRequest[] = [];
  /** Null leaves the request unanswered, as a hung or crashed renderer does. */
  public answer: (request: WithoutId<GuestControlRequest>) => Omit<GuestControlReply, "id"> | null =
    (request) => {
      if (request.op === "describe") return { target: { targetId: "target-1", kind: "password" } };
      if (request.op === "insert") return { inserted: true };
      return { typed: true };
    };
  public reply: ((sender: FakeFrame, reply: GuestControlReply) => void) | null = null;

  public constructor(
    public origin: string,
    public processId: number,
    public routingId: number,
  ) {
    this.url = `${origin}/login`;
  }

  public get framesInSubtree(): FakeFrame[] {
    return [this, ...this.children.flatMap((child) => child.framesInSubtree)];
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public send(_channel: string, request: GuestControlRequest): void {
    if (this.destroyed) throw new Error("Render frame was disposed");
    this.requests.push(request);
    const answer = this.answer(request);
    if (answer) queueMicrotask(() => this.reply?.(this, { id: request.id, ...answer }));
  }
}

class FakeWebContents {
  public readonly mainFrame = new FakeFrame("https://app.example", 10, 1);
  public focusedFrame: FakeFrame | null = this.mainFrame;
  public zoomFactor = 1;
  public loadingMainFrame = false;
  public historyClears = 0;
  public readonly insertedTexts: string[] = [];
  public readonly navigationHistory = {
    clear: () => {
      this.historyClears += 1;
    },
  };
  public getZoomFactor(): number {
    return this.zoomFactor;
  }
  public isLoadingMainFrame(): boolean {
    return this.loadingMainFrame;
  }
  public backgroundThrottling = true;
  public getBackgroundThrottling(): boolean {
    return this.backgroundThrottling;
  }
  public setBackgroundThrottling(allowed: boolean): void {
    if (this.destroyed) throw new Error("Object has been destroyed");
    this.backgroundThrottling = allowed;
  }
  private readonly debuggerApi = new FakeDebugger();
  /** Electron's getter: usable during detach, throwing from "destroyed" on. */
  public get debugger(): FakeDebugger {
    if (this.debuggerDisposed) throw new TypeError("Object has been destroyed");
    return this.debuggerApi;
  }
  private debuggerDisposed = false;
  public readonly inputEvents: IsolatedKeyboardInputEvent[] = [];
  public readonly loadedUrls: string[] = [];
  public frameListener: ((image: TabImage) => void) | null = null;
  public endedFrameSubscriptions = 0;
  public readonly invalidations: string[] = [];
  private consoleMessageListener: ConsoleMessageListener | null = null;
  public readonly destroyedListeners = new Set<() => void>();
  public destroyed = false;

  public constructor(private readonly webContentsId: number) {}

  public get id(): number {
    if (this.destroyed) {
      throw new TypeError("Object has been destroyed");
    }
    return this.webContentsId;
  }

  public getURL(): string {
    return "https://example.com";
  }

  public getTitle(): string {
    return "Example";
  }

  public canGoBack(): boolean {
    return false;
  }

  public canGoForward(): boolean {
    return false;
  }

  public isLoading(): boolean {
    return false;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public async executeJavaScript(): Promise<unknown> {
    return null;
  }

  public async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
    if (this.failedUrls.has(url)) throw new Error("ERR_ABORTED");
    this.mainFrame.url = url;
    this.mainFrame.children.length = 0;
  }
  public readonly failedUrls = new Set<string>();

  public goBack(): void {}

  public goForward(): void {}

  public reload(): void {}

  public beginFrameSubscription(onlyDirty: boolean, callback: (image: TabImage) => void): void {
    expect(onlyDirty).toBe(false);
    this.frameListener = callback;
  }

  public endFrameSubscription(): void {
    this.frameListener = null;
    this.endedFrameSubscriptions += 1;
  }

  public invalidate(): void {
    this.invalidations.push("invalidate");
  }

  public sendInputEvent(event: IsolatedKeyboardInputEvent): void {
    this.inputEvents.push(event);
  }

  public async insertText(text: string): Promise<void> {
    this.insertedTexts.push(text);
  }

  public readonly unloadListeners = new Set<(event: { preventDefault(): void }) => void>();

  public on(
    event: "console-message" | "will-prevent-unload",
    listener: ConsoleMessageListener | ((event: { preventDefault(): void }) => void),
  ): void {
    if (event === "console-message")
      this.consoleMessageListener = listener as ConsoleMessageListener;
    else this.unloadListeners.add(listener as (event: { preventDefault(): void }) => void);
  }

  public once(event: "destroyed", listener: () => void): void {
    expect(event).toBe("destroyed");
    this.destroyedListeners.add(listener);
  }

  public removeListener(
    event: "destroyed" | "will-prevent-unload",
    listener: (event: { preventDefault(): void }) => void,
  ): void {
    if (event === "will-prevent-unload") this.unloadListeners.delete(listener);
    else this.destroyedListeners.delete(listener as () => void);
  }

  public emitConsoleMessage(input: {
    level: unknown;
    message: unknown;
    line: unknown;
    sourceId: unknown;
  }): void {
    if (!this.consoleMessageListener) {
      throw new Error("Console listener was not registered");
    }
    this.consoleMessageListener({}, input.level, input.message, input.line, input.sourceId);
  }

  public destroy(): void {
    this.destroyed = true;
    this.debuggerApi.emitDetach();
    this.debuggerDisposed = true;
    this.frameListener = null;
    for (const listener of this.destroyedListeners) {
      this.destroyedListeners.delete(listener);
      listener();
    }
  }
}

describe("browser automation IPC adapter", () => {
  test("isolates snapshot refs by host window and releases them on destruction", () => {
    const registry = new HostSnapshotEngineRegistry();
    const firstHost = new FakeHostWebContents(1);
    const secondHost = new FakeHostWebContents(2);

    const firstEngine = registry.get(firstHost);
    expect(registry.get(firstHost)).toBe(firstEngine);
    expect(registry.get(secondHost)).not.toBe(firstEngine);

    firstHost.destroy();
    expect(registry.get(new FakeHostWebContents(1))).not.toBe(firstEngine);
  });

  test("sends contained keyboard input directly to the guest", () => {
    const contents = new FakeWebContents(19);
    const tab = adaptWebContents(contents);

    tab.sendInputEvent({ type: "keyDown", keyCode: "Enter", skipIfUnhandled: true });

    expect(contents.inputEvents).toEqual([
      { type: "keyDown", keyCode: "Enter", skipIfUnhandled: true },
    ]);
  });

  test("captures one rendered frame and releases the subscription", async () => {
    const contents = new FakeWebContents(20);
    const tab = adaptWebContents(contents);
    const controller = new AbortController();
    const capture = tab.captureFrame(controller.signal);
    contents.frameListener?.(new FakeImage());

    expect((await capture).getSize()).toEqual({ width: 640, height: 480 });
    expect(contents.frameListener).toBeNull();
    controller.abort();
    expect(contents.endedFrameSubscriptions).toBe(1);
  });

  test("cancels a pending frame subscription when the capture budget expires", async () => {
    const contents = new FakeWebContents(2001);
    const tab = adaptWebContents(contents);
    const controller = new AbortController();
    const capture = tab.captureFrame(controller.signal);
    const failure = expect(capture).rejects.toThrow("capture deadline");
    controller.abort(new Error("capture deadline"));

    await failure;
    expect(contents.frameListener).toBeNull();
    expect(contents.endedFrameSubscriptions).toBe(1);
  });

  test("closing a guest settles its screenshot and releases the next queued capture", async () => {
    vi.useFakeTimers();
    try {
      const closing = new FakeWebContents(2002);
      const next = new FakeWebContents(2003);
      const tabs = new Map([
        ["closing", adaptWebContents(closing)],
        ["next", adaptWebContents(next)],
      ]);
      const registry: BrowserRegistry = {
        listRegisteredBrowserIds: () => [...tabs.keys()],
        listRegisteredBrowserIdsForWorkspace: () => [...tabs.keys()],
        getTabContents: (id) => tabs.get(id) ?? null,
        getBrowserWorkspaceId: () => null,
        getWorkspaceActiveBrowserId: () => null,
      };
      const capture = (browserId: string) =>
        executeAutomationCommand(
          {
            type: "browser.automation.execute.request",
            requestId: browserId,
            command: { command: "screenshot", args: { browserId, fullPage: false } },
          },
          registry,
        );
      let closedResult: unknown;
      const closedCapture = Promise.resolve(capture("closing")).then((result) => {
        closedResult = result;
        return result;
      });
      const nextCapture = capture("next");
      await vi.advanceTimersByTimeAsync(0);
      expect(closing.frameListener).not.toBeNull();
      closing.destroy();
      await vi.advanceTimersByTimeAsync(0);
      expect(closedResult).toEqual({
        requestId: "closing",
        ok: false,
        error: {
          code: "browser_tab_closed",
          message: "Browser tab closing has been closed",
          retryable: false,
        },
      });
      expect(closing.destroyedListeners.size).toBe(0);
      expect(next.frameListener).not.toBeNull();
      next.frameListener?.(new FakeImage());
      await expect(nextCapture).resolves.toMatchObject({ ok: true });
      await closedCapture;
      expect(next.destroyedListeners.size).toBe(1);
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  test("collects console messages until the guest is destroyed", () => {
    const contents = new FakeWebContents(21);
    const tab = adaptWebContents(contents);

    contents.emitConsoleMessage({
      level: "warning",
      message: "hello",
      line: 12,
      sourceId: "https://example.com/app.js",
    });

    expect(tab.getConsoleMessages?.()).toEqual([
      {
        level: "warning",
        message: "hello",
        line: 12,
        source: "https://example.com/app.js",
        timestamp: expect.any(Number),
      },
    ]);

    expect(() => contents.destroy()).not.toThrow();

    expect(tab.getConsoleMessages?.()).toEqual([]);
  });

  test("attaches the debugger before sending a CDP command", async () => {
    const contents = new FakeWebContents(22);
    const tab = adaptWebContents(contents);

    const result = await tab.sendDebugCommand?.("Page.captureScreenshot", {
      format: "png",
    });

    expect(result).toEqual({ ok: true });
    expect(contents.debugger.attachedProtocolVersions).toEqual(["1.3"]);
    expect(contents.debugger.commands).toEqual([
      { command: "Page.captureScreenshot", params: { format: "png" } },
    ]);
  });

  test("serializes CDP commands per guest contents", async () => {
    const contents = new FakeWebContents(23);
    contents.debugger.blockCommands = true;
    const tab = adaptWebContents(contents);

    const first = tab.sendDebugCommand?.("Input.dispatchMouseEvent", { type: "mouseMoved" });
    const second = tab.sendDebugCommand?.("Page.captureScreenshot", { format: "png" });
    await flushMicrotasks();

    expect(contents.debugger.commands).toEqual([
      { command: "Input.dispatchMouseEvent", params: { type: "mouseMoved" } },
    ]);

    contents.debugger.finishNextCommand();
    await flushMicrotasks();

    expect(contents.debugger.commands).toEqual([
      { command: "Input.dispatchMouseEvent", params: { type: "mouseMoved" } },
      { command: "Page.captureScreenshot", params: { format: "png" } },
    ]);

    contents.debugger.finishNextCommand();
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  test("handles JavaScript dialogs through the per-tab CDP queue", async () => {
    const contents = new FakeWebContents(24);
    const tab = adaptWebContents(contents);

    const captured = tab.captureDialogs?.(async () => {
      contents.debugger.blockCommands = true;
      const input = tab.sendDebugCommand?.("Input.dispatchMouseEvent", { type: "mouseReleased" });
      await flushMicrotasks();

      contents.debugger.emitMessage("Page.javascriptDialogOpening", {
        type: "confirm",
        message: "Delete item?",
      });
      await flushMicrotasks();

      expect(contents.debugger.commands).toEqual([
        { command: "Page.enable", params: {} },
        {
          command: "Runtime.evaluate",
          params: { expression: expect.any(String), returnByValue: true },
        },
        { command: "Input.dispatchMouseEvent", params: { type: "mouseReleased" } },
        { command: "Page.handleJavaScriptDialog", params: { accept: false } },
      ]);

      contents.debugger.blockCommands = false;
      contents.debugger.finishNextCommand();
      await input;
      await flushMicrotasks();
      return "done";
    });

    await expect(captured).resolves.toEqual({
      result: "done",
      dialogs: [
        {
          type: "confirm",
          message: "Delete item?",
          action: "dismissed",
          timestamp: expect.any(Number),
        },
      ],
    });
    expect(contents.debugger.commands).toEqual([
      { command: "Page.enable", params: {} },
      {
        command: "Runtime.evaluate",
        params: { expression: expect.any(String), returnByValue: true },
      },
      { command: "Input.dispatchMouseEvent", params: { type: "mouseReleased" } },
      { command: "Page.handleJavaScriptDialog", params: { accept: false } },
      {
        command: "Runtime.evaluate",
        params: { expression: expect.any(String), returnByValue: true },
      },
      {
        command: "Runtime.evaluate",
        params: { expression: expect.any(String), returnByValue: true },
      },
    ]);
  });

  test("handles JavaScript dialogs while the triggering CDP input command is still in flight", async () => {
    const contents = new FakeWebContents(25);
    const tab = adaptWebContents(contents);

    const captured = tab.captureDialogs?.(async () => {
      contents.debugger.blockedCommandNames.add("Input.dispatchMouseEvent");
      const input = tab.sendDebugCommand?.("Input.dispatchMouseEvent", { type: "mousePressed" });
      await flushMicrotasks();

      contents.debugger.emitMessage("Page.javascriptDialogOpening", {
        type: "alert",
        message: "Saved",
      });
      await flushMicrotasks();

      expect(contents.debugger.commands).toEqual([
        { command: "Page.enable", params: {} },
        {
          command: "Runtime.evaluate",
          params: { expression: expect.any(String), returnByValue: true },
        },
        { command: "Input.dispatchMouseEvent", params: { type: "mousePressed" } },
        { command: "Page.handleJavaScriptDialog", params: { accept: true } },
      ]);

      contents.debugger.blockedCommandNames.clear();
      contents.debugger.finishNextCommand();
      await input;
      return "done";
    });

    await expect(captured).resolves.toEqual({
      result: "done",
      dialogs: [
        {
          type: "alert",
          message: "Saved",
          action: "accepted",
          timestamp: expect.any(Number),
        },
      ],
    });
    expect(contents.debugger.commands.at(-1)).toEqual({
      command: "Runtime.evaluate",
      params: {
        expression: expect.stringContaining("delete window[stateKey]"),
        returnByValue: true,
      },
    });
  });

  test("keeps the prompt shim installed until overlapping captures finish", async () => {
    const contents = new FakeWebContents(26);
    const tab = adaptWebContents(contents);
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const finishFirst = deferred<void>();
    const finishSecond = deferred<void>();

    const first = tab.captureDialogs?.(async () => {
      firstStarted.resolve();
      await finishFirst.promise;
      return "first";
    });
    await firstStarted.promise;

    const second = tab.captureDialogs?.(async () => {
      secondStarted.resolve();
      await finishSecond.promise;
      return "second";
    });
    await secondStarted.promise;

    contents.debugger.promptDialogs.push(
      {
        type: "prompt",
        message: "First?",
        defaultValue: "one",
        action: "dismissed",
        timestamp: 1,
      },
      {
        type: "prompt",
        message: "Second?",
        defaultValue: "two",
        action: "dismissed",
        timestamp: 2,
      },
    );

    finishFirst.resolve();
    await expect(first).resolves.toEqual({
      result: "first",
      dialogs: [
        {
          type: "prompt",
          message: "First?",
          defaultValue: "one",
          action: "dismissed",
          timestamp: 1,
        },
        {
          type: "prompt",
          message: "Second?",
          defaultValue: "two",
          action: "dismissed",
          timestamp: 2,
        },
      ],
    });
    expect(
      contents.debugger.commands.some(
        (entry) =>
          entry.command === "Runtime.evaluate" &&
          typeof entry.params.expression === "string" &&
          entry.params.expression.includes("delete window[stateKey]"),
      ),
    ).toBe(false);

    finishSecond.resolve();
    await expect(second).resolves.toEqual({
      result: "second",
      dialogs: [
        {
          type: "prompt",
          message: "First?",
          defaultValue: "one",
          action: "dismissed",
          timestamp: 1,
        },
        {
          type: "prompt",
          message: "Second?",
          defaultValue: "two",
          action: "dismissed",
          timestamp: 2,
        },
      ],
    });
    expect(contents.debugger.commands.at(-1)).toEqual({
      command: "Runtime.evaluate",
      params: {
        expression: expect.stringContaining("delete window[stateKey]"),
        returnByValue: true,
      },
    });
  });

  test("leaves JavaScript dialogs alone when no capture is active", async () => {
    const contents = new FakeWebContents(28);
    const tab = adaptWebContents(contents);

    await expect(tab.captureDialogs?.(async () => "done")).resolves.toEqual({
      result: "done",
      dialogs: [],
    });
    contents.debugger.emitMessage("Page.javascriptDialogOpening", {
      type: "confirm",
      message: "Unsaved changes?",
    });
    await flushMicrotasks();

    expect(contents.debugger.commands).not.toContainEqual({
      command: "Page.handleJavaScriptDialog",
      params: { accept: false },
    });
  });

  test("treats prompt shim drain failures after navigation as no dialogs", async () => {
    const contents = new FakeWebContents(29);
    contents.debugger.failPromptDrain = true;
    const tab = adaptWebContents(contents);

    await expect(tab.captureDialogs?.(async () => "navigated")).resolves.toEqual({
      result: "navigated",
      dialogs: [],
    });

    expect(contents.debugger.commands).toEqual([
      { command: "Page.enable", params: {} },
      {
        command: "Runtime.evaluate",
        params: { expression: expect.any(String), returnByValue: true },
      },
      {
        command: "Runtime.evaluate",
        params: { expression: expect.any(String), returnByValue: true },
      },
      {
        command: "Runtime.evaluate",
        params: {
          expression: expect.stringContaining("delete window[stateKey]"),
          returnByValue: true,
        },
      },
    ]);
  });

  test("runs the command without dialog capture when CDP setup fails", async () => {
    const contents = new FakeWebContents(30);
    contents.debugger.failedCommandNames.add("Page.enable");
    const tab = adaptWebContents(contents);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(tab.captureDialogs?.(async () => "done")).resolves.toEqual({
      result: "done",
      dialogs: [],
    });

    expect(warn).toHaveBeenCalledWith(
      "[browser-automation] Dialog capture unavailable; running command without it",
      { contentsId: 30, error: expect.any(Error) },
    );
    warn.mockRestore();
  });

  test("does not run the command after the debugger target closes during setup", async () => {
    const contents = new FakeWebContents(31);
    contents.debugger.beforeCommand = (command) => {
      if (command === "Page.enable") {
        contents.destroy();
      }
    };
    contents.debugger.failedCommandErrors.set(
      "Page.enable",
      new Error("target closed while handling command"),
    );
    const tab = adaptWebContents(contents);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      tab.captureDialogs?.(() => tab.loadURL("https://replacement.example.com")),
    ).rejects.toThrow("target closed while handling command");
    expect(contents.loadedUrls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  test("runs without dialog capture after a live debugger session detaches", async () => {
    const contents = new FakeWebContents(32);
    const tab = adaptWebContents(contents);

    await expect(tab.captureDialogs?.(async () => "captured")).resolves.toEqual({
      result: "captured",
      dialogs: [],
    });
    contents.debugger.emitDetach();
    contents.debugger.failedCommandNames.add("Page.enable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      tab.captureDialogs?.(() => tab.loadURL("https://replacement.example.com")),
    ).resolves.toEqual({ result: undefined, dialogs: [] });
    expect(contents.loadedUrls).toEqual(["https://replacement.example.com"]);
    expect(contents.debugger.attachedProtocolVersions).toEqual(["1.3"]);
    expect(warn).toHaveBeenCalledWith(
      "[browser-automation] Dialog capture unavailable; running command without it",
      { contentsId: 32, error: expect.any(Error) },
    );

    warn.mockRestore();
  });
});

class FakeHostWebContents {
  private destroyedListener: (() => void) | null = null;

  public constructor(public readonly id: number) {}

  public once(event: "destroyed", listener: () => void): void {
    expect(event).toBe("destroyed");
    this.destroyedListener = listener;
  }

  public destroy(): void {
    this.destroyedListener?.();
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("pixel capture frame production", () => {
  test.each([true, false])(
    "restores the prior throttling policy (%s) after capture or failure",
    async (previous) => {
      const contents = new FakeWebContents(8001);
      contents.backgroundThrottling = previous;
      const tab = adaptWebContents(contents);
      expect(
        await tab.withFrameProduction(async () => {
          expect(contents.backgroundThrottling).toBe(false);
          return "pixels";
        }),
      ).toBe("pixels");
      expect(contents.backgroundThrottling).toBe(previous);
      await expect(
        tab.withFrameProduction(async () => {
          throw new Error("capture failed");
        }),
      ).rejects.toThrow("capture failed");
      expect(contents.backgroundThrottling).toBe(previous);
    },
  );

  test("does not touch a guest destroyed during capture", async () => {
    const contents = new FakeWebContents(8002);
    const tab = adaptWebContents(contents);
    await expect(
      tab.withFrameProduction(async () => {
        contents.destroyed = true;
        throw new Error("capture closed");
      }),
    ).rejects.toThrow("capture closed");
  });
});

class FakeLiveHostWindow {
  public readonly sent: Array<{ channel: string; payload: unknown }> = [];
  public backgroundThrottling = true;

  public getBackgroundThrottling(): boolean {
    return this.backgroundThrottling;
  }

  public setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottling = allowed;
  }
  private readonly destroyedListeners: Array<() => void> = [];
  public destroyed = false;

  public constructor(public readonly id: number) {}

  public once(event: "destroyed", listener: () => void): void {
    expect(event).toBe("destroyed");
    this.destroyedListeners.push(listener);
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  public destroy(): void {
    this.destroyed = true;
    for (const listener of this.destroyedListeners.splice(0)) listener();
  }
}

const LIVE_BROWSER_ID = "11111111-1111-4111-8111-111111111111";

function liveStartRequest(streamId = "stream-1") {
  return {
    type: "browser.host.live.start.request",
    requestId: `start-${streamId}`,
    streamId,
    browserId: LIVE_BROWSER_ID,
    maxFps: 5,
    jpegQuality: 50,
    maxWidth: 720,
  };
}

let nextLiveContentsId = 400;

function createLiveViews() {
  // ipc.ts keeps per-contents state by id; a fresh id keeps tests independent.
  const contents = new FakeWebContents(nextLiveContentsId++);
  const host = new FakeLiveHostWindow(1);
  const streams = new BrowserLiveViewStreams((browserId, hostId) =>
    browserId === LIVE_BROWSER_ID && hostId === host.id ? contents : null,
  );
  return { contents, host, streams };
}

function screencastFrame(contents: FakeWebContents, sessionId: number): void {
  contents.debugger.emitMessage("Page.screencastFrame", {
    sessionId,
    data: Buffer.from([0xff, 0xd8, sessionId, 0xff, 0xd9]).toString("base64"),
    metadata: {
      deviceWidth: 1024,
      deviceHeight: 768,
      offsetTop: 0,
      pageScaleFactor: 1,
      scrollOffsetX: 0,
      scrollOffsetY: 12,
    },
  });
}

function screencastAcks(contents: FakeWebContents): unknown[] {
  return contents.debugger.commands
    .filter((command) => command.command === "Page.screencastFrameAck")
    .map((command) => command.params.sessionId);
}

describe("browser live view screencast", () => {
  test("starts a CDP screencast on the tab and keeps a hidden tab painting until stop", async () => {
    const { contents, host, streams } = createLiveViews();

    await expect(streams.start(host, liveStartRequest())).resolves.toEqual({
      requestId: "start-stream-1",
      viewport: { width: 1024, height: 768 },
      error: null,
    });

    expect(contents.debugger.commands).toContainEqual({
      command: "Page.startScreencast",
      params: { format: "jpeg", quality: 50, maxWidth: 720, maxHeight: 1440, everyNthFrame: 1 },
    });
    expect(contents.invalidations).toEqual(["invalidate"]);
    expect(contents.backgroundThrottling).toBe(false);

    await expect(
      streams.stop({
        type: "browser.host.live.stop.request",
        requestId: "stop-1",
        streamId: "stream-1",
      }),
    ).resolves.toEqual({ requestId: "stop-1", error: null });
    await flushMicrotasks();
    expect(contents.debugger.commands.at(-1)?.command).toBe("Page.stopScreencast");
    expect(contents.backgroundThrottling).toBe(true);
    expect(streams.size).toBe(0);
  });

  test("forwards frames to the host window and acks CDP only after the viewer's ack", async () => {
    const { contents, host, streams } = createLiveViews();
    await streams.start(host, { ...liveStartRequest(), maxFps: 1000 });

    screencastFrame(contents, 7);
    expect(host.sent).toEqual([
      {
        channel: BROWSER_LIVE_FRAME_EVENT,
        payload: {
          streamId: "stream-1",
          frameSeq: 0,
          metadata: expect.objectContaining({ deviceWidth: 1024, scrollOffsetY: 12 }),
          jpeg: new Uint8Array([0xff, 0xd8, 7, 0xff, 0xd9]),
        },
      },
    ]);
    await flushMicrotasks();
    expect(screencastAcks(contents)).toEqual([]);

    streams.ack({ type: "browser.host.live.frame_ack", streamId: "stream-1", frameSeq: 1 });
    await flushMicrotasks();
    expect(screencastAcks(contents)).toEqual([]);

    streams.ack({ type: "browser.host.live.frame_ack", streamId: "stream-1", frameSeq: 0 });
    streams.ack({ type: "browser.host.live.frame_ack", streamId: "stream-1", frameSeq: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await flushMicrotasks();
    expect(screencastAcks(contents)).toEqual([7]);

    screencastFrame(contents, 8);
    expect(host.sent.at(-1)?.payload).toMatchObject({ frameSeq: 1 });
  });

  test("keeps the hosting window rendering while any of its streams runs", async () => {
    const { host, streams } = createLiveViews();
    await streams.start(host, liveStartRequest());
    expect(host.backgroundThrottling).toBe(false);

    await streams.stop({
      type: "browser.host.live.stop.request",
      requestId: "stop-1",
      streamId: "stream-1",
    });
    expect(host.backgroundThrottling).toBe(true);
  });

  test("forwards one frame at a time even though Chromium sends two ahead", async () => {
    vi.useFakeTimers();
    try {
      const { contents, host, streams } = createLiveViews();
      await streams.start(host, liveStartRequest());
      const forwarded = () =>
        host.sent.filter((event) => event.channel === BROWSER_LIVE_FRAME_EVENT).length;

      screencastFrame(contents, 1);
      screencastFrame(contents, 2);
      expect(forwarded()).toBe(1);

      streams.ack({ type: "browser.host.live.frame_ack", streamId: "stream-1", frameSeq: 0 });
      // A newer frame replaces the waiting one, also during the frame-rate delay.
      screencastFrame(contents, 3);
      expect(forwarded()).toBe(1);
      await vi.advanceTimersByTimeAsync(250);
      expect(screencastAcks(contents)).toEqual([1, 2]);

      // The newest frame still goes out. A page that stops painting, as one does once a sign-in
      // lands on a static page, never sends another.
      expect(forwarded()).toBe(2);
      expect(host.sent.at(-1)?.payload).toMatchObject({
        frameSeq: 1,
        jpeg: new Uint8Array([0xff, 0xd8, 3, 0xff, 0xd9]),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("restarts the screencast once after Chromium's buffer was full", async () => {
    vi.useFakeTimers();
    try {
      const { contents, host, streams } = createLiveViews();
      await streams.start(host, liveStartRequest());
      const starts = () =>
        contents.debugger.commands.filter(({ command }) => command === "Page.startScreencast");
      const ack = async (frameSeq: number) => {
        streams.ack({ type: "browser.host.live.frame_ack", streamId: "stream-1", frameSeq });
        await vi.advanceTimersByTimeAsync(250);
      };

      // With two frames unacked Chromium drops what it paints next, the final paint included, and
      // invalidate() doesn't bring it back. Only a new screencast starts with the current paint.
      screencastFrame(contents, 1);
      screencastFrame(contents, 2);
      await ack(0);
      expect(starts()).toHaveLength(1);
      await ack(1);
      expect(starts()).toHaveLength(2);
      expect(starts()[1]).toEqual(starts()[0]);

      // Its first frame arrives alone, so it asks for no other.
      screencastFrame(contents, 3);
      await ack(2);
      expect(starts()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("delays the CDP ack so frames arrive no faster than maxFps", async () => {
    vi.useFakeTimers();
    try {
      const { contents, host, streams } = createLiveViews();
      await streams.start(host, liveStartRequest());

      screencastFrame(contents, 3);
      streams.ack({ type: "browser.host.live.frame_ack", streamId: "stream-1", frameSeq: 0 });
      await vi.advanceTimersByTimeAsync(150);
      expect(screencastAcks(contents)).toEqual([]);
      await vi.advanceTimersByTimeAsync(60);
      expect(screencastAcks(contents)).toEqual([3]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("holds a frame subscription so a hidden tab keeps painting, and restores it after a screenshot", async () => {
    const { contents, host, streams } = createLiveViews();
    await streams.start(host, liveStartRequest());
    expect(contents.frameListener).not.toBeNull();

    const tab = adaptWebContents(contents);
    const capture = tab.captureFrame(new AbortController().signal);
    contents.frameListener?.(new FakeImage());
    await capture;
    expect(contents.frameListener).not.toBeNull();

    await streams.stop({
      type: "browser.host.live.stop.request",
      requestId: "stop-1",
      streamId: "stream-1",
    });
    expect(contents.frameListener).toBeNull();
  });

  test("ends the stream when the tab is destroyed and reports it to the host window", async () => {
    const { contents, host, streams } = createLiveViews();
    await streams.start(host, liveStartRequest());
    const tabDebugger = contents.debugger;
    expect(tabDebugger.messageListenerCount).toBeGreaterThan(0);

    contents.destroy();

    expect(streams.size).toBe(0);
    expect(tabDebugger.messageListenerCount).toBe(0);
    expect(host.sent.filter((event) => event.channel === BROWSER_LIVE_ENDED_EVENT)).toEqual([
      {
        channel: BROWSER_LIVE_ENDED_EVENT,
        payload: {
          streamId: "stream-1",
          error: expect.objectContaining({ code: "browser_tab_closed" }),
        },
      },
    ]);
  });

  test("reports a debugger detach as an ended stream, but not a requested stop", async () => {
    const { contents, host, streams } = createLiveViews();
    await streams.start(host, liveStartRequest());
    await streams.stop({
      type: "browser.host.live.stop.request",
      requestId: "stop-1",
      streamId: "stream-1",
    });
    expect(host.sent.some((event) => event.channel === BROWSER_LIVE_ENDED_EVENT)).toBe(false);

    await streams.start(host, liveStartRequest("stream-2"));
    contents.debugger.emitDetach();
    expect(host.sent.filter((event) => event.channel === BROWSER_LIVE_ENDED_EVENT)).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ streamId: "stream-2" }) }),
    ]);
    expect(streams.size).toBe(0);
  });

  test("keeps throttling off until both an overlapping screenshot and live view release it", async () => {
    const { contents, host, streams } = createLiveViews();
    const tab = adaptWebContents(contents);
    await streams.start(host, liveStartRequest());
    const screenshotDone = deferred<void>();
    const screenshot = tab.withFrameProduction(() => screenshotDone.promise);

    await streams.stop({
      type: "browser.host.live.stop.request",
      requestId: "stop-1",
      streamId: "stream-1",
    });
    expect(contents.backgroundThrottling).toBe(false);

    screenshotDone.resolve();
    await screenshot;
    expect(contents.backgroundThrottling).toBe(true);
  });

  test("a live view starting and stopping mid-capture does not cancel the capture", async () => {
    const { contents, host, streams } = createLiveViews();
    const tab = adaptWebContents(contents);
    const capture = tab.captureFrame(new AbortController().signal);

    await streams.start(host, liveStartRequest());
    await streams.stop({
      type: "browser.host.live.stop.request",
      requestId: "stop-1",
      streamId: "stream-1",
    });
    expect(contents.frameListener).not.toBeNull();

    const image = new FakeImage();
    contents.frameListener?.(image);
    await expect(capture).resolves.toBe(image);
    expect(contents.frameListener).toBeNull();
  });

  test("stops streams started from a host window when the window closes", async () => {
    const { contents, host, streams } = createLiveViews();
    await streams.start(host, liveStartRequest());

    host.destroy();
    await flushMicrotasks();

    expect(streams.size).toBe(0);
    expect(contents.debugger.commands.at(-1)?.command).toBe("Page.stopScreencast");
  });

  test("rejects unknown tabs and duplicate stream ids", async () => {
    const { host, streams } = createLiveViews();
    await expect(
      streams.start(host, {
        ...liveStartRequest(),
        browserId: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toMatchObject({ viewport: null, error: { code: "browser_tab_not_found" } });

    await streams.start(host, liveStartRequest());
    await expect(streams.start(host, liveStartRequest())).resolves.toMatchObject({
      error: { code: "browser_denied" },
    });
    // A second daemon asking for the same tab would share its one CDP screencast.
    await expect(streams.start(host, liveStartRequest("stream-2"))).resolves.toMatchObject({
      error: { code: "browser_denied" },
    });
    expect(streams.size).toBe(1);
  });
});

describe("browser live view human control", () => {
  const SENTINEL = "LV3-SENTINEL-desktop";

  async function watchedTab() {
    const contents = new FakeWebContents(nextLiveContentsId++);
    const host = new FakeLiveHostWindow(1);
    const controls = new BrowserHumanControls({
      settleMs: 0,
      replyTimeoutMs: 20,
      drainTimeoutMs: 20,
    });
    const streams = new BrowserLiveViewStreams(
      (browserId, hostId) =>
        browserId === LIVE_BROWSER_ID && hostId === host.id ? contents : null,
      controls,
    );
    const connect = (frame: FakeFrame) => {
      frame.reply = (sender, reply) =>
        controls.frames.receive({ processId: sender.processId, frameId: sender.routingId }, reply);
    };
    connect(contents.mainFrame);
    const addFrame = (origin: string, processId: number, parent = contents.mainFrame) => {
      const frame = new FakeFrame(
        origin,
        processId,
        20 + contents.mainFrame.framesInSubtree.length,
      );
      parent.children.push(frame);
      connect(frame);
      return frame;
    };
    await streams.start(host, liveStartRequest());

    const take = (controlId = "control-1") =>
      streams.takeControl(host, {
        type: "browser.host.live.take_control.request",
        requestId: "take",
        streamId: "stream-1",
        controlId,
      });
    const send = (input: object, controlId = "control-1") =>
      streams.sendInput(host, {
        type: "browser.host.live.send_input.request",
        requestId: "input",
        streamId: "stream-1",
        controlId,
        input,
      });
    const type = () => send({ kind: "insert_text", targetId: "target-1", text: SENTINEL });
    const release = (discardInput: boolean, controlId = "control-1") =>
      streams.releaseControl(host, {
        type: "browser.host.live.release_control.request",
        requestId: "release",
        controlId,
        discardInput,
      });
    return { contents, host, controls, streams, addFrame, take, send, type, release };
  }

  const silence = () => {};
  const inserts = (frame: FakeFrame) => frame.requests.filter((request) => request.op === "insert");

  test("watching leaves the tab to agents; taking control locks it", async () => {
    const { contents, controls, take } = await watchedTab();
    expect(controls.isHeld(contents.id)).toBe(false);

    await expect(take()).resolves.toEqual({
      requestId: "take",
      focus: {
        targetId: "target-1",
        kind: "password",
        origin: "https://app.example",
        topOrigin: "https://app.example",
      },
      error: null,
    });
    expect(controls.isHeld(contents.id)).toBe(true);
  });

  test("accepts input only after the agent's running command finished", async () => {
    const { contents, controls, take } = await watchedTab();
    let finish!: () => void;
    const command = controls.track(contents.id, () => new Promise<void>((done) => (finish = done)));
    let taken = false;
    const taking = take().then((result) => {
      taken = true;
      return result;
    });
    await flushMicrotasks();
    expect(controls.isHeld(contents.id)).toBe(true);
    expect(taken).toBe(false);

    finish();
    await command;
    await expect(taking).resolves.toMatchObject({ error: null });
  });

  test("gives up taking control when the agent's command doesn't finish", async () => {
    const { contents, controls, take } = await watchedTab();
    void controls.track(contents.id, () => new Promise<void>(() => {}));
    await expect(take()).resolves.toMatchObject({ error: { code: "agent_busy" } });
    expect(controls.isHeld(contents.id)).toBe(false);
  });

  test("one controller per tab", async () => {
    const { take, send } = await watchedTab();
    await take();
    await expect(take("control-2")).resolves.toMatchObject({ error: { code: "busy" } });
    await expect(send({ kind: "key", key: "Tab" }, "control-2")).resolves.toMatchObject({
      error: { code: "not_controller" },
    });
  });

  test("maps a tap from screen space to CSS pixels under page zoom", async () => {
    const { contents, take, send } = await watchedTab();
    await take();
    contents.zoomFactor = 2;
    await send({ kind: "tap", x: 100, y: 60 });
    expect(
      contents.debugger.commands.filter(({ params }) => params.type === "mousePressed"),
    ).toEqual([
      {
        command: "Input.dispatchMouseEvent",
        params: expect.objectContaining({ x: 50, y: 30 }),
      },
    ]);
  });

  test("delivers a tap over a cross-origin iframe to that frame's own session", async () => {
    const { contents, take, send } = await watchedTab();
    const cdp = contents.debugger;
    cdp.responses.set("Target.setAutoAttach", (params, sessionId) => {
      if (params.autoAttach && !sessionId) {
        cdp.emitMessage("Target.attachedToTarget", {
          sessionId: "iframe-session",
          targetInfo: { targetId: "iframe-frame" },
        });
      }
      return {};
    });
    cdp.responses.set("Page.getLayoutMetrics", (_params, sessionId) => ({
      cssLayoutViewport: { pageX: 0, pageY: sessionId ? 0 : 400 },
    }));
    cdp.responses.set("DOM.getNodeForLocation", (_params, sessionId) =>
      sessionId ? { backendNodeId: 9 } : { backendNodeId: 5 },
    );
    cdp.responses.set("DOM.describeNode", (_params, sessionId) =>
      sessionId ? { node: { nodeName: "INPUT" } } : { node: { frameId: "iframe-frame" } },
    );
    cdp.responses.set("DOM.getBoxModel", () => ({
      model: { content: [42, 368, 542, 368, 542, 468, 42, 468] },
    }));

    await take();
    await send({ kind: "tap", x: 92, y: 398 });

    // getNodeForLocation counts from the document, quads and input from the viewport.
    expect(cdp.commands).toContainEqual({
      command: "DOM.getNodeForLocation",
      params: { x: 92, y: 798 },
    });
    expect(cdp.commands.filter(({ params }) => params.type === "mousePressed")).toEqual([
      {
        command: "Input.dispatchMouseEvent",
        params: expect.objectContaining({ x: 50, y: 30 }),
        // The root session can't hit-test into a parked tab's out-of-process iframe.
        sessionId: "iframe-session",
      },
    ]);
  });

  test("releasing detaches from iframe targets", async () => {
    const { contents, take, release } = await watchedTab();
    await take();
    await release(false);
    await flushMicrotasks();
    expect(contents.debugger.commands.at(-1)).toMatchObject({
      command: "Target.setAutoAttach",
      params: { autoAttach: false },
    });
  });

  test("scrolls at the point the finger started", async () => {
    const { contents, take, send } = await watchedTab();
    await take();
    await send({ kind: "scroll", x: 10, y: 20, deltaX: 0, deltaY: 300 });
    expect(contents.debugger.commands).toContainEqual({
      command: "Input.dispatchMouseEvent",
      params: { type: "mouseWheel", x: 10, y: 20, deltaX: 0, deltaY: 300 },
    });
  });

  test("Enter carries the character that submits a form", async () => {
    const { contents, take, send } = await watchedTab();
    await take();
    await send({ kind: "key", key: "Enter" });
    expect(contents.inputEvents.map(({ type, keyCode }) => [type, keyCode])).toEqual([
      ["keyDown", "Enter"],
      ["char", "\r"],
      ["keyUp", "Enter"],
    ]);
  });

  test("types into a cross-origin iframe through that frame, never webContents.insertText", async () => {
    const { contents, addFrame, take, type } = await watchedTab();
    const outer = addFrame("https://idp.example", 30);
    const nested = addFrame("https://idp.example", 30, outer);
    const bystander = addFrame("https://ads.example", 40);
    contents.focusedFrame = nested;

    await expect(take()).resolves.toMatchObject({
      focus: { origin: "https://idp.example", topOrigin: "https://app.example" },
    });
    await expect(type()).resolves.toMatchObject({ error: null });

    expect(inserts(nested)).toEqual([expect.objectContaining({ text: SENTINEL })]);
    // webContents.insertText crashes the renderer with focus in an out-of-process iframe.
    expect(contents.insertedTexts).toEqual([]);
    expect(inserts(contents.mainFrame)).toEqual([]);
    expect(outer.requests).toEqual([]);
    expect(bystander.requests).toEqual([]);
  });

  test("keys don't reach another process's frame, so say so", async () => {
    const { contents, addFrame, take, send } = await watchedTab();
    contents.focusedFrame = addFrame("https://idp.example", 30);
    await take();
    await expect(send({ kind: "key", key: "Enter" })).resolves.toMatchObject({
      error: { code: "key_unsupported" },
    });
    expect(contents.inputEvents).toEqual([]);
  });

  test.each([
    "the frame navigated",
    "the tab navigated",
    "focus moved to another frame",
    "the frame is gone",
  ])("refuses text without sending it when %s", async (change) => {
    const { contents, addFrame, take, type } = await watchedTab();
    const shown = addFrame("https://idp.example", 30);
    const other = addFrame("https://idp.example", 30);
    contents.focusedFrame = shown;
    await take();

    if (change === "the frame navigated") shown.origin = "https://evil.example";
    if (change === "the tab navigated") contents.mainFrame.origin = "https://evil.example";
    if (change === "focus moved to another frame") contents.focusedFrame = other;
    if (change === "the frame is gone") shown.destroyed = true;

    await expect(type()).resolves.toMatchObject({ focus: null, error: { code: "target_changed" } });
    for (const frame of [shown, other, contents.mainFrame]) expect(inserts(frame)).toEqual([]);
  });

  test("refuses text for a field the user wasn't shown last", async () => {
    const { contents, take, send } = await watchedTab();
    await take();
    await expect(
      send({ kind: "insert_text", targetId: "an-older-target", text: SENTINEL }),
    ).resolves.toMatchObject({ error: { code: "target_changed" } });
    expect(inserts(contents.mainFrame)).toEqual([]);
  });

  test("reports a field the page switched while typing", async () => {
    const { contents, take, type } = await watchedTab();
    await take();
    contents.mainFrame.answer = () => ({ inserted: false });
    await expect(type()).resolves.toMatchObject({ error: { code: "target_changed" } });
  });

  test("an unanswered insert fails closed: lock kept, value not resent or logged", async () => {
    const logged = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(silence),
    );
    try {
      const { contents, controls, take, type } = await watchedTab();
      await take();
      contents.mainFrame.answer = () => null;

      const result = await type();

      expect(result).toMatchObject({ error: { code: "unconfirmed" } });
      expect(controls.isHeld(contents.id)).toBe(true);
      expect(inserts(contents.mainFrame)).toHaveLength(1);
      expect(inserts(contents.mainFrame)[0]).toMatchObject({ deadline: expect.any(Number) });
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(JSON.stringify(logged.map((spy) => spy.mock.calls))).not.toContain(SENTINEL);
      expect(JSON.stringify(contents.debugger.commands)).not.toContain(SENTINEL);
    } finally {
      for (const spy of logged) spy.mockRestore();
    }
  });

  test("only the frame that was asked can answer", async () => {
    const { contents, controls, take, type } = await watchedTab();
    await take();
    contents.mainFrame.answer = () => null;
    const typing = type();
    await flushMicrotasks();
    const [sent] = inserts(contents.mainFrame);
    controls.frames.receive({ processId: 99, frameId: 1 }, { id: sent!.id, inserted: true });
    await expect(typing).resolves.toMatchObject({ error: { code: "unconfirmed" } });
  });

  test("hand-back clears secrets in place and doesn't reload the page", async () => {
    const { contents, controls, take, type, release } = await watchedTab();
    await take();
    await type();

    await expect(release(false)).resolves.toEqual({ requestId: "release", error: null });

    expect(contents.mainFrame.requests).toContainEqual(
      expect.objectContaining({ op: "clear", scope: "secrets" }),
    );
    expect(contents.loadedUrls).toEqual([]);
    expect(contents.historyClears).toBe(1);
    expect(controls.isHeld(contents.id)).toBe(false);
  });

  test("a release the user didn't ask for discards the document before unlocking", async () => {
    const { contents, controls, take, type, release } = await watchedTab();
    await take();
    await type();
    const loadURL = contents.loadURL.bind(contents);
    const heldDuringLoad: boolean[] = [];
    contents.loadURL = (url) => {
      heldDuringLoad.push(controls.isHeld(contents.id));
      return loadURL(url);
    };

    await expect(release(true)).resolves.toEqual({ requestId: "release", error: null });

    expect(contents.mainFrame.requests).toContainEqual(
      expect.objectContaining({ op: "clear", scope: "all" }),
    );
    // A GET of the URL: a reload would submit the page's POST again.
    expect(contents.loadedUrls).toEqual(["about:blank", "https://app.example/login"]);
    expect(heldDuringLoad).toEqual([true, true]);
    // Back, forward and their saved form state go too.
    expect(contents.historyClears).toBe(2);
    expect(contents.unloadListeners.size).toBe(0);
    expect(controls.isHeld(contents.id)).toBe(false);
  });

  test("an auto-release leaves a page the user submitted or never typed into", async () => {
    const untouched = await watchedTab();
    await untouched.take();
    await untouched.release(true);
    expect(untouched.contents.loadedUrls).toEqual([]);

    const submitted = await watchedTab();
    await submitted.take();
    await submitted.type();
    submitted.contents.mainFrame.answer = () => ({ typed: false });
    await submitted.release(true);
    expect(submitted.contents.loadedUrls).toEqual([]);
    expect(submitted.contents.historyClears).toBe(1);
  });

  test("a frame that can't answer is discarded", async () => {
    const { contents, take, type, release } = await watchedTab();
    await take();
    await type();
    contents.mainFrame.answer = () => null;
    await expect(release(true)).resolves.toMatchObject({ error: null });
    expect(contents.loadedUrls[0]).toBe("about:blank");
  });

  test("keeps the lock when the document can't be discarded, and can retry", async () => {
    const { contents, controls, take, type, release } = await watchedTab();
    await take();
    await type();
    contents.failedUrls.add("about:blank");

    await expect(release(true)).resolves.toMatchObject({ error: { code: "failed" } });
    expect(controls.isHeld(contents.id)).toBe(true);

    contents.failedUrls.clear();
    await expect(release(true)).resolves.toMatchObject({ error: null });
    expect(controls.isHeld(contents.id)).toBe(false);
  });

  test("retries a failed discard by itself, as after losing the daemon", async () => {
    const { contents, controls, take, type, release } = await watchedTab();
    await take();
    await type();
    contents.failedUrls.add("about:blank");
    vi.useFakeTimers();
    try {
      await expect(release(true)).resolves.toMatchObject({ error: { code: "failed" } });
      contents.failedUrls.clear();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(controls.isHeld(contents.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("won't hand back while a secret can't be cleared", async () => {
    const { contents, controls, take, type, release } = await watchedTab();
    await take();
    await type();
    contents.mainFrame.answer = () => null;
    await expect(release(false)).resolves.toMatchObject({ error: { code: "failed" } });
    expect(controls.isHeld(contents.id)).toBe(true);
  });

  test("closing the tab ends control and tells the host", async () => {
    const { contents, host, controls, take } = await watchedTab();
    await take();
    const contentsId = contents.id;
    contents.destroy();
    expect(controls.isHeld(contentsId)).toBe(false);
    expect(host.sent).toContainEqual({
      channel: BROWSER_LIVE_CONTROL_ENDED_EVENT,
      payload: { controlId: "control-1" },
    });
  });

  test("the lock outlives the stream and only its controller can watch again", async () => {
    const { contents, host, controls, streams, take } = await watchedTab();
    await take();
    await streams.stop({
      type: "browser.host.live.stop.request",
      requestId: "stop",
      streamId: "stream-1",
    });
    expect(controls.isHeld(contents.id)).toBe(true);

    await expect(streams.start(host, liveStartRequest("stream-2"))).resolves.toMatchObject({
      error: { code: "browser_denied" },
    });
    await expect(
      streams.start(host, { ...liveStartRequest("stream-3"), controlId: "control-1" }),
    ).resolves.toMatchObject({ error: null });
  });

  test("dismisses page dialogs, which would block every further input", async () => {
    const { contents, take } = await watchedTab();
    await take();
    contents.debugger.emitMessage(
      "Page.javascriptDialogOpening",
      { type: "alert", message: "x" },
      "iframe-session",
    );
    await flushMicrotasks();
    expect(contents.debugger.commands.at(-1)).toMatchObject({
      command: "Page.handleJavaScriptDialog",
      sessionId: "iframe-session",
    });
  });

  test("frames carry the committed origin", async () => {
    const { contents, host } = await watchedTab();
    screencastFrame(contents, 3);
    expect(host.sent.at(-1)?.payload).toMatchObject({
      metadata: { origin: "https://app.example" },
    });
  });

  test("only tabs live view typed into drop out of the desktop log", async () => {
    const { contents, controls, take, send, type } = await watchedTab();
    await take();
    await send({ kind: "tap", x: 1, y: 1 });
    expect(controls.hasTypedInto(contents.id)).toBe(false);
    await type();
    expect(controls.hasTypedInto(contents.id)).toBe(true);
  });

  test("every agent command on a held tab is refused, list_tabs withholds its address", async () => {
    const { contents, host, controls, take, release } = await watchedTab();
    const run = (command: object) =>
      runAgentCommand({
        request: {
          type: "browser.automation.execute.request",
          requestId: "agent",
          command,
        } as never,
        registry: {
          listRegisteredBrowserIds: () => [LIVE_BROWSER_ID],
          listRegisteredBrowserIdsForWorkspace: () => [LIVE_BROWSER_ID],
          getTabContents: () => adaptWebContents(contents),
          getBrowserWorkspaceId: () => null,
          getWorkspaceActiveBrowserId: () => null,
        },
        snapshotEngine: new HostSnapshotEngineRegistry().get(new FakeHostWebContents(host.id)),
        controls,
      });
    await take();

    const browserId = LIVE_BROWSER_ID;
    for (const command of [
      { command: "snapshot", args: { browserId } },
      { command: "screenshot", args: { browserId, fullPage: false } },
      { command: "evaluate", args: { browserId, function: "() => 1" } },
      { command: "logs", args: { browserId, maxEntries: 5 } },
      { command: "navigate", args: { browserId, url: "https://example.com" } },
    ]) {
      await expect(run(command)).resolves.toMatchObject({
        ok: false,
        error: { code: "browser_denied", retryable: true },
      });
    }
    await expect(run({ command: "list_tabs", args: {} })).resolves.toMatchObject({
      result: { tabs: [{ browserId, url: "", title: "" }] },
    });

    await release(false);
    await expect(run({ command: "list_tabs", args: {} })).resolves.toMatchObject({
      result: { tabs: [{ url: "https://example.com" }] },
    });
  });
});

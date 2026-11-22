import { setTimeout as delay } from "node:timers/promises";
import type {
  BrowserLiveControlError,
  BrowserLiveControlErrorCode,
  BrowserLiveFocus,
  BrowserLiveFocusResult,
  BrowserLiveInput,
  BrowserLiveKey,
} from "@getpaseo/protocol/browser-automation/live-view";
import { CdpSessionQueue } from "./cdp-session-queue.js";
import { FrameSessions, type CdpMessageListener, type CdpSessionSender } from "./frame-sessions.js";
import { GuestFrames, type GuestFrame } from "./guest-frames.js";
import {
  dispatchTrustedClick,
  dispatchTrustedKey,
  dispatchTrustedScroll,
  type IsolatedKeyboardInputEvent,
} from "./trusted-input.js";

const SETTLE_MS = 150;
const REPLY_TIMEOUT_MS = 2_000;
// Below the daemon's timeout for take_control, which also covers the steps after the drain.
const DRAIN_TIMEOUT_MS = 10_000;
const CDP_TIMEOUT_MS = 3_000;
const LOAD_TIMEOUT_MS = 4_000;
const LOAD_POLL_MS = 100;
const DISCARD_RETRY_MS = 30_000;

const ERROR_MESSAGES = {
  not_controller: "This device doesn't control the tab.",
  busy: "The tab is already controlled.",
  agent_busy: "The agent's browser command is still running. Try again.",
  target_changed: "The page or field changed, so the text was refused.",
  key_unsupported: "Keys don't reach embedded frames from another site.",
  unconfirmed: "The desktop didn't confirm the input.",
  failed: "The browser tab didn't respond.",
} satisfies Partial<Record<BrowserLiveControlErrorCode, string>>;

export interface HumanControlFrame extends GuestFrame {
  readonly framesInSubtree: readonly GuestFrame[];
}

export interface HumanControlContents {
  readonly id: number;
  readonly mainFrame: HumanControlFrame;
  readonly focusedFrame: GuestFrame | null;
  readonly navigationHistory: { clear(): void };
  getURL(): string;
  getZoomFactor(): number;
  isDestroyed(): boolean;
  isLoadingMainFrame(): boolean;
  loadURL(url: string): Promise<void>;
  sendInputEvent(event: IsolatedKeyboardInputEvent): void;
  on(event: "will-prevent-unload", listener: (event: { preventDefault(): void }) => void): void;
  once(event: "destroyed", listener: () => void): void;
  removeListener(
    event: "will-prevent-unload",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  removeListener(event: "destroyed", listener: () => void): void;
}

export interface HumanControlTab {
  contents: HumanControlContents;
  send: CdpSessionSender;
  /** Runs outside the CDP queue: a dialog blocks the command in front of it. */
  answerDialog(accept: boolean, sessionId?: string): Promise<unknown>;
  onMessage(listener: CdpMessageListener): () => void;
}

interface Binding {
  targetId: string;
  frame: GuestFrame;
  origin: string;
  topOrigin: string;
}

interface Control {
  controlId: string;
  hostId: number;
  contentsId: number;
  tab: HumanControlTab;
  phase: "taking" | "held" | "releasing";
  queue: CdpSessionQueue;
  frameSessions: FrameSessions;
  binding: Binding | null;
  /** The frames this control typed into, by process and routing id. */
  typedFrames: Set<string>;
  retry: ReturnType<typeof setTimeout> | null;
  cleanup: Array<() => void>;
}

interface Timing {
  settleMs: number;
  replyTimeoutMs: number;
  drainTimeoutMs: number;
}

/**
 * The human's lock on browser tabs in this desktop. It is enforced here as well as in the daemon,
 * because only Electron main knows when an agent command really finished, and because every
 * daemon connected to this desktop reaches the tab through it.
 *
 * Inputs can be secrets. Nothing in here logs, and no error carries an input or a page string.
 */
export class BrowserHumanControls {
  public readonly frames = new GuestFrames();
  private readonly byControlId = new Map<string, Control>();
  private readonly byContentsId = new Map<number, Control>();
  private readonly runningByContentsId = new Map<number, Set<Promise<unknown>>>();
  private readonly typedInto = new Set<number>();
  private readonly timing: Timing;

  public constructor(timing: Partial<Timing> = {}) {
    this.timing = {
      settleMs: SETTLE_MS,
      replyTimeoutMs: REPLY_TIMEOUT_MS,
      drainTimeoutMs: DRAIN_TIMEOUT_MS,
      ...timing,
    };
  }

  public isHeld(contentsId: number): boolean {
    return this.byContentsId.has(contentsId);
  }

  public isHeldByOther(contentsId: number, controlId: string | undefined): boolean {
    const control = this.byContentsId.get(contentsId);
    return control !== undefined && control.controlId !== controlId;
  }

  /** The page may log what was typed, so this tab's console stays out of the desktop's log file. */
  public hasTypedInto(contentsId: number): boolean {
    return this.typedInto.has(contentsId);
  }

  /** Registers an agent command in the same tick as its lock check, for take() to wait on. */
  public async track<T>(contentsId: number, run: () => T | Promise<T>): Promise<T> {
    const running = this.runningByContentsId.get(contentsId) ?? new Set<Promise<unknown>>();
    const result = Promise.resolve(run());
    running.add(result);
    this.runningByContentsId.set(contentsId, running);
    try {
      return await result;
    } finally {
      running.delete(result);
      if (running.size === 0) this.runningByContentsId.delete(contentsId);
    }
  }

  public async take(input: {
    controlId: string;
    hostId: number;
    tab: HumanControlTab;
    onEnded: () => void;
  }): Promise<BrowserLiveFocusResult> {
    const { controlId, hostId, tab, onEnded } = input;
    const contentsId = tab.contents.id;
    if (this.byContentsId.has(contentsId) || this.byControlId.has(controlId)) return refuse("busy");

    const control: Control = {
      controlId,
      hostId,
      contentsId,
      tab,
      phase: "taking",
      queue: new CdpSessionQueue(),
      frameSessions: new FrameSessions(tab.send, (listener) => tab.onMessage(listener)),
      binding: null,
      typedFrames: new Set(),
      retry: null,
      cleanup: [],
    };
    control.cleanup.push(() => control.frameSessions.dispose());
    // Locked from here on, so no new agent command starts while the running ones finish.
    this.byContentsId.set(contentsId, control);
    this.byControlId.set(controlId, control);
    const destroyed = () => {
      this.forget(control);
      onEnded();
    };
    tab.contents.once("destroyed", destroyed);
    control.cleanup.push(() => tab.contents.removeListener("destroyed", destroyed));

    return control.queue.run(async () => {
      const running = [...(this.runningByContentsId.get(contentsId) ?? [])];
      const drained = await within(Promise.allSettled(running), this.timing.drainTimeoutMs);
      if (control.phase !== "taking" || !this.isCurrent(control)) return refuse("failed");
      if (!drained) {
        this.forget(control);
        return refuse("agent_busy");
      }
      const enabled = await within(
        tab.send("Page.enable").then(() => control.frameSessions.attach()),
        CDP_TIMEOUT_MS,
      );
      if (control.phase !== "taking" || !this.isCurrent(control)) return refuse("failed");
      if (!enabled) {
        this.forget(control);
        return refuse("failed");
      }
      control.cleanup.push(
        tab.onMessage((method, params, sessionId) => {
          if (method !== "Page.javascriptDialogOpening") return;
          const accept = params.type === "alert" || params.type === "beforeunload";
          void tab.answerDialog(accept, sessionId).catch(() => {});
        }),
      );
      control.phase = "held";
      return { focus: await this.describeFocus(control), error: null };
    });
  }

  public async input(request: {
    controlId: string;
    hostId: number;
    /** The tab of the stream the input came on. */
    contentsId: number;
    input: BrowserLiveInput;
  }): Promise<BrowserLiveFocusResult> {
    const { controlId, hostId, contentsId, input } = request;
    const control = this.byControlId.get(controlId);
    if (!control || control.hostId !== hostId || control.contentsId !== contentsId) {
      return refuse("not_controller");
    }
    return control.queue.run(async () => {
      if (control.phase !== "held" || !this.isCurrent(control)) return refuse("not_controller");
      try {
        const code = await this.dispatch(control, input);
        if (code) return refuse(code);
        await delay(this.timing.settleMs);
        return { focus: await this.describeFocus(control), error: null };
      } catch {
        // The renderer or its debugger session went away. The caught error isn't passed on.
        return refuse(input.kind === "insert_text" ? "unconfirmed" : "failed");
      }
    });
  }

  /** On failure the lock stays: a release never exposes what it couldn't clear. */
  public async release(request: {
    controlId: string;
    hostId: number;
    discardInput: boolean;
  }): Promise<BrowserLiveControlError | null> {
    const { controlId, hostId, discardInput } = request;
    const control = this.byControlId.get(controlId);
    if (!control) return null;
    if (control.hostId !== hostId) return controlError("not_controller");
    control.phase = "releasing";
    return control.queue.run(async () => {
      if (!this.isCurrent(control)) return null;
      const released = await (
        discardInput ? this.discardTypedDocuments(control) : this.clearSecrets(control)
      ).catch(() => false);
      if (!this.isCurrent(control)) return null;
      if (released) {
        this.forget(control);
        return null;
      }
      if (discardInput) this.retryDiscard(control);
      else if (!control.retry) control.phase = "held";
      return controlError("failed");
    });
  }

  private async dispatch(
    control: Control,
    input: BrowserLiveInput,
  ): Promise<keyof typeof ERROR_MESSAGES | null> {
    const { contents } = control.tab;
    switch (input.kind) {
      case "insert_text":
        return this.insertText(control, input);
      case "key":
        return pressKey(contents, input.key);
      case "tap": {
        const clicked = control.frameSessions
          .route(toCssPoint(contents, input))
          .then(({ send, point }) => dispatchTrustedClick(send, point));
        return (await within(clicked, CDP_TIMEOUT_MS)) ? null : "failed";
      }
      case "scroll": {
        const zoom = contents.getZoomFactor();
        const scrolled = await within(
          control.frameSessions
            .route(toCssPoint(contents, input))
            .then(({ send, point }) =>
              dispatchTrustedScroll(send, point, input.deltaX / zoom, input.deltaY / zoom),
            ),
          CDP_TIMEOUT_MS,
        );
        return scrolled ? null : "failed";
      }
    }
  }

  private async insertText(
    control: Control,
    input: Extract<BrowserLiveInput, { kind: "insert_text" }>,
  ): Promise<keyof typeof ERROR_MESSAGES | null> {
    const { binding } = control;
    control.binding = null;
    if (!binding || binding.targetId !== input.targetId) return "target_changed";
    const { contents } = control.tab;
    const { frame, origin, topOrigin } = binding;
    if (readOrigin(frame) !== origin || readOrigin(contents.mainFrame) !== topOrigin) {
      return "target_changed";
    }
    if (!contents.focusedFrame || frameKey(contents.focusedFrame) !== frameKey(frame)) {
      return "target_changed";
    }
    // Recorded first: the text may land even if the answer never comes.
    control.typedFrames.add(frameKey(frame));
    this.markTypedInto(control);
    const { replyTimeoutMs } = this.timing;
    const reply = await this.frames.ask(
      frame,
      {
        op: "insert",
        targetId: binding.targetId,
        text: input.text,
        // A request that arrives after the user was told it failed must not type.
        deadline: Date.now() + replyTimeoutMs,
      },
      replyTimeoutMs,
    );
    if (!reply) return "unconfirmed";
    return reply.inserted === true ? null : "target_changed";
  }

  private async describeFocus(control: Control): Promise<BrowserLiveFocus | null> {
    control.binding = null;
    const { contents } = control.tab;
    if (contents.isDestroyed()) return null;
    const frame = contents.focusedFrame;
    if (!frame) return null;
    const origin = readOrigin(frame);
    const topOrigin = readOrigin(contents.mainFrame);
    if (origin === null || topOrigin === null) return null;
    const reply = await this.frames.ask(frame, { op: "describe" }, this.timing.replyTimeoutMs);
    if (!reply?.target || contents.isDestroyed()) return null;
    // A navigation committed while asking.
    if (readOrigin(frame) !== origin || readOrigin(contents.mainFrame) !== topOrigin) return null;
    const { targetId, kind } = reply.target;
    control.binding = { targetId, frame, origin, topOrigin };
    return { targetId, kind, origin, topOrigin };
  }

  private async clearSecrets(control: Control): Promise<boolean> {
    if (control.typedFrames.size === 0) return true;
    const replies = await this.askTypedFrames(control, "secrets");
    if (!replies || replies.includes(null)) return false;
    // Back and forward would restore the form state of the pages the user submitted.
    control.tab.contents.navigationHistory.clear();
    return true;
  }

  /**
   * Clearing a field isn't enough when the user didn't choose to release: undo, framework state
   * and script variables keep copies. A new document has none of them.
   */
  private async discardTypedDocuments(control: Control): Promise<boolean> {
    if (control.typedFrames.size === 0) return true;
    const { contents } = control.tab;
    // A submit that is under way takes the document with it.
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    while (contents.isLoadingMainFrame() && Date.now() < deadline) await delay(LOAD_POLL_MS);

    const replies = await this.askTypedFrames(control, "all");
    const typedDocumentIsOpen = !replies || replies.some((reply) => reply?.typed !== false);
    if (!typedDocumentIsOpen) {
      contents.navigationHistory.clear();
      return true;
    }
    const url = contents.mainFrame.isDestroyed() ? contents.getURL() : contents.mainFrame.url;
    const allowUnload = (event: { preventDefault(): void }) => event.preventDefault();
    contents.on("will-prevent-unload", allowUnload);
    try {
      await within(contents.loadURL("about:blank"), LOAD_TIMEOUT_MS);
      if (contents.mainFrame.url !== "about:blank") return false;
      control.typedFrames.clear();
      contents.navigationHistory.clear();
      if (/^https?:/i.test(url)) {
        // Never reload(): on the result of a POST that submits the form again.
        await within(contents.loadURL(url), LOAD_TIMEOUT_MS);
        contents.navigationHistory.clear();
      }
      return true;
    } finally {
      contents.removeListener("will-prevent-unload", allowUnload);
    }
  }

  /** Null when the tab's frames can't be listed, as after a renderer crash. */
  private async askTypedFrames(control: Control, scope: "all" | "secrets") {
    const { mainFrame } = control.tab.contents;
    if (mainFrame.isDestroyed()) return null;
    const open = mainFrame.framesInSubtree.filter(
      (frame) => !frame.isDestroyed() && control.typedFrames.has(frameKey(frame)),
    );
    return Promise.all(
      open.map((frame) =>
        this.frames.ask(frame, { op: "clear", scope }, this.timing.replyTimeoutMs),
      ),
    );
  }

  // A daemon retries too, but after a reset no daemon knows about this control.
  private retryDiscard(control: Control): void {
    if (control.retry) return;
    control.retry = setTimeout(() => {
      control.retry = null;
      const { controlId, hostId } = control;
      void this.release({ controlId, hostId, discardInput: true });
    }, DISCARD_RETRY_MS);
    control.retry.unref?.();
  }

  private markTypedInto(control: Control): void {
    const { contentsId, tab } = control;
    if (this.typedInto.has(contentsId)) return;
    this.typedInto.add(contentsId);
    tab.contents.once("destroyed", () => this.typedInto.delete(contentsId));
  }

  private isCurrent(control: Control): boolean {
    return this.byControlId.get(control.controlId) === control;
  }

  private forget(control: Control): void {
    if (!this.isCurrent(control)) return;
    this.byControlId.delete(control.controlId);
    this.byContentsId.delete(control.contentsId);
    if (control.retry) clearTimeout(control.retry);
    for (const cleanup of control.cleanup.splice(0)) cleanup();
  }
}

function pressKey(
  contents: HumanControlContents,
  key: BrowserLiveKey,
): keyof typeof ERROR_MESSAGES | null {
  const frame = contents.focusedFrame;
  // sendInputEvent reaches only the main frame's process.
  if (frame && frame.processId !== contents.mainFrame.processId) return "key_unsupported";
  const send = (event: IsolatedKeyboardInputEvent) => contents.sendInputEvent(event);
  if (key !== "Enter") {
    dispatchTrustedKey(send, key);
    return null;
  }
  // Forms submit on the keypress, which needs the character event.
  send({ type: "keyDown", keyCode: key, skipIfUnhandled: true });
  send({ type: "char", keyCode: "\r", skipIfUnhandled: true });
  send({ type: "keyUp", keyCode: key, skipIfUnhandled: true });
  return null;
}

// Screencast metadata counts device-independent pixels; CDP input wants CSS pixels.
function toCssPoint(contents: HumanControlContents, point: { x: number; y: number }) {
  const zoom = contents.getZoomFactor();
  return { x: point.x / zoom, y: point.y / zoom };
}

function readOrigin(frame: GuestFrame): string | null {
  return frame.isDestroyed() || frame.detached ? null : frame.origin;
}

function frameKey(frame: GuestFrame): string {
  return `${frame.processId}:${frame.routingId}`;
}

function refuse(code: keyof typeof ERROR_MESSAGES): BrowserLiveFocusResult {
  return { focus: null, error: controlError(code) };
}

function controlError(code: keyof typeof ERROR_MESSAGES): BrowserLiveControlError {
  return { code, message: ERROR_MESSAGES[code] };
}

/** False when the work failed or didn't finish in time. */
async function within(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  const succeeded = work.then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([succeeded, expired]);
  } finally {
    clearTimeout(timeout);
  }
}

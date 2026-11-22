import { setTimeout as delay } from "node:timers/promises";
import type {
  BrowserLiveControlError,
  BrowserLiveControlErrorCode,
  BrowserLiveFocus,
  BrowserLiveFocusResult,
  BrowserLiveInput,
  BrowserLiveKey,
  BrowserLiveTakeResult,
} from "@getpaseo/protocol/browser-automation/live-view";
import { AgentCommand } from "./agent-commands.js";
import { CdpSessionQueue, type CdpCommandSender } from "./cdp-session-queue.js";
import { ownDiscardUnload } from "./discard-unload.js";
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
const CANCEL_GRACE_MS = 500;
const ANSWER_TIMEOUT_MS = 1_000;
const CDP_TIMEOUT_MS = 3_000;
// Below the daemon's timeout for an input, with the settling and focus read after it.
const INPUT_DEADLINE_MS = 5_000;
const DISCARD_URL = "about:blank";
// A page that keeps starting navigations can use up the beforeunload of a few.
const DISCARD_ATTEMPTS = 8;
const DISCARD_ATTEMPT_GAP_MS = 50;
const LOAD_TIMEOUT_MS = 4_000;
const LOAD_POLL_MS = 100;
const DISCARD_RETRY_MS = 30_000;

const ERROR_MESSAGES = {
  not_controller: "This device doesn't control the tab.",
  busy: "The tab is already controlled.",
  agent_busy: "The agent's browser command couldn't be stopped. Try again.",
  target_changed: "The page or field changed, so the text was refused.",
  page_changed: "The page changed, so the tap or scroll was refused.",
  does_not_fit: "The text doesn't fit the field, so it was refused.",
  key_unsupported: "Keys don't reach embedded frames from another site.",
  unconfirmed: "The input may have been sent. Check the page before sending it again.",
  not_sent: "The input wasn't sent.",
  page_blocked: "The page doesn't respond. Answer any dialog on the desktop.",
  unload_blocked: "The page refuses the reload that stopping the agent's script needs.",
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
  stop(): void;
  sendInputEvent(event: IsolatedKeyboardInputEvent): void;
  on(event: "will-prevent-unload", listener: (event: { preventDefault(): void }) => void): void;
  once(event: "destroyed" | "did-navigate", listener: () => void): void;
  removeListener(
    event: "will-prevent-unload",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  removeListener(event: "destroyed", listener: () => void): void;
}

export interface HumanControlTab {
  contents: HumanControlContents;
  send: CdpSessionSender;
  /**
   * Dismisses the open dialog; there's no accepting. Runs outside the CDP queue, because a dialog
   * blocks the command in front of it.
   */
  dismissDialog(sessionId?: string): Promise<unknown>;
  /** Ends the script that is running. Outside the CDP queue, which that script can hold up. */
  interrupt(): Promise<unknown>;
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

type ShowsDocument = (documentId: string) => boolean;

type ControlCode = keyof typeof ERROR_MESSAGES;

interface Timing {
  settleMs: number;
  cdpTimeoutMs: number;
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
  /** A cancelled command stays until what it started in the page is known to have ended. */
  private readonly runningByContentsId = new Map<number, Map<AgentCommand, Promise<unknown>>>();
  private readonly typedInto = new Set<number>();
  private readonly timing: Timing;

  public constructor(timing: Partial<Timing> = {}) {
    this.timing = {
      settleMs: SETTLE_MS,
      cdpTimeoutMs: CDP_TIMEOUT_MS,
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
  public async track<T>(
    contentsId: number,
    work: (command: AgentCommand) => T | Promise<T>,
  ): Promise<T> {
    const command = new AgentCommand();
    const result = command.run(work);
    const running =
      this.runningByContentsId.get(contentsId) ?? new Map<AgentCommand, Promise<unknown>>();
    running.set(command, result);
    this.runningByContentsId.set(contentsId, running);
    try {
      return await result;
    } finally {
      if (!command.cancelled) this.untrack(contentsId, command);
    }
  }

  public async take(input: {
    controlId: string;
    hostId: number;
    tab: HumanControlTab;
    onEnded: () => void;
  }): Promise<BrowserLiveTakeResult> {
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
      this.runningByContentsId.delete(contentsId);
      onEnded();
    };
    tab.contents.once("destroyed", destroyed);
    // Ahead of frameSessions.dispose(), so releasing ends on the iframes' detach as before.
    control.cleanup.unshift(() => {
      void tab.send("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
    });
    control.cleanup.push(() => tab.contents.removeListener("destroyed", destroyed));
    // Before anything is awaited: a dialog blocks the drain, Page.enable and auto-attach.
    control.cleanup.push(
      tab.onMessage((method, params, sessionId) => {
        // Electron answers beforeunload itself, by keeping the page.
        if (method !== "Page.javascriptDialogOpening" || params.type === "beforeunload") return;
        // A turn later: CDP reports the dialog before Electron opens the box that has to be closed.
        setImmediate(() => {
          if (this.isCurrent(control)) void tab.dismissDialog(sessionId).catch(() => {});
        });
      }),
    );

    return control.queue.run(async () => {
      await within(tab.dismissDialog(), ANSWER_TIMEOUT_MS);
      const { code, reloaded } = await this.prepare(control);
      // A release that came meanwhile is queued behind this and unlocks.
      if (!this.isTaking(control)) return refuse("failed");
      if (code) {
        this.forget(control);
        return refuse(code);
      }
      control.phase = "held";
      const focus = await this.describeFocus(control);
      return { focus, error: null, ...(reloaded ? { reloaded } : {}) };
    });
  }

  /**
   * Waits a while for the agent's running commands, then cancels them. A script one of them left
   * in the page could still read or act, and only a new document is sure to end it.
   */
  private async prepare(
    control: Control,
  ): Promise<{ code: ControlCode | null; reloaded: boolean }> {
    const { contentsId, tab } = control;
    const running = [...(this.runningByContentsId.get(contentsId) ?? [])];
    const results = running.map(([, result]) => result);
    const commands = running.map(([command]) => command);
    if (!(await within(Promise.allSettled(results), this.timing.drainTimeoutMs))) {
      for (const command of commands) command.cancel();
    }
    if (!this.isTaking(control)) return { code: "failed", reloaded: false };

    const cancelled = commands.filter((command) => command.cancelled);
    let reloaded = false;
    if (cancelled.length > 0) {
      if (cancelled.some((command) => command.isPending("loadURL"))) tab.contents.stop();
      await within(Promise.all(cancelled.map((command) => command.settled())), CANCEL_GRACE_MS);
      if (!this.isTaking(control)) return { code: "failed", reloaded };
      if (cancelled.some((command) => command.isPending("executeJavaScript"))) {
        const code = await this.endScripts(control);
        if (code) {
          // Their scripts end with the document, and Electron restores none from a back/forward
          // cache, so a later take needn't reload the page the user went on to.
          tab.contents.once("did-navigate", () => {
            for (const command of cancelled) this.untrack(contentsId, command);
          });
          return { code, reloaded };
        }
        reloaded = true;
      }
    }

    if (!(await within(this.attach(control), this.timing.cdpTimeoutMs))) {
      return { code: "page_blocked", reloaded };
    }
    for (const command of cancelled) this.untrack(contentsId, command);
    return { code: null, reloaded };
  }

  /** Can outlive its timeout, so it turns nothing on for a control that is gone by then. */
  private async attach(control: Control): Promise<void> {
    await control.tab.send("Page.enable");
    if (!this.isTaking(control)) return;
    // A press moves the host window's focus to the webview, which then focuses the guest's
    // main frame: in a tab without focus that blurred the iframe field just pressed.
    await control.tab.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    if (!this.isTaking(control)) return;
    await control.frameSessions.attach();
  }

  /** Never past beforeunload: nobody agreed to lose the page's state for this. */
  private async endScripts(control: Control): Promise<ControlCode | null> {
    // A loop would keep the navigation from committing.
    await within(control.tab.interrupt(), ANSWER_TIMEOUT_MS);
    if (!this.isTaking(control)) return "failed";
    let guarded = false;
    if (await this.replaceDocument(control, () => (guarded = true))) return null;
    return guarded ? "unload_blocked" : "agent_busy";
  }

  public async input(request: {
    controlId: string;
    hostId: number;
    /** The tab of the stream the input came on. */
    contentsId: number;
    input: BrowserLiveInput;
    /** Whether a frame of this document is what the tab still shows. */
    showsDocument: ShowsDocument;
  }): Promise<BrowserLiveFocusResult> {
    const { controlId, hostId, contentsId, input, showsDocument } = request;
    const deadline = Date.now() + INPUT_DEADLINE_MS;
    const control = this.byControlId.get(controlId);
    if (!control || control.hostId !== hostId || control.contentsId !== contentsId) {
      return refuse("not_controller");
    }
    return control.queue.run(async () => {
      if (control.phase !== "held" || !this.isCurrent(control)) return refuse("not_controller");
      const mayDispatch = () =>
        control.phase === "held" && this.isCurrent(control) && Date.now() < deadline;
      if (!mayDispatch()) return refuse("not_sent");
      try {
        const code =
          input.kind === "insert_text"
            ? await this.insertText(control, input, deadline)
            : await this.dispatch(control, input, showsDocument, mayDispatch);
        if (code) return refuse(code);
        await delay(this.timing.settleMs);
        return { focus: await this.describeFocus(control), error: null };
      } catch {
        // The renderer or its debugger session went away. The caught error isn't passed on.
        return refuse("unconfirmed");
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
    input: Exclude<BrowserLiveInput, { kind: "insert_text" }>,
    showsDocument: ShowsDocument,
    mayDispatch: () => boolean,
  ): Promise<ControlCode | null> {
    const { contents } = control.tab;
    if (input.kind === "key") return pressKey(contents, input.key);

    const isShown = () => showsDocument(input.documentId);
    if (!isShown()) return "page_changed";
    let reported = false;
    let maybeSent = false;
    // Asked as each event's turn in the CDP queue comes, not when it was queued.
    const maySend = (acts: boolean) => () => {
      if (reported || !mayDispatch() || !isShown()) return false;
      maybeSent ||= acts;
      return true;
    };
    const zoom = contents.getZoomFactor();
    const dispatched = control.frameSessions
      .route(toCssPoint(contents, input))
      .then(({ sessionId, point }) => {
        const send: CdpCommandSender = (command, params) => {
          const acts = params?.type === "mousePressed" || params?.type === "mouseWheel";
          return control.tab.send(command, params, sessionId, maySend(acts));
        };
        return input.kind === "tap"
          ? dispatchTrustedClick(send, point)
          : dispatchTrustedScroll(send, point, input.deltaX / zoom, input.deltaY / zoom);
      });
    const done = await within(dispatched, this.timing.cdpTimeoutMs);
    reported = true;
    if (done) return null;
    if (maybeSent) return "unconfirmed";
    return isShown() ? "not_sent" : "page_changed";
  }

  private async insertText(
    control: Control,
    input: Extract<BrowserLiveInput, { kind: "insert_text" }>,
    deadline: number,
  ): Promise<ControlCode | null> {
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
        controlId: control.controlId,
        targetId: binding.targetId,
        text: input.text,
        // A request that arrives after the user was told it failed must not type.
        deadline: Math.min(deadline, Date.now() + replyTimeoutMs),
      },
      replyTimeoutMs,
    );
    if (!reply) return "unconfirmed";
    if (reply.inserted === true) return null;
    return reply.reason ?? "target_changed";
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

    // Listening before the discard starts, to know of navigations the page began before it.
    const unload = ownDiscardUnload(DISCARD_URL, (listener) => control.tab.onMessage(listener));
    try {
      const replies = await this.askTypedFrames(control, "all");
      const typedDocumentIsOpen = !replies || replies.some((reply) => reply?.typed !== false);
      if (!typedDocumentIsOpen) {
        contents.navigationHistory.clear();
        return true;
      }
      for (let attempt = 1; attempt <= DISCARD_ATTEMPTS && this.isCurrent(control); attempt++) {
        if (await this.replaceDocument(control, unload.onUnload)) {
          control.typedFrames.clear();
          return true;
        }
        if (!unload.takeRefused()) return false;
        await delay(DISCARD_ATTEMPT_GAP_MS);
      }
      return false;
    } finally {
      unload.dispose();
    }
  }

  /** History goes with the document: back would restore it, its form state and its scripts. */
  private async replaceDocument(
    control: Control,
    onUnload: (event: { preventDefault(): void }) => void,
  ): Promise<boolean> {
    const { contents } = control.tab;
    const url = contents.mainFrame.isDestroyed() ? contents.getURL() : contents.mainFrame.url;
    contents.on("will-prevent-unload", onUnload);
    try {
      await within(contents.loadURL(DISCARD_URL), LOAD_TIMEOUT_MS);
    } finally {
      contents.removeListener("will-prevent-unload", onUnload);
    }
    if (contents.mainFrame.url !== DISCARD_URL) return false;
    contents.navigationHistory.clear();
    if (/^https?:/i.test(url)) {
      // Never reload(): on the result of a POST that submits the form again.
      await within(contents.loadURL(url), LOAD_TIMEOUT_MS);
      contents.navigationHistory.clear();
    }
    return true;
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
        this.frames.ask(
          frame,
          { op: "clear", controlId: control.controlId, scope },
          this.timing.replyTimeoutMs,
        ),
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

  private untrack(contentsId: number, command: AgentCommand): void {
    const running = this.runningByContentsId.get(contentsId);
    running?.delete(command);
    if (running?.size === 0) this.runningByContentsId.delete(contentsId);
  }

  private isTaking(control: Control): boolean {
    return control.phase === "taking" && this.isCurrent(control);
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

function pressKey(contents: HumanControlContents, key: BrowserLiveKey): ControlCode | null {
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

function refuse(code: ControlCode): BrowserLiveFocusResult {
  return { focus: null, error: controlError(code) };
}

function controlError(code: ControlCode): BrowserLiveControlError {
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

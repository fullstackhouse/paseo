import type {
  BrowserHostLiveReleaseControlRequest,
  BrowserHostLiveSendInputRequest,
  BrowserHostLiveTakeControlRequest,
  BrowserLiveControlError,
  BrowserLiveControlErrorCode,
  BrowserLiveFocus,
  BrowserLiveFocusResult,
  BrowserLiveInput,
  BrowserLiveTakeResult,
} from "@getpaseo/protocol/browser-automation/live-view";

const DISCONNECT_GRACE_MS = 5 * 60_000;
const RELEASE_RETRY_MS = 30_000;
// Each exceeds what the desktop allows itself for that request.
const TAKE_TIMEOUT_MS = 35_000;
const INPUT_TIMEOUT_MS = 12_000;
const RELEASE_TIMEOUT_MS = 30_000;

export type BrowserHostControlRequest =
  | BrowserHostLiveTakeControlRequest
  | BrowserHostLiveSendInputRequest
  | BrowserHostLiveReleaseControlRequest;

export interface BrowserHostControlAnswer {
  focus?: BrowserLiveFocus | null;
  error: BrowserLiveControlError | null;
  reloaded?: boolean;
}

/** A watching stream, as far as control needs it. */
export interface ControlledStream {
  streamId: string;
  browserId: string;
  hostClientId: string;
}

type EndReason = "handed_back" | "released" | "host_gone" | "tab_gone";

interface Control {
  controlId: string;
  browserId: string;
  hostClientId: string;
  ownerId: string;
  phase: "taking" | "held" | "releasing";
  /** False until the desktop granted control, so a failed take leaves no note. */
  granted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface HumanControlDeps {
  createId(): string;
  /** Null when the host gave no answer. */
  send(
    hostClientId: string,
    request: BrowserHostControlRequest,
    timeoutMs: number,
  ): Promise<BrowserHostControlAnswer | null>;
  hasViewer(browserId: string): boolean;
  onTaken(browserId: string): void;
  onEnded(browserId: string, note: string): void;
}

/**
 * The human's lock on tabs, one controller each. It starts with an explicit take, outlives the
 * stream, and ends only when the desktop confirms it cleared what was typed, or when that desktop
 * or tab is gone. The lock isn't persisted: a desktop that loses this daemon discards and unlocks
 * by itself.
 *
 * Inputs can be secrets. Nothing in here logs, and no error or note carries one.
 */
export class BrowserHumanControl {
  private readonly byBrowserId = new Map<string, Control>();

  public constructor(private readonly deps: HumanControlDeps) {}

  public isHeld(browserId: string): boolean {
    return this.byBrowserId.has(browserId);
  }

  /** True when anyone but this owner holds the tab. */
  public isHeldByOther(browserId: string, ownerId: string): boolean {
    const control = this.byBrowserId.get(browserId);
    return control !== undefined && control.ownerId !== ownerId;
  }

  public controllerOf(browserId: string, ownerId: string) {
    const control = this.byBrowserId.get(browserId);
    if (control?.ownerId !== ownerId) return null;
    return { controlId: control.controlId, held: control.phase === "held" };
  }

  public async take(stream: ControlledStream, ownerId: string): Promise<BrowserLiveTakeResult> {
    const { browserId, hostClientId, streamId } = stream;
    const existing = this.byBrowserId.get(browserId);
    if (existing) {
      // Asking again, as after a lost answer.
      if (existing.ownerId === ownerId && existing.phase === "held") {
        return { focus: null, error: null };
      }
      return refuse("busy", "The tab is already controlled.");
    }
    const control: Control = {
      controlId: this.deps.createId(),
      browserId,
      hostClientId,
      ownerId,
      phase: "taking",
      granted: false,
      timer: null,
    };
    this.byBrowserId.set(browserId, control);

    const requestId = this.deps.createId();
    const answer = await this.deps.send(
      hostClientId,
      {
        type: "browser.host.live.take_control.request",
        requestId,
        streamId,
        controlId: control.controlId,
      },
      TAKE_TIMEOUT_MS,
    );
    if (!this.isCurrent(control) || control.phase !== "taking") {
      return refuse("failed", "Control ended before it started.");
    }
    if (!answer || answer.error) {
      this.byBrowserId.delete(browserId);
      // The desktop may have granted it anyway. Nothing was typed yet, so nothing to discard.
      void this.sendRelease(control, false);
      return {
        focus: null,
        error: answer?.error ?? controlError("failed", "The desktop didn't answer."),
      };
    }
    control.phase = "held";
    control.granted = true;
    // Not before: a take that fails leaves the last hand-back's note true.
    this.deps.onTaken(browserId);
    if (!this.deps.hasViewer(browserId)) this.startGrace(control);
    return {
      focus: answer.focus ?? null,
      error: null,
      ...(answer.reloaded ? { reloaded: true } : {}),
    };
  }

  public async input(
    stream: ControlledStream,
    ownerId: string,
    input: BrowserLiveInput,
  ): Promise<BrowserLiveFocusResult> {
    const control = this.byBrowserId.get(stream.browserId);
    if (!control || control.ownerId !== ownerId || control.phase !== "held") {
      return refuse("not_controller", "This device doesn't control the tab.");
    }
    const answer = await this.deps.send(
      control.hostClientId,
      {
        type: "browser.host.live.send_input.request",
        requestId: this.deps.createId(),
        streamId: stream.streamId,
        controlId: control.controlId,
        input,
      },
      INPUT_TIMEOUT_MS,
    );
    if (answer?.error?.code === "not_controller") {
      return refuse("not_sent", "The desktop didn't take the input.");
    }
    if (answer) return { focus: answer.focus ?? null, error: answer.error };
    // Never sent again: whatever it was, the desktop may have done it.
    return refuse("unconfirmed", "The desktop didn't confirm the input.");
  }

  public async handBack(
    stream: ControlledStream,
    ownerId: string,
  ): Promise<BrowserLiveControlError | null> {
    const control = this.byBrowserId.get(stream.browserId);
    if (!control) return null;
    if (control.ownerId !== ownerId || control.phase !== "held") {
      return controlError("not_controller", "This device doesn't control the tab.");
    }
    this.stopTimer(control);
    control.phase = "releasing";
    const answer = await this.sendRelease(control, false);
    if (!this.isCurrent(control)) return null;
    if (answer && !answer.error) {
      this.end(control, "handed_back");
      return null;
    }
    // A release that started meanwhile, as when the setting went off, owns the lock now.
    if (!control.timer) {
      control.phase = "held";
      if (!this.deps.hasViewer(control.browserId)) this.startGrace(control);
    }
    return whileLocked(answer?.error) ?? controlError("failed", "The desktop didn't answer.");
  }

  public viewerArrived(browserId: string): void {
    const control = this.byBrowserId.get(browserId);
    if (control?.phase === "held") this.stopTimer(control);
  }

  public viewerLeft(browserId: string): void {
    const control = this.byBrowserId.get(browserId);
    if (control?.phase === "held" && !control.timer) this.startGrace(control);
  }

  public releaseAll(): void {
    for (const control of this.byBrowserId.values()) void this.autoRelease(control);
  }

  public hostGone(hostClientId: string): void {
    for (const control of this.byBrowserId.values()) {
      if (control.hostClientId === hostClientId) this.end(control, "host_gone");
    }
  }

  public tabGone(controlId: string, hostClientIds: readonly string[]): boolean {
    for (const control of this.byBrowserId.values()) {
      if (control.controlId !== controlId) continue;
      if (!hostClientIds.includes(control.hostClientId)) return false;
      this.end(control, "tab_gone");
      return true;
    }
    return false;
  }

  private startGrace(control: Control): void {
    this.setTimer(control, DISCONNECT_GRACE_MS);
  }

  private async autoRelease(control: Control): Promise<void> {
    this.stopTimer(control);
    control.phase = "releasing";
    const answer = await this.sendRelease(control, true);
    if (!this.isCurrent(control)) return;
    if (answer && !answer.error) {
      this.end(control, "released");
      return;
    }
    control.phase = "releasing";
    this.setTimer(control, RELEASE_RETRY_MS);
  }

  private setTimer(control: Control, delayMs: number): void {
    this.stopTimer(control);
    control.timer = setTimeout(() => void this.autoRelease(control), delayMs);
    control.timer.unref?.();
  }

  private stopTimer(control: Control): void {
    if (control.timer) clearTimeout(control.timer);
    control.timer = null;
  }

  private sendRelease(control: Control, discardInput: boolean) {
    return this.deps.send(
      control.hostClientId,
      {
        type: "browser.host.live.release_control.request",
        requestId: this.deps.createId(),
        controlId: control.controlId,
        discardInput,
      },
      RELEASE_TIMEOUT_MS,
    );
  }

  private end(control: Control, reason: EndReason): void {
    if (!this.isCurrent(control)) return;
    this.stopTimer(control);
    this.byBrowserId.delete(control.browserId);
    if (control.granted)
      this.deps.onEnded(control.browserId, formatNote(control.browserId, reason));
  }

  private isCurrent(control: Control): boolean {
    return this.byBrowserId.get(control.browserId) === control;
  }
}

function formatNote(browserId: string, reason: EndReason): string {
  switch (reason) {
    case "handed_back":
      return `The user handed browser tab ${browserId} back after controlling it. The page may have changed: call browser_snapshot before using it.`;
    case "released":
      return `The user's control of browser tab ${browserId} ended without a hand-back. Input they didn't submit was discarded, so a sign-in may be unfinished. Call browser_snapshot before using it.`;
    case "host_gone":
      return `The desktop disconnected while the user controlled browser tab ${browserId}, which ended their control. Input they didn't submit is discarded, so a sign-in may be unfinished.`;
    case "tab_gone":
      return `Browser tab ${browserId} closed while the user controlled it.`;
  }
}

/** not_controller tells the phone that control is over, which only the daemon's lock decides. */
function whileLocked(
  error: BrowserLiveControlError | null | undefined,
): BrowserLiveControlError | null {
  if (error?.code !== "not_controller") return error ?? null;
  return controlError("failed", "The desktop didn't accept the request.");
}

function refuse(code: BrowserLiveControlErrorCode, message: string): BrowserLiveFocusResult {
  return { focus: null, error: controlError(code, message) };
}

function controlError(code: BrowserLiveControlErrorCode, message: string): BrowserLiveControlError {
  return { code, message };
}

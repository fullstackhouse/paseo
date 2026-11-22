import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  BrowserLiveFocus,
  BrowserLiveInput,
} from "@getpaseo/protocol/browser-automation/live-view";
import type { BrowserLiveScreen, BrowserLiveViewStreamInfo } from "./live-view";

export type BrowserControlClient = Pick<
  DaemonClient,
  "takeBrowserLiveControl" | "sendBrowserLiveInput" | "releaseBrowserLiveControl"
>;

export interface BrowserControlState {
  connected: boolean;
  /** Null until a stream said. */
  desktopSupportsControl: boolean | null;
  held: boolean;
  busy: "taking" | "sending" | "releasing" | null;
  /** The tab's committed origin, from the frame on screen. */
  origin: string | null;
  /** The field text goes to. It changes only with the user's own input, never by itself. */
  focus: BrowserLiveFocus | null;
  /** An error code, "released" or "connection". Never a message or anything typed. */
  notice: string | null;
}

export const INITIAL_CONTROL_STATE: BrowserControlState = {
  connected: false,
  desktopSupportsControl: null,
  held: false,
  busy: null,
  origin: null,
  focus: null,
  notice: null,
};

export interface BrowserControl {
  setStream(stream: BrowserLiveViewStreamInfo | null): void;
  setOrigin(origin: string | null): void;
  streamEnded(code: string | null): void;
  take(): Promise<void>;
  send(input: BrowserLiveInput): Promise<void>;
  handBack(): Promise<void>;
  dispose(): void;
}

// Ends after which this device holds nothing: the tab, its desktop, or the setting is gone.
const CONTROL_ENDING_CODES = new Set([
  "browser_tab_closed",
  "browser_tab_not_found",
  "browser_no_host",
  "browser_denied",
  "browser_unsupported",
]);

export type BrowserControlAvailability = "update_host" | "update_desktop" | "unknown" | "ready";

/** The one compatibility gate for control. Past it, the feature assumes support. */
export function getControlAvailability(
  hostSupportsControl: boolean,
  state: Pick<BrowserControlState, "desktopSupportsControl">,
): BrowserControlAvailability {
  if (!hostSupportsControl) return "update_host";
  if (state.desktopSupportsControl === null) return "unknown";
  return state.desktopSupportsControl ? "ready" : "update_desktop";
}

/**
 * One viewer's control of one tab. It outlives the stream, which stops whenever the app leaves
 * the foreground, as it does for a password manager. Typed text passes through and is never kept.
 */
export function createBrowserControl(input: {
  client: BrowserControlClient;
  onChange: (state: BrowserControlState) => void;
}): BrowserControl {
  const { client, onChange } = input;
  let state = INITIAL_CONTROL_STATE;
  let streamId: string | null = null;
  let disposed = false;

  function update(change: Partial<BrowserControlState>): void {
    if (disposed) return;
    state = { ...state, ...change };
    onChange(state);
  }

  return {
    setStream(stream) {
      streamId = stream?.streamId ?? null;
      if (!stream) {
        update({ connected: false });
        return;
      }
      const held = stream.control?.held === true;
      update({
        connected: true,
        desktopSupportsControl: stream.control !== null,
        held,
        ...(held ? {} : { focus: null }),
        ...(state.held && !held ? { notice: "released" } : {}),
      });
    },

    streamEnded(code) {
      if (!state.held || !code || !CONTROL_ENDING_CODES.has(code)) return;
      update({ held: false, focus: null, notice: "released" });
    },

    setOrigin(origin) {
      if (origin === state.origin) return;
      const pageChanged =
        state.focus !== null && origin !== null && origin !== state.focus.topOrigin;
      update({ origin, ...(pageChanged ? { focus: null, notice: "target_changed" } : {}) });
    },

    async take() {
      if (!streamId || state.held || state.busy) return;
      update({ busy: "taking", notice: null });
      try {
        const { focus, error } = await client.takeBrowserLiveControl(streamId);
        if (error) update({ busy: null, notice: error.code });
        else update({ busy: null, held: true, focus });
      } catch {
        update({ busy: null, notice: "connection" });
      }
    },

    async send(liveInput) {
      if (!streamId || !state.held || state.busy) return;
      const isText = liveInput.kind === "insert_text";
      update({ busy: "sending", notice: null });
      try {
        const { focus, error } = await client.sendBrowserLiveInput(streamId, liveInput);
        if (!error) {
          update({ busy: null, focus });
        } else if (error.code === "not_controller") {
          update({ busy: null, held: false, focus: null, notice: "released" });
        } else {
          // Refused text is gone from both sides; the user picks the field again.
          update({ busy: null, notice: error.code, ...(isText ? { focus: null } : {}) });
        }
      } catch {
        // The thrown error is dropped: it must not carry what was typed into the UI or a log.
        update(
          isText
            ? { busy: null, focus: null, notice: "unconfirmed" }
            : { busy: null, notice: "connection" },
        );
      }
    },

    async handBack() {
      if (!streamId || !state.held || state.busy) return;
      update({ busy: "releasing", notice: null });
      try {
        const { error } = await client.releaseBrowserLiveControl(streamId);
        if (error) update({ busy: null, notice: error.code });
        else update({ busy: null, held: false, focus: null });
      } catch {
        update({ busy: null, notice: "connection" });
      }
    },

    dispose() {
      disposed = true;
      streamId = null;
    },
  };
}

interface Size {
  width: number;
  height: number;
}

/** View points per screen pixel of a frame shown with contentFit contain. */
export function getScreenScale(view: Size, screen: Size): number {
  return Math.min(view.width / screen.width, view.height / screen.height);
}

/** A touch in the view as a point of the desktop tab, or null outside the image. */
export function toScreenPoint(
  touch: { x: number; y: number },
  view: Size,
  screen: BrowserLiveScreen,
): { x: number; y: number } | null {
  const scale = getScreenScale(view, screen);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const x = (touch.x - (view.width - screen.width * scale) / 2) / scale;
  const y = (touch.y - (view.height - screen.height * scale) / 2) / scale;
  if (x < 0 || y < 0 || x > screen.width || y > screen.height) return null;
  return { x, y: y - screen.offsetTop };
}

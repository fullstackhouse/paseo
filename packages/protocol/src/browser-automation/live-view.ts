import { z } from "zod";
import { BrowserAutomationErrorSchema } from "./rpc-schemas.js";

// Live view of a desktop browser tab. The viewing app talks to the daemon with
// browser.live.*; the daemon forwards to the desktop host that owns the tab with
// browser.host.live.*. JPEG frames travel as binary browser_live frames
// (binary-frames/browser-live.ts), never as JSON.
//
// The human may take control of a watched tab. insert_text carries secrets: no layer logs,
// persists, or echoes an input.

const LiveViewOptionsShape = {
  maxFps: z.number().int().positive().optional(),
  jpegQuality: z.number().int().min(1).max(100).optional(),
  maxWidth: z.number().int().positive().optional(),
};

export const BrowserLiveViewportSchema = z.object({
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const BROWSER_LIVE_KEYS = [
  "Enter",
  "Tab",
  "Backspace",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;

// x and y are in the screen space of the frame metadata (deviceWidth x deviceHeight) less offsetTop.
export const BrowserLiveInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tap"), x: z.number(), y: z.number() }),
  z.object({
    kind: z.literal("scroll"),
    x: z.number(),
    y: z.number(),
    deltaX: z.number(),
    deltaY: z.number(),
  }),
  z.object({ kind: z.literal("key"), key: z.enum(BROWSER_LIVE_KEYS) }),
  // Refused unless targetId still names the focused field the user was shown.
  z.object({
    kind: z.literal("insert_text"),
    targetId: z.string().min(1),
    text: z.string().max(10_000),
  }),
]);

// The field that has focus. Both origins are committed origins from the desktop's main process.
export const BrowserLiveFocusSchema = z.object({
  targetId: z.string(),
  // password | new_password | one_time_code | secret | username | email | text. Open for newer hosts.
  kind: z.string(),
  origin: z.string(),
  topOrigin: z.string(),
});

// Open string so newer daemons and hosts can add codes; see BrowserLiveControlErrorCode.
export const BrowserLiveControlErrorSchema = z.object({ code: z.string(), message: z.string() });

export type BrowserLiveControlErrorCode =
  | "update_desktop"
  | "disabled"
  | "not_controller"
  | "busy"
  | "agent_busy"
  | "target_changed"
  | "key_unsupported"
  | "unconfirmed"
  | "failed";

const BrowserLiveFocusResultShape = {
  focus: BrowserLiveFocusSchema.nullable(),
  error: BrowserLiveControlErrorSchema.nullable(),
};

const BrowserLiveStartResultShape = {
  streamId: z.string().nullable(),
  viewport: BrowserLiveViewportSchema.nullable(),
  error: BrowserAutomationErrorSchema.nullable(),
};

// App -> daemon.

export const BrowserLiveStartRequestSchema = z.object({
  type: z.literal("browser.live.start.request"),
  requestId: z.string(),
  browserId: z.string().min(1),
  ...LiveViewOptionsShape,
});

export const BrowserLiveStartResponseSchema = z.object({
  type: z.literal("browser.live.start.response"),
  payload: z.object({
    requestId: z.string(),
    ...BrowserLiveStartResultShape,
    // COMPAT(browserLiveViewInput): added after v0.15.4, remove optional after 2027-05-22.
    // Present when the tab's desktop can hand over control.
    control: z.object({ held: z.boolean() }).optional(),
  }),
});

export const BrowserLiveStopRequestSchema = z.object({
  type: z.literal("browser.live.stop.request"),
  requestId: z.string(),
  streamId: z.string().min(1),
});

export const BrowserLiveStopResponseSchema = z.object({
  type: z.literal("browser.live.stop.response"),
  payload: z.object({
    requestId: z.string(),
    streamId: z.string(),
    error: BrowserAutomationErrorSchema.nullable(),
  }),
});

export const BrowserLiveTakeControlRequestSchema = z.object({
  type: z.literal("browser.live.take_control.request"),
  requestId: z.string(),
  streamId: z.string().min(1),
});

export const BrowserLiveTakeControlResponseSchema = z.object({
  type: z.literal("browser.live.take_control.response"),
  payload: z.object({
    requestId: z.string(),
    streamId: z.string(),
    ...BrowserLiveFocusResultShape,
  }),
});

export const BrowserLiveSendInputRequestSchema = z.object({
  type: z.literal("browser.live.send_input.request"),
  requestId: z.string(),
  streamId: z.string().min(1),
  input: BrowserLiveInputSchema,
});

export const BrowserLiveSendInputResponseSchema = z.object({
  type: z.literal("browser.live.send_input.response"),
  payload: z.object({
    requestId: z.string(),
    streamId: z.string(),
    ...BrowserLiveFocusResultShape,
  }),
});

export const BrowserLiveReleaseControlRequestSchema = z.object({
  type: z.literal("browser.live.release_control.request"),
  requestId: z.string(),
  streamId: z.string().min(1),
});

export const BrowserLiveReleaseControlResponseSchema = z.object({
  type: z.literal("browser.live.release_control.response"),
  payload: z.object({
    requestId: z.string(),
    streamId: z.string(),
    error: BrowserLiveControlErrorSchema.nullable(),
  }),
});

// One-way: acknowledges that the app rendered frameSeq. No response. The desktop
// releases the next screencast frame only after this ack, so one frame is in flight.
export const BrowserLiveFrameAckSchema = z.object({
  type: z.literal("browser.live.frame_ack"),
  streamId: z.string().min(1),
  frameSeq: z.number().int().nonnegative(),
});

// Daemon -> app, one-way: the stream ended without a stop request from the app
// (the desktop host disconnected, or the tab closed or went away on the desktop).
export const BrowserLiveEndedSchema = z.object({
  type: z.literal("browser.live.ended"),
  payload: z.object({
    streamId: z.string(),
    error: BrowserAutomationErrorSchema.nullable(),
    subscriptionId: z.string().optional(),
  }),
});

// Daemon -> desktop host. Emitted on the host's browser-host subscription, which
// tags them with subscriptionId.

export const BrowserHostLiveStartRequestSchema = z.object({
  type: z.literal("browser.host.live.start.request"),
  subscriptionId: z.string().optional(),
  requestId: z.string().min(1),
  streamId: z.string().min(1),
  browserId: z.string().min(1),
  // Set when the viewer already controls the tab, which refuses any other stream.
  controlId: z.string().optional(),
  ...LiveViewOptionsShape,
});

export const BrowserHostLiveTakeControlRequestSchema = z.object({
  type: z.literal("browser.host.live.take_control.request"),
  subscriptionId: z.string().optional(),
  requestId: z.string().min(1),
  streamId: z.string().min(1),
  controlId: z.string().min(1),
});

export const BrowserHostLiveSendInputRequestSchema = z.object({
  type: z.literal("browser.host.live.send_input.request"),
  subscriptionId: z.string().optional(),
  requestId: z.string().min(1),
  streamId: z.string().min(1),
  controlId: z.string().min(1),
  input: BrowserLiveInputSchema,
});

export const BrowserHostLiveReleaseControlRequestSchema = z.object({
  type: z.literal("browser.host.live.release_control.request"),
  subscriptionId: z.string().optional(),
  requestId: z.string().min(1),
  controlId: z.string().min(1),
  // True on every release the user didn't ask for: documents live view typed into are discarded.
  discardInput: z.boolean(),
});

export const BrowserHostLiveStopRequestSchema = z.object({
  type: z.literal("browser.host.live.stop.request"),
  subscriptionId: z.string().optional(),
  requestId: z.string().min(1),
  streamId: z.string().min(1),
});

// One-way: forwards the app's frame ack. No response.
export const BrowserHostLiveFrameAckSchema = z.object({
  type: z.literal("browser.host.live.frame_ack"),
  subscriptionId: z.string().optional(),
  streamId: z.string().min(1),
  frameSeq: z.number().int().nonnegative(),
});

// Desktop host -> daemon.

export const BrowserHostLiveStartResponseSchema = z.object({
  type: z.literal("browser.host.live.start.response"),
  payload: z.object({
    requestId: z.string().min(1),
    viewport: BrowserLiveViewportSchema.nullable(),
    error: BrowserAutomationErrorSchema.nullable(),
  }),
});

export const BrowserHostLiveStopResponseSchema = z.object({
  type: z.literal("browser.host.live.stop.response"),
  payload: z.object({
    requestId: z.string().min(1),
    error: BrowserAutomationErrorSchema.nullable(),
  }),
});

export const BrowserHostLiveTakeControlResponseSchema = z.object({
  type: z.literal("browser.host.live.take_control.response"),
  payload: z.object({ requestId: z.string().min(1), ...BrowserLiveFocusResultShape }),
});

export const BrowserHostLiveSendInputResponseSchema = z.object({
  type: z.literal("browser.host.live.send_input.response"),
  payload: z.object({ requestId: z.string().min(1), ...BrowserLiveFocusResultShape }),
});

export const BrowserHostLiveReleaseControlResponseSchema = z.object({
  type: z.literal("browser.host.live.release_control.response"),
  payload: z.object({
    requestId: z.string().min(1),
    error: BrowserLiveControlErrorSchema.nullable(),
  }),
});

// One-way: the controlled tab is gone, so control ended with it. No response.
export const BrowserHostLiveControlEndedSchema = z.object({
  type: z.literal("browser.host.live.control_ended"),
  payload: z.object({ controlId: z.string().min(1) }),
});

// One-way: the screencast ended on the desktop without a stop request (tab closed or
// destroyed, debugger detached). No response; the daemon tells the viewer browser.live.ended.
export const BrowserHostLiveEndedSchema = z.object({
  type: z.literal("browser.host.live.ended"),
  payload: z.object({
    streamId: z.string().min(1),
    error: BrowserAutomationErrorSchema.nullable(),
  }),
});

export type BrowserLiveViewport = z.infer<typeof BrowserLiveViewportSchema>;
export type BrowserLiveStartRequest = z.infer<typeof BrowserLiveStartRequestSchema>;
export type BrowserLiveStartResponse = z.infer<typeof BrowserLiveStartResponseSchema>;
export type BrowserLiveStopResponse = z.infer<typeof BrowserLiveStopResponseSchema>;
export type BrowserLiveEnded = z.infer<typeof BrowserLiveEndedSchema>;
export type BrowserHostLiveStartRequest = z.infer<typeof BrowserHostLiveStartRequestSchema>;
export type BrowserHostLiveStopRequest = z.infer<typeof BrowserHostLiveStopRequestSchema>;
export type BrowserHostLiveFrameAck = z.infer<typeof BrowserHostLiveFrameAckSchema>;
export type BrowserHostLiveStartResponse = z.infer<typeof BrowserHostLiveStartResponseSchema>;
export type BrowserHostLiveStopResponse = z.infer<typeof BrowserHostLiveStopResponseSchema>;
export type BrowserHostLiveEnded = z.infer<typeof BrowserHostLiveEndedSchema>;
export type BrowserLiveInput = z.infer<typeof BrowserLiveInputSchema>;
export type BrowserLiveKey = (typeof BROWSER_LIVE_KEYS)[number];
export type BrowserLiveFocus = z.infer<typeof BrowserLiveFocusSchema>;
export type BrowserLiveControlError = z.infer<typeof BrowserLiveControlErrorSchema>;
export interface BrowserLiveFocusResult {
  focus: BrowserLiveFocus | null;
  error: BrowserLiveControlError | null;
}
export type BrowserHostLiveTakeControlRequest = z.infer<
  typeof BrowserHostLiveTakeControlRequestSchema
>;
export type BrowserHostLiveSendInputRequest = z.infer<typeof BrowserHostLiveSendInputRequestSchema>;
export type BrowserHostLiveReleaseControlRequest = z.infer<
  typeof BrowserHostLiveReleaseControlRequestSchema
>;
export type BrowserHostLiveTakeControlResponse = z.infer<
  typeof BrowserHostLiveTakeControlResponseSchema
>;
export type BrowserHostLiveSendInputResponse = z.infer<
  typeof BrowserHostLiveSendInputResponseSchema
>;
export type BrowserHostLiveReleaseControlResponse = z.infer<
  typeof BrowserHostLiveReleaseControlResponseSchema
>;
export type BrowserHostLiveControlEnded = z.infer<typeof BrowserHostLiveControlEndedSchema>;
export type BrowserHostLiveOutboundMessage =
  | BrowserHostLiveStartRequest
  | BrowserHostLiveTakeControlRequest
  | BrowserHostLiveSendInputRequest
  | BrowserHostLiveReleaseControlRequest
  | BrowserHostLiveStopRequest
  | BrowserHostLiveFrameAck;

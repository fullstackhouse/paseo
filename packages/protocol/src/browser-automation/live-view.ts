import { z } from "zod";
import { BrowserAutomationErrorSchema } from "./rpc-schemas.js";

// Live view of a desktop browser tab. The viewing app talks to the daemon with
// browser.live.*; the daemon forwards to the desktop host that owns the tab with
// browser.host.live.*. JPEG frames travel as binary browser_live frames
// (binary-frames/browser-live.ts), never as JSON.

const LiveViewOptionsShape = {
  maxFps: z.number().int().positive().optional(),
  jpegQuality: z.number().int().min(1).max(100).optional(),
  maxWidth: z.number().int().positive().optional(),
};

export const BrowserLiveViewportSchema = z.object({
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

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
  payload: z.object({ requestId: z.string(), ...BrowserLiveStartResultShape }),
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
  ...LiveViewOptionsShape,
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
export type BrowserHostLiveOutboundMessage =
  | BrowserHostLiveStartRequest
  | BrowserHostLiveStopRequest
  | BrowserHostLiveFrameAck;

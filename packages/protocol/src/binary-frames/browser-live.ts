import { z } from "zod";
import { asUint8Array } from "./terminal.js";

/**
 * One JPEG frame of a browser live view (see browser-automation/live-view.ts).
 *
 * Layout: [opcode][streamId length u8][streamId utf-8][frameSeq u32][metadata length u16]
 * [metadata JSON][jpeg bytes]. The daemon reads only the header to route the frame and
 * relays the bytes unchanged.
 */
export const BROWSER_LIVE_FRAME_OPCODE = 0x20;

// Page.screencastFrame metadata, in CSS pixels of the page.
export const BrowserLiveFrameMetadataSchema = z.object({
  deviceWidth: z.number(),
  deviceHeight: z.number(),
  offsetTop: z.number(),
  pageScaleFactor: z.number(),
  scrollOffsetX: z.number(),
  scrollOffsetY: z.number(),
  timestamp: z.number().optional(),
});

export type BrowserLiveFrameMetadata = z.infer<typeof BrowserLiveFrameMetadataSchema>;

export interface BrowserLiveFrameHeader {
  streamId: string;
  frameSeq: number;
}

export interface BrowserLiveFrame extends BrowserLiveFrameHeader {
  metadata: BrowserLiveFrameMetadata;
  jpeg: Uint8Array;
}

export function encodeBrowserLiveFrame(input: {
  streamId: string;
  frameSeq: number;
  metadata: BrowserLiveFrameMetadata;
  jpeg: Uint8Array | ArrayBuffer;
}): Uint8Array {
  const streamId = new TextEncoder().encode(input.streamId);
  if (streamId.byteLength === 0 || streamId.byteLength > 0xff) {
    throw new RangeError("Browser live streamId must be 1-255 bytes");
  }
  if (!Number.isInteger(input.frameSeq) || input.frameSeq < 0 || input.frameSeq > 0xffffffff) {
    throw new RangeError("Browser live frameSeq must be a uint32");
  }
  const metadata = new TextEncoder().encode(JSON.stringify(input.metadata));
  if (metadata.byteLength > 0xffff) {
    throw new RangeError("Browser live frame metadata is too long");
  }
  const jpeg = asUint8Array(input.jpeg) ?? new Uint8Array();
  const headerLength = 2 + streamId.byteLength + 4 + 2;
  const bytes = new Uint8Array(headerLength + metadata.byteLength + jpeg.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bytes[0] = BROWSER_LIVE_FRAME_OPCODE;
  bytes[1] = streamId.byteLength;
  bytes.set(streamId, 2);
  view.setUint32(2 + streamId.byteLength, input.frameSeq);
  view.setUint16(6 + streamId.byteLength, metadata.byteLength);
  bytes.set(metadata, headerLength);
  bytes.set(jpeg, headerLength + metadata.byteLength);
  return bytes;
}

/** Reads only the routing header; does not parse metadata or touch the JPEG. */
export function decodeBrowserLiveFrameHeader(bytes: Uint8Array): BrowserLiveFrameHeader | null {
  return readFrame(bytes)?.header ?? null;
}

export function decodeBrowserLiveFrame(bytes: Uint8Array): BrowserLiveFrame | null {
  const frame = readFrame(bytes);
  if (!frame) {
    return null;
  }
  const metadata = BrowserLiveFrameMetadataSchema.safeParse(
    decodeJson(bytes.subarray(frame.metadataStart, frame.jpegStart)),
  );
  if (!metadata.success) {
    return null;
  }
  return { ...frame.header, metadata: metadata.data, jpeg: bytes.subarray(frame.jpegStart) };
}

function readFrame(
  bytes: Uint8Array,
): { header: BrowserLiveFrameHeader; metadataStart: number; jpegStart: number } | null {
  if (bytes.byteLength < 2 || bytes[0] !== BROWSER_LIVE_FRAME_OPCODE) {
    return null;
  }
  const streamIdLength = bytes[1];
  const metadataStart = 2 + streamIdLength + 4 + 2;
  if (streamIdLength === 0 || bytes.byteLength < metadataStart) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jpegStart = metadataStart + view.getUint16(6 + streamIdLength);
  if (bytes.byteLength < jpegStart) {
    return null;
  }
  let streamId: string;
  try {
    streamId = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(2, 2 + streamIdLength),
    );
  } catch {
    return null;
  }
  return {
    header: { streamId, frameSeq: view.getUint32(2 + streamIdLength) },
    metadataStart,
    jpegStart,
  };
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

import { describe, expect, it } from "vitest";

import {
  BROWSER_LIVE_FRAME_OPCODE,
  decodeBinaryFrame,
  decodeBrowserLiveFrame,
  decodeBrowserLiveFrameHeader,
  encodeBrowserLiveFrame,
} from "./index.js";

const metadata = {
  deviceWidth: 1280,
  deviceHeight: 720,
  offsetTop: 12.5,
  pageScaleFactor: 1,
  scrollOffsetX: 0,
  scrollOffsetY: 340,
  timestamp: 1_732_280_000.25,
};
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

describe("browser live binary frames", () => {
  it("round-trips stream id, frame sequence, metadata, and jpeg bytes", () => {
    const encoded = encodeBrowserLiveFrame({
      streamId: "stream-1",
      frameSeq: 0xfffffffe,
      metadata,
      jpeg,
    });

    expect(encoded[0]).toBe(BROWSER_LIVE_FRAME_OPCODE);
    expect(decodeBrowserLiveFrame(encoded)).toEqual({
      streamId: "stream-1",
      frameSeq: 0xfffffffe,
      metadata,
      jpeg,
    });
  });

  it("reads the routing header without parsing metadata", () => {
    const encoded = encodeBrowserLiveFrame({ streamId: "s", frameSeq: 7, metadata, jpeg });
    const header = decodeBrowserLiveFrameHeader(encoded);
    expect(header).toEqual({ streamId: "s", frameSeq: 7 });
  });

  it("demuxes browser live frames and keeps the original bytes for relaying", () => {
    const encoded = encodeBrowserLiveFrame({ streamId: "s", frameSeq: 3, metadata, jpeg });
    const decoded = decodeBinaryFrame(encoded);
    expect(decoded).toEqual({
      kind: "browser_live",
      frame: { streamId: "s", frameSeq: 3 },
      bytes: encoded,
    });
  });

  it("carries the tab's committed origin with the frame", () => {
    const encoded = encodeBrowserLiveFrame({
      streamId: "stream-1",
      frameSeq: 1,
      metadata: { ...metadata, origin: "https://app.example" },
      jpeg,
    });
    expect(decodeBrowserLiveFrame(encoded)?.metadata.origin).toBe("https://app.example");
  });

  it("ignores unknown metadata fields from newer senders", () => {
    const encoded = encodeBrowserLiveFrame({
      streamId: "s",
      frameSeq: 1,
      metadata: { ...metadata, futureField: true } as typeof metadata,
      jpeg,
    });
    expect(decodeBrowserLiveFrame(encoded)?.metadata).toEqual(metadata);
  });

  it("rejects truncated headers and metadata", () => {
    const encoded = encodeBrowserLiveFrame({ streamId: "stream", frameSeq: 1, metadata, jpeg });
    expect(decodeBrowserLiveFrameHeader(encoded.subarray(0, 5))).toBeNull();
    expect(decodeBrowserLiveFrame(encoded.subarray(0, 20))).toBeNull();
    expect(decodeBrowserLiveFrameHeader(new Uint8Array([BROWSER_LIVE_FRAME_OPCODE, 0]))).toBeNull();
  });

  it("rejects invalid metadata", () => {
    const encoded = encodeBrowserLiveFrame({
      streamId: "s",
      frameSeq: 1,
      metadata: { deviceWidth: "wide" } as unknown as typeof metadata,
      jpeg,
    });
    expect(decodeBrowserLiveFrame(encoded)).toBeNull();
  });

  it("rejects out-of-range ids and sequences when encoding", () => {
    expect(() => encodeBrowserLiveFrame({ streamId: "", frameSeq: 0, metadata, jpeg })).toThrow(
      RangeError,
    );
    expect(() => encodeBrowserLiveFrame({ streamId: "s", frameSeq: -1, metadata, jpeg })).toThrow(
      RangeError,
    );
  });
});

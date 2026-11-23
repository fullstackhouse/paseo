import { describe, expect, it } from "vitest";

import { parseWorkspaceAppearance } from "./workspace-appearance.js";

function png(width: number, height: number, totalBytes = 33): string {
  const bytes = Buffer.alloc(totalBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

describe("parseWorkspaceAppearance", () => {
  it("keeps a square avatar with its detected type and a Lucide icon name", () => {
    expect(parseWorkspaceAppearance({ avatar: png(64, 64), titleIcon: "GitPullRequest" })).toEqual({
      avatar: { data: png(64, 64), mimeType: "image/png" },
      titleIcon: "GitPullRequest",
    });
  });

  it("clears when both are null, and keeps one when only the other is null", () => {
    expect(parseWorkspaceAppearance({ avatar: null, titleIcon: null })).toBeNull();
    expect(parseWorkspaceAppearance({ avatar: null, titleIcon: "Inbox" })).toEqual({
      avatar: null,
      titleIcon: "Inbox",
    });
  });

  it("rejects avatars that would bloat every workspace descriptor", () => {
    expect(() =>
      parseWorkspaceAppearance({ avatar: png(64, 64, 17 * 1024), titleIcon: null }),
    ).toThrow("Avatar must be 16 KB or smaller");
    expect(() => parseWorkspaceAppearance({ avatar: png(512, 512), titleIcon: null })).toThrow(
      "Avatar must be a square image up to 256×256",
    );
    expect(() => parseWorkspaceAppearance({ avatar: png(64, 32), titleIcon: null })).toThrow(
      "square image",
    );
  });

  it("rejects an icon that is not a Lucide name", () => {
    expect(() => parseWorkspaceAppearance({ avatar: null, titleIcon: "<svg/>" })).toThrow(
      "Title icon must be a Lucide icon name",
    );
    expect(() => parseWorkspaceAppearance({ avatar: null, titleIcon: "git-pull-request" })).toThrow(
      "Lucide icon name",
    );
  });
});

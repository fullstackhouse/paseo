import type {
  WorkspaceAppearance,
  WorkspaceAppearanceSetRequest,
} from "@getpaseo/protocol/messages";

import { detectImageMimeType } from "../utils/project-custom-icon.js";
import { getImageDimensions } from "../utils/project-icon.js";

// Every workspace descriptor carries the avatar inline, and descriptors go to every client on
// every workspace update, so the cap is a few avatars' worth rather than a project icon's 512 KB.
// A 64 px avatar from a forge is 2-6 KB.
const MAX_AVATAR_BYTES = 16 * 1024;
const MAX_AVATAR_SIDE = 256;
const AVATAR_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// A Lucide export name, as plugin icons use (`Inbox`, `GitPullRequest`). The app draws it, or
// nothing when the name is unknown.
const TITLE_ICON_NAME = /^[A-Z][A-Za-z0-9]*$/;
const MAX_TITLE_ICON_LENGTH = 64;

/**
 * The appearance a `workspace.appearance.set` request stores, or null when it clears it.
 * Throws with a message for the caller when the avatar or icon is unusable.
 */
export function parseWorkspaceAppearance(
  request: Pick<WorkspaceAppearanceSetRequest, "avatar" | "titleIcon">,
): WorkspaceAppearance | null {
  if (request.avatar === null && request.titleIcon === null) return null;
  return {
    avatar: request.avatar === null ? null : parseAvatar(request.avatar),
    titleIcon: request.titleIcon === null ? null : parseTitleIcon(request.titleIcon),
  };
}

function parseAvatar(base64: string): NonNullable<WorkspaceAppearance["avatar"]> {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) throw new Error("Avatar is empty or not base64");
  if (bytes.length > MAX_AVATAR_BYTES) {
    throw new Error(`Avatar must be ${MAX_AVATAR_BYTES / 1024} KB or smaller`);
  }
  const mimeType = detectImageMimeType(bytes);
  if (mimeType === null || !AVATAR_MIME_TYPES.has(mimeType)) {
    throw new Error("Avatar must be a PNG, JPEG, GIF or WebP image");
  }
  const size = getImageDimensions(bytes, mimeType);
  if (size === null || size.width !== size.height || size.width > MAX_AVATAR_SIDE) {
    throw new Error(`Avatar must be a square image up to ${MAX_AVATAR_SIDE}×${MAX_AVATAR_SIDE}`);
  }
  return { data: bytes.toString("base64"), mimeType };
}

function parseTitleIcon(name: string): string {
  if (name.length > MAX_TITLE_ICON_LENGTH || !TITLE_ICON_NAME.test(name)) {
    throw new Error("Title icon must be a Lucide icon name, such as `Inbox`");
  }
  return name;
}

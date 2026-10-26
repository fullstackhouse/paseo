// Formats the diff pane previews. Every platform's image view decodes these.
const DIFF_IMAGE_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export function getDiffImageMimeType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || path.lastIndexOf("/") > dot) return null;
  return DIFF_IMAGE_MIME_TYPE_BY_EXTENSION[path.slice(dot).toLowerCase()] ?? null;
}

import path from "node:path";

export type OpenWithDefaultAppResult = { opened: true } | { opened: false; reason: "unsupported" };

interface PathStats {
  isDirectory(): boolean;
}

interface DefaultAppOwner {
  expandHomePath(targetPath: string): string;
  isAbsolutePath(targetPath: string): boolean;
  /** Follows symlinks; null when nothing exists at the path. */
  realPath(targetPath: string): string | null;
  stat(targetPath: string): PathStats | null;
  openPath(targetPath: string): Promise<void>;
}

// shell.openPath runs anything the OS treats as a program, and agents write these links, so
// only types that open in a viewer or editor are allowed. Everything else is refused.
const VIEWABLE_EXTENSIONS = new Set([
  // Web pages and documents
  ".html",
  ".htm",
  ".pdf",
  ".md",
  ".markdown",
  ".txt",
  ".log",
  ".rtf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  // Data
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
  ".heic",
  ".avif",
  // Audio and video
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
]);

// Folders open in the file manager, except macOS bundles, which launch as apps or installers.
const BUNDLE_EXTENSIONS = new Set([
  ".app",
  ".action",
  ".appex",
  ".bundle",
  ".framework",
  ".kext",
  ".mpkg",
  ".pkg",
  ".plugin",
  ".prefpane",
  ".saver",
  ".scptd",
  ".workflow",
  ".xpc",
]);

function extensionOf(targetPath: string): string {
  return path.extname(targetPath.replace(/[\\/]+$/, "")).toLowerCase();
}

function canOpen(realPath: string, stats: PathStats): boolean {
  const extension = extensionOf(realPath);
  if (stats.isDirectory()) return !BUNDLE_EXTENSIONS.has(extension);
  return VIEWABLE_EXTENSIONS.has(extension);
}

/** Opens a local document, image, media file or folder in the app the OS picks for it. */
export function createDefaultAppOpener(owner: DefaultAppOwner) {
  return async (candidate: unknown): Promise<OpenWithDefaultAppResult> => {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      throw new Error("A path is required.");
    }
    const targetPath = owner.expandHomePath(candidate.trim());
    if (!owner.isAbsolutePath(targetPath)) {
      throw new Error("Only absolute local paths can open in their default app.");
    }
    // A symlink named notes.md can point at a script; judge what the OS will actually open.
    const realPath = owner.realPath(targetPath);
    const stats = realPath ? owner.stat(realPath) : null;
    if (!realPath || !stats) {
      throw new Error(`Path does not exist: ${targetPath}`);
    }
    if (!canOpen(realPath, stats)) {
      return { opened: false, reason: "unsupported" };
    }
    await owner.openPath(realPath);
    return { opened: true };
  };
}

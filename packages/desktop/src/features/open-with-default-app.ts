import path from "node:path";

export type OpenWithDefaultAppResult = { opened: true } | { opened: false; reason: "executable" };

interface PathStats {
  isFile(): boolean;
  mode: number;
}

interface DefaultAppOwner {
  platform: NodeJS.Platform;
  expandHomePath(targetPath: string): string;
  isAbsolutePath(targetPath: string): boolean;
  /** Null when nothing exists at the path. */
  stat(targetPath: string): PathStats | null;
  openPath(targetPath: string): Promise<void>;
}

// shell.openPath launches these instead of showing them, so an agent-written link could run code.
const LAUNCHING_EXTENSIONS = new Set([
  ".app",
  ".applescript",
  ".appimage",
  ".bash",
  ".bat",
  ".cmd",
  ".com",
  ".command",
  ".csh",
  ".desktop",
  ".exe",
  ".fish",
  ".jar",
  ".lnk",
  ".mpkg",
  ".msi",
  ".pkg",
  ".ps1",
  ".run",
  ".scpt",
  ".scptd",
  ".sh",
  ".terminal",
  ".tool",
  ".vbs",
  ".workflow",
  ".zsh",
]);

function isLaunchable(targetPath: string, stats: PathStats, platform: NodeJS.Platform): boolean {
  const extension = path.extname(targetPath.replace(/[\\/]+$/, "")).toLowerCase();
  if (LAUNCHING_EXTENSIONS.has(extension)) return true;
  return platform !== "win32" && stats.isFile() && (stats.mode & 0o111) !== 0;
}

/** Opens a local file or folder in the app the OS picks for it, refusing anything that would run. */
export function createDefaultAppOpener(owner: DefaultAppOwner) {
  return async (candidate: unknown): Promise<OpenWithDefaultAppResult> => {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      throw new Error("A path is required.");
    }
    const targetPath = owner.expandHomePath(candidate.trim());
    if (!owner.isAbsolutePath(targetPath)) {
      throw new Error("Only absolute local paths can open in their default app.");
    }
    const stats = owner.stat(targetPath);
    if (!stats) {
      throw new Error(`Path does not exist: ${targetPath}`);
    }
    if (isLaunchable(targetPath, stats, owner.platform)) {
      return { opened: false, reason: "executable" };
    }
    await owner.openPath(targetPath);
    return { opened: true };
  };
}

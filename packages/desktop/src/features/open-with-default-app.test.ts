import { describe, expect, it } from "vitest";

import { createDefaultAppOpener } from "./open-with-default-app";

interface FakeEntry {
  directory?: boolean;
  /** Symlink target; the entry itself is the link. */
  linksTo?: string;
}

function createOpener(entries: Record<string, FakeEntry>) {
  const opened: string[] = [];
  // Like realpath: drops a trailing slash and follows links.
  const resolve = (targetPath: string, depth = 0): string | null => {
    const normalized = targetPath.replace(/(.)\/+$/, "$1");
    const entry = entries[normalized];
    if (!entry || depth > 8) return null;
    return entry.linksTo ? resolve(entry.linksTo, depth + 1) : normalized;
  };
  const open = createDefaultAppOpener({
    expandHomePath: (targetPath) => targetPath.replace(/^~(?=\/|$)/, "/Users/me"),
    isAbsolutePath: (targetPath) => targetPath.startsWith("/"),
    realPath: resolve,
    stat: (targetPath) => {
      const entry = entries[targetPath];
      return entry ? { isDirectory: () => entry.directory ?? false } : null;
    },
    openPath: async (targetPath) => {
      opened.push(targetPath);
    },
  });
  return { open, opened };
}

describe("open with default app", () => {
  it("opens documents, images and folders", async () => {
    const { open, opened } = createOpener({
      "/repo/report.html": {},
      "/repo/shot.PNG": {},
      "/repo/notes.md": {},
      "/Users/me/Downloads": { directory: true },
      "/repo/v1.2": { directory: true },
    });

    for (const input of [
      "/repo/report.html",
      "/repo/shot.PNG",
      "/repo/notes.md",
      "~/Downloads",
      "/repo/v1.2",
    ]) {
      await expect(open(input)).resolves.toEqual({ opened: true });
    }

    expect(opened).toEqual([
      "/repo/report.html",
      "/repo/shot.PNG",
      "/repo/notes.md",
      "/Users/me/Downloads",
      "/repo/v1.2",
    ]);
  });

  it("refuses anything outside the viewable types, on every platform", async () => {
    const paths = [
      // macOS
      "/repo/setup.command",
      "/repo/install.sh",
      "/repo/tool.py",
      "/repo/link.fileloc",
      "/repo/link.inetloc",
      "/repo/build",
      // Windows Script Host and shell types
      "/repo/run.js",
      "/repo/run.jse",
      "/repo/run.vbe",
      "/repo/run.wsf",
      "/repo/run.wsh",
      "/repo/page.hta",
      "/repo/screen.scr",
      "/repo/app.pif",
      "/repo/panel.cpl",
      "/repo/console.msc",
      "/repo/keys.reg",
      "/repo/site.url",
      "/repo/setup.exe",
      "/repo/run.bat",
    ];
    const { open, opened } = createOpener(Object.fromEntries(paths.map((p) => [p, {}])));

    for (const input of paths) {
      await expect(open(input)).resolves.toEqual({ opened: false, reason: "unsupported" });
    }

    expect(opened).toEqual([]);
  });

  it("refuses macOS bundles even though they are folders", async () => {
    const { open, opened } = createOpener({
      "/repo/Tool.app": { directory: true },
      "/repo/Installer.pkg": { directory: true },
    });

    await expect(open("/repo/Tool.app/")).resolves.toEqual({
      opened: false,
      reason: "unsupported",
    });
    await expect(open("/repo/Installer.pkg")).resolves.toEqual({
      opened: false,
      reason: "unsupported",
    });
    expect(opened).toEqual([]);
  });

  it("judges a symlink by what it points at", async () => {
    const { open, opened } = createOpener({
      "/repo/notes.md": { linksTo: "/repo/run.command" },
      "/repo/run.command": {},
      "/repo/latest.html": { linksTo: "/repo/out/report-3.html" },
      "/repo/out/report-3.html": {},
    });

    await expect(open("/repo/notes.md")).resolves.toEqual({
      opened: false,
      reason: "unsupported",
    });
    await expect(open("/repo/latest.html")).resolves.toEqual({ opened: true });
    expect(opened).toEqual(["/repo/out/report-3.html"]);
  });

  it("rejects relative, missing and non-string paths", async () => {
    const { open, opened } = createOpener({ "/repo/dangling.md": { linksTo: "/gone.md" } });

    await expect(open("repo/a.html")).rejects.toThrow("Only absolute local paths");
    await expect(open("/repo/missing.html")).rejects.toThrow("Path does not exist");
    await expect(open("/repo/dangling.md")).rejects.toThrow("Path does not exist");
    await expect(open(null)).rejects.toThrow("A path is required.");

    expect(opened).toEqual([]);
  });
});

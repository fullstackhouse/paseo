import { describe, expect, it } from "vitest";

import { createDefaultAppOpener } from "./open-with-default-app";

function createOpener(files: Record<string, { mode: number; isFile?: boolean }>) {
  const opened: string[] = [];
  const open = createDefaultAppOpener({
    platform: "darwin",
    expandHomePath: (targetPath) => targetPath.replace(/^~(?=\/|$)/, "/Users/me"),
    isAbsolutePath: (targetPath) => targetPath.startsWith("/"),
    stat: (targetPath) => {
      const file = files[targetPath];
      return file ? { mode: file.mode, isFile: () => file.isFile ?? true } : null;
    },
    openPath: async (targetPath) => {
      opened.push(targetPath);
    },
  });
  return { open, opened };
}

describe("open with default app", () => {
  it("opens a document and a folder", async () => {
    const { open, opened } = createOpener({
      "/repo/report.html": { mode: 0o644 },
      "/Users/me/Downloads": { mode: 0o755, isFile: false },
    });

    await expect(open("/repo/report.html")).resolves.toEqual({ opened: true });
    await expect(open("~/Downloads")).resolves.toEqual({ opened: true });

    expect(opened).toEqual(["/repo/report.html", "/Users/me/Downloads"]);
  });

  it("refuses files that would run instead of open", async () => {
    const { open, opened } = createOpener({
      "/repo/build": { mode: 0o755 },
      "/repo/setup.command": { mode: 0o644 },
      "/repo/Tool.app/": { mode: 0o755, isFile: false },
      "/repo/install.SH": { mode: 0o644 },
    });

    for (const input of [
      "/repo/build",
      "/repo/setup.command",
      "/repo/Tool.app/",
      "/repo/install.SH",
    ]) {
      await expect(open(input)).resolves.toEqual({ opened: false, reason: "executable" });
    }

    expect(opened).toEqual([]);
  });

  it("rejects relative, missing and non-string paths", async () => {
    const { open, opened } = createOpener({});

    await expect(open("repo/a.html")).rejects.toThrow("Only absolute local paths");
    await expect(open("/repo/missing.html")).rejects.toThrow("Path does not exist");
    await expect(open(null)).rejects.toThrow("A path is required.");

    expect(opened).toEqual([]);
  });
});

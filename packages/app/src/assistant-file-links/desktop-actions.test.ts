import { describe, expect, it } from "vitest";
import { planFileLinkDesktopOpen } from "./desktop-actions";

describe("planFileLinkDesktopOpen", () => {
  it("opens a workspace file with the workspace as the project", () => {
    expect(planFileLinkDesktopOpen({ path: "/repo/src/a.ts", workspaceRoot: "/repo/" })).toEqual({
      workspacePath: "/repo",
      filePath: "/repo/src/a.ts",
    });
  });

  it("opens a file outside the workspace next to its own folder", () => {
    expect(
      planFileLinkDesktopOpen({ path: "/tmp/report/index.html", workspaceRoot: "/repo" }),
    ).toEqual({ workspacePath: "/tmp/report", filePath: "/tmp/report/index.html" });
    expect(planFileLinkDesktopOpen({ path: "~/Downloads/x.html" })).toEqual({
      workspacePath: "~/Downloads",
      filePath: "~/Downloads/x.html",
    });
  });

  it("does not mistake a sibling folder with the same prefix for the workspace", () => {
    expect(planFileLinkDesktopOpen({ path: "/repo-two/a.ts", workspaceRoot: "/repo" })).toEqual({
      workspacePath: "/repo-two",
      filePath: "/repo-two/a.ts",
    });
  });

  it("drops a trailing slash from a folder link", () => {
    expect(planFileLinkDesktopOpen({ path: "/repo/bin/", workspaceRoot: "/repo" })).toEqual({
      workspacePath: "/repo",
      filePath: "/repo/bin",
    });
    expect(planFileLinkDesktopOpen({ path: "/bin" })).toEqual({
      workspacePath: "/",
      filePath: "/bin",
    });
  });
});

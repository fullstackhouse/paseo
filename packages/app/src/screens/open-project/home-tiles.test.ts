import { describe, expect, it } from "vitest";
import { resolveHomeTiles } from "./home-tiles";

describe("resolveHomeTiles", () => {
  it("leads with New workspace once a host has a project", () => {
    expect(resolveHomeTiles({ hasProjects: true, canPairDevice: false })).toEqual([
      "new-workspace",
      "add-project",
      "import-session",
      "setup-providers",
    ]);
  });

  it("shows only the setup tiles before any project exists", () => {
    expect(resolveHomeTiles({ hasProjects: false, canPairDevice: false })).toEqual([
      "add-project",
      "import-session",
      "setup-providers",
    ]);
  });

  it("ends with Pair device when this machine runs its own daemon", () => {
    expect(resolveHomeTiles({ hasProjects: true, canPairDevice: true })).toEqual([
      "new-workspace",
      "add-project",
      "import-session",
      "setup-providers",
      "pair-device",
    ]);
  });
});

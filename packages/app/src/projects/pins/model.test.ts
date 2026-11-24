import { describe, expect, it } from "vitest";
import { selectPinnedProjects, togglePinnedProject } from "./model";

describe("togglePinnedProject", () => {
  it("pins a project at the end", () => {
    expect(togglePinnedProject(["alpha"], "beta")).toEqual(["alpha", "beta"]);
  });

  it("unpins a pinned project", () => {
    expect(togglePinnedProject(["alpha", "beta"], "alpha")).toEqual(["beta"]);
  });
});

describe("selectPinnedProjects", () => {
  const projects = [{ viewKey: "alpha" }, { viewKey: "beta" }, { viewKey: "gamma" }];

  it("returns pinned projects in pin order", () => {
    expect(
      selectPinnedProjects({
        projects,
        pinnedViewKeys: ["gamma", "alpha"],
        matchesCategory: null,
      }),
    ).toEqual([{ viewKey: "gamma" }, { viewKey: "alpha" }]);
  });

  it("skips pins whose project is not in the sidebar", () => {
    expect(
      selectPinnedProjects({
        projects,
        pinnedViewKeys: ["missing", "beta"],
        matchesCategory: null,
      }),
    ).toEqual([{ viewKey: "beta" }]);
  });

  it("shows only pins in the selected category", () => {
    expect(
      selectPinnedProjects({
        projects,
        pinnedViewKeys: ["alpha", "beta", "gamma"],
        matchesCategory: (viewKey) => viewKey !== "beta",
      }),
    ).toEqual([{ viewKey: "alpha" }, { viewKey: "gamma" }]);
  });
});

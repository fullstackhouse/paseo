import { describe, expect, it } from "vitest";
import { noteExplicitExplorerReveal, takeExplicitExplorerReveal } from "./explicit-reveal";

describe("explicit Explorer reveals", () => {
  it("counts a reveal once, for the entry that follows it", () => {
    noteExplicitExplorerReveal("server:one", 1_000);
    expect(takeExplicitExplorerReveal("server:one", 2_000)).toBe(true);
    expect(takeExplicitExplorerReveal("server:one", 2_000)).toBe(false);
  });

  it("ignores a reveal from long before the entry and one in another workspace", () => {
    noteExplicitExplorerReveal("server:one", 1_000);
    expect(takeExplicitExplorerReveal("server:two", 2_000)).toBe(false);
    expect(takeExplicitExplorerReveal("server:one", 60_000)).toBe(false);
  });
});

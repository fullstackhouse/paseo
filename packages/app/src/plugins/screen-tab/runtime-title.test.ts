import { describe, expect, it } from "vitest";
import { nextPluginScreenTabState, readPluginScreenTabTitle } from "./runtime-title";

describe("plugin screen tab runtime title", () => {
  it("reads a stored title, defaulting the tooltip to the label", () => {
    expect(readPluginScreenTabTitle({ title: { label: " #12 Fix login " } })).toEqual({
      label: "#12 Fix login",
      tooltip: "#12 Fix login",
    });
    expect(readPluginScreenTabTitle(undefined)).toBeNull();
    expect(readPluginScreenTabTitle({ title: { label: "  " } })).toBeNull();
    expect(readPluginScreenTabTitle({ title: "Review" })).toBeNull();
  });

  it("writes a new title and skips one already stored", () => {
    const state = nextPluginScreenTabState(undefined, { label: "#12", tooltip: "Fix login" });
    expect(state).toEqual({ title: { label: "#12", tooltip: "Fix login" } });
    expect(nextPluginScreenTabState(state!, { label: "#12", tooltip: "Fix login" })).toBeNull();
    expect(nextPluginScreenTabState(state!, { label: "#13" })).toEqual({
      title: { label: "#13", tooltip: "#13" },
    });
  });

  it("clears a stored title and does nothing when there is none", () => {
    const state = { title: { label: "#12", tooltip: "#12" } };
    expect(nextPluginScreenTabState(state, null)).toEqual({});
    expect(nextPluginScreenTabState(state, { label: " " })).toEqual({});
    expect(nextPluginScreenTabState(undefined, null)).toBeNull();
  });
});

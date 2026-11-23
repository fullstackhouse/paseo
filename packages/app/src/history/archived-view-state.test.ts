import { describe, expect, it } from "vitest";
import { resolveArchivedViewState } from "./archived-view-state";

const base = { nothingSearched: false, isInitialLoad: false, isError: false, workspaces: [] };

describe("resolveArchivedViewState", () => {
  it("keeps the list on screen when a refresh fails", () => {
    expect(resolveArchivedViewState({ ...base, isError: true, workspaces: [{}] })).toBe("list");
  });

  it("shows the error only when there is nothing to keep", () => {
    expect(resolveArchivedViewState({ ...base, isError: true })).toBe("error");
  });

  it("claims nothing when no host could be asked", () => {
    expect(resolveArchivedViewState({ ...base, nothingSearched: true })).toBe("blank");
  });

  it("distinguishes a first load from an empty archive", () => {
    expect(resolveArchivedViewState({ ...base, isInitialLoad: true })).toBe("loading");
    expect(resolveArchivedViewState(base)).toBe("empty");
  });
});

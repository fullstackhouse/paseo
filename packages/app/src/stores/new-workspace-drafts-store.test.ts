import { beforeEach, describe, expect, it } from "vitest";
import { useDraftStore } from "@/stores/draft-store";
import type { DraftRecord } from "@/stores/draft-store/state";
import {
  selectListedNewWorkspaceDrafts,
  useNewWorkspaceDraftsStore,
} from "./new-workspace-drafts-store";

function record(text: string, updatedAt: number, lifecycle: DraftRecord["lifecycle"] = "active") {
  return { input: { text, attachments: [] }, lifecycle, updatedAt, version: 1 } as DraftRecord;
}

describe("selectListedNewWorkspaceDrafts", () => {
  it("lists drafts with text, newest first, previewing the first non-empty line", () => {
    const listed = selectListedNewWorkspaceDrafts(
      {
        a: { draftKey: "a", serverId: "s" },
        b: { draftKey: "b", draftId: "draft_b", serverId: "s" },
      },
      { a: record("older", 1), b: record("\n  fork question\nmore", 2) },
    );
    expect(listed.map((draft) => [draft.draftKey, draft.preview])).toEqual([
      ["b", "fork question"],
      ["a", "older"],
    ]);
  });

  it("leaves out sent, emptied and missing drafts", () => {
    const listed = selectListedNewWorkspaceDrafts(
      {
        sent: { draftKey: "sent", serverId: "s" },
        blank: { draftKey: "blank", serverId: "s" },
        missing: { draftKey: "missing", serverId: "s" },
      },
      { sent: record("hello", 1, "sent"), blank: record("   ", 1) },
    );
    expect(listed).toEqual([]);
  });
});

describe("useNewWorkspaceDraftsStore", () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} });
    useNewWorkspaceDraftsStore.setState({ entries: {}, revealedDraftKeys: {} });
  });

  it("drops entries whose draft is gone when it records another", () => {
    useDraftStore.setState({ drafts: { kept: record("still typing", 1) } });
    useNewWorkspaceDraftsStore.setState({
      entries: {
        kept: { draftKey: "kept", serverId: "s" },
        sent: { draftKey: "sent", serverId: "s" },
      },
    });

    useNewWorkspaceDraftsStore.getState().recordDraft({ draftKey: "new", serverId: "s" });

    expect(Object.keys(useNewWorkspaceDraftsStore.getState().entries).sort()).toEqual([
      "kept",
      "new",
    ]);
  });

  it("discarding clears the draft text and its entry", () => {
    useDraftStore.setState({ drafts: { a: record("bye", 1) } });
    useNewWorkspaceDraftsStore.getState().recordDraft({ draftKey: "a", serverId: "s" });

    useNewWorkspaceDraftsStore.getState().discardDraft("a");

    expect(useNewWorkspaceDraftsStore.getState().entries).toEqual({});
    const listed = selectListedNewWorkspaceDrafts(
      { a: { draftKey: "a", serverId: "s" } },
      useDraftStore.getState().drafts,
    );
    expect(listed).toEqual([]);
  });

  it("numbers newly listed drafts so newer ones sort above and older numbers never change", () => {
    const store = useNewWorkspaceDraftsStore.getState();
    store.revealDrafts(["newer", "older"]);
    store.revealDrafts(["newest", "newer", "older"]);
    expect(useNewWorkspaceDraftsStore.getState().revealedDraftKeys).toEqual({
      older: 1,
      newer: 2,
      newest: 3,
    });
  });
});

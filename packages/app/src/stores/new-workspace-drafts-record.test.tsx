/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useDraftStore } from "@/stores/draft-store";
import {
  useNewWorkspaceDraftsStore,
  useRecordNewWorkspaceDraft,
} from "./new-workspace-drafts-store";

const input = {
  draftKey: "new-workspace:draft:draft_a",
  draftId: "draft_a",
  serverId: "server",
  sourceDirectory: "/repo",
  project: null,
  forkSetup: null,
};

beforeEach(() => {
  useDraftStore.setState({ drafts: {} });
  useNewWorkspaceDraftsStore.setState({ entries: {}, revealedDraftKeys: {} });
});

it("lists the open draft again when you type after discarding it", () => {
  renderHook(() => useRecordNewWorkspaceDraft(input));
  const entries = () => Object.keys(useNewWorkspaceDraftsStore.getState().entries);
  expect(entries()).toEqual([]);

  act(() => useDraftStore.getState().editDraftText({ draftKey: input.draftKey, text: "first" }));
  expect(entries()).toEqual([input.draftKey]);

  act(() => useNewWorkspaceDraftsStore.getState().discardDraft(input.draftKey));
  expect(entries()).toEqual([]);

  act(() => useDraftStore.getState().editDraftText({ draftKey: input.draftKey, text: "again" }));
  expect(entries()).toEqual([input.draftKey]);
});

import { describe, expect, it } from "vitest";
import type { DraftRecord } from "@/stores/draft-store/state";
import type { WorkspaceLayout } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { workspaceHasUnsentDraft } from "./workspace-unsent-draft-core";

function layoutWithTabs(tabs: WorkspaceTab[]): WorkspaceLayout {
  return {
    root: {
      kind: "pane",
      pane: {
        id: "pane-1",
        tabIds: tabs.map((tab) => tab.tabId),
        focusedTabId: tabs[0]?.tabId ?? null,
        tabs,
      },
    },
    focusedPaneId: "pane-1",
  } as WorkspaceLayout;
}

function record(input: Partial<DraftRecord> & { text?: string }): DraftRecord {
  return {
    input: { text: input.text ?? "", attachments: input.input?.attachments ?? [] },
    lifecycle: input.lifecycle ?? "active",
    updatedAt: 1,
    version: 1,
  };
}

const agentTab: WorkspaceTab = {
  tabId: "agent-tab",
  target: { kind: "agent", agentId: "agent-1" },
  createdAt: 1,
};
const draftTab: WorkspaceTab = {
  tabId: "draft-tab",
  target: { kind: "draft", draftId: "draft-1" },
  createdAt: 1,
};

describe("workspaceHasUnsentDraft", () => {
  it("is true for text typed into an open agent's composer", () => {
    expect(
      workspaceHasUnsentDraft({
        serverId: "server-1",
        layout: layoutWithTabs([agentTab]),
        drafts: { "agent:server-1:agent-1": record({ text: "fix the" }) },
      }),
    ).toBe(true);
  });

  it("is true for text typed into an open new-chat tab", () => {
    expect(
      workspaceHasUnsentDraft({
        serverId: "server-1",
        layout: layoutWithTabs([draftTab]),
        drafts: { "draft:server-1:draft-1": record({ text: "add a" }) },
      }),
    ).toBe(true);
  });

  it("is true for an attachment with no text", () => {
    expect(
      workspaceHasUnsentDraft({
        serverId: "server-1",
        layout: layoutWithTabs([agentTab]),
        drafts: {
          "agent:server-1:agent-1": record({
            input: { text: "", attachments: [{ kind: "quote", id: "q-1", text: "quoted" }] },
          }),
        },
      }),
    ).toBe(true);
  });

  it("ignores whitespace, sent and abandoned drafts", () => {
    for (const draft of [
      record({ text: "  \n" }),
      record({ text: "done", lifecycle: "sent" }),
      record({ text: "gone", lifecycle: "abandoned" }),
    ]) {
      expect(
        workspaceHasUnsentDraft({
          serverId: "server-1",
          layout: layoutWithTabs([agentTab]),
          drafts: { "agent:server-1:agent-1": draft },
        }),
      ).toBe(false);
    }
  });

  it("ignores drafts of chats not open in the workspace or on another host", () => {
    expect(
      workspaceHasUnsentDraft({
        serverId: "server-1",
        layout: layoutWithTabs([agentTab]),
        drafts: {
          "agent:server-1:agent-2": record({ text: "elsewhere" }),
          "agent:server-2:agent-1": record({ text: "other host" }),
        },
      }),
    ).toBe(false);
  });

  it("is false without a layout", () => {
    expect(
      workspaceHasUnsentDraft({
        serverId: "server-1",
        layout: undefined,
        drafts: { "agent:server-1:agent-1": record({ text: "fix" }) },
      }),
    ).toBe(false);
  });
});

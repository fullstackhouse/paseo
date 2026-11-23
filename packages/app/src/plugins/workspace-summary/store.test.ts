import { describe, expect, it } from "vitest";
import { WorkspaceSummaryStore } from "./store";

const owner = {
  serverId: "s",
  pluginId: "paseo-asks",
  resolveText: (text: unknown) => String(text),
};

describe("WorkspaceSummaryStore", () => {
  it("groups items per workspace and keeps the array stable between unrelated changes", () => {
    const store = new WorkspaceSummaryStore();
    const one = store.add(owner, {
      id: "asks",
      workspaceId: "w1",
      title: "Asks",
      count: 1,
      needsYou: true,
    });
    store.add(owner, { id: "asks", workspaceId: "w2", title: "Asks" });
    const before = store.forWorkspace("s", "w1");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ itemId: "asks", count: 1, needsYou: true });

    store.add({ ...owner, pluginId: "other" }, { id: "x", workspaceId: "w2", title: "X" });
    expect(store.forWorkspace("s", "w1")).toBe(before);

    one.update({ count: 2, key: "ask-2" });
    expect(store.forWorkspace("s", "w1")[0]).toMatchObject({
      count: 2,
      key: "ask-2",
      needsYou: true,
    });
  });

  it("removes an item and ignores updates after removal", () => {
    const store = new WorkspaceSummaryStore();
    const item = store.add(owner, { id: "asks", workspaceId: "w", title: "Asks" });
    item.remove();
    item.update({ needsYou: true });
    expect(store.forWorkspace("s", "w")).toEqual([]);
  });

  it("rejects a duplicate item for the same workspace and a missing workspace", () => {
    const store = new WorkspaceSummaryStore();
    store.add(owner, { id: "asks", workspaceId: "w", title: "Asks" });
    expect(() => store.add(owner, { id: "asks", workspaceId: "w", title: "Asks" })).toThrow(
      /Duplicate/,
    );
    expect(() => store.add(owner, { id: "asks", workspaceId: " ", title: "Asks" })).toThrow(
      /workspace id/,
    );
  });
  it("keeps a valid work state and clears it on null", () => {
    const store = new WorkspaceSummaryStore();
    const item = store.add(owner, {
      id: "status",
      workspaceId: "w",
      title: "Status",
      workState: "working",
    });
    expect(store.forWorkspace("s", "w")[0]?.workState).toBe("working");
    item.update({ workState: "blocked" });
    expect(store.forWorkspace("s", "w")[0]?.workState).toBe("blocked");
    item.update({ workState: null });
    expect(store.forWorkspace("s", "w")[0]?.workState).toBeUndefined();
    item.update({ workState: "bogus" as never });
    expect(store.forWorkspace("s", "w")[0]?.workState).toBeUndefined();
  });

  it("keeps a well-formed status and clears a malformed one", () => {
    const store = new WorkspaceSummaryStore();
    const item = store.add(owner, {
      id: "status",
      workspaceId: "w",
      title: "Status",
      status: { state: "blocked", summary: " Needs approval ", now: "", goal: " ", updatedAt: 5 },
    });
    expect(store.forWorkspace("s", "w")[0]?.status).toEqual({
      state: "blocked",
      summary: "Needs approval",
      updatedAt: 5,
    });
    item.update({ status: { state: "working", goal: " Ship it ", summary: "x", updatedAt: 6 } });
    expect(store.forWorkspace("s", "w")[0]?.status?.goal).toBe("Ship it");
    item.update({ status: { state: "bogus", summary: "x", updatedAt: 1 } as never });
    expect(store.forWorkspace("s", "w")[0]?.status).toBeNull();
    item.update({ status: { state: "done", summary: "", updatedAt: 1 } });
    expect(store.forWorkspace("s", "w")[0]?.status).toBeNull();
  });

  it("keeps well-formed blockers on a blocked status only", () => {
    const store = new WorkspaceSummaryStore();
    const item = store.add(owner, {
      id: "status",
      workspaceId: "w",
      title: "Status",
      status: {
        state: "blocked",
        summary: "Waiting",
        updatedAt: 1,
        blockedBy: [
          {
            kind: "pr",
            label: " #42 Fix ",
            detail: "open · checks failing",
            url: "https://github.com/a/b/pull/42",
            tone: "danger",
          },
          { kind: "agent", label: "Migrate", agentId: "a1", workspaceId: "w2", tone: "bogus" },
          { kind: "other", label: "Bad link", url: "javascript:alert(1)" },
          { kind: "ticket", label: "Unknown kind" },
          { kind: "person", label: " " },
        ] as never,
      },
    });
    expect(store.forWorkspace("s", "w")[0]?.status?.blockedBy).toEqual([
      {
        kind: "pr",
        label: "#42 Fix",
        detail: "open · checks failing",
        url: "https://github.com/a/b/pull/42",
        tone: "danger",
      },
      { kind: "agent", label: "Migrate", agentId: "a1", workspaceId: "w2" },
      { kind: "other", label: "Bad link" },
    ]);
    item.update({
      status: {
        state: "working",
        summary: "x",
        updatedAt: 2,
        blockedBy: [{ kind: "person", label: "Mo" }],
      },
    });
    expect(store.forWorkspace("s", "w")[0]?.status?.blockedBy).toBeUndefined();
  });

  it("drops entries without an id or title", () => {
    const store = new WorkspaceSummaryStore();
    store.add(owner, {
      id: "asks",
      workspaceId: "w",
      title: "Asks",
      entries: [
        { id: "A4", title: "Backoff?", detail: " Decision " },
        { id: "", title: "No id" },
        { id: "A5", title: " " },
      ],
    });
    expect(store.forWorkspace("s", "w")[0]?.entries).toEqual([
      { id: "A4", title: "Backoff?", detail: "Decision" },
    ]);
  });

  it("keeps the first entry when ids repeat", () => {
    const store = new WorkspaceSummaryStore();
    store.add(owner, {
      id: "asks",
      workspaceId: "w",
      title: "Asks",
      entries: [
        { id: "A1", title: "First" },
        { id: "A2", title: "Other" },
        { id: " A1 ", title: "Repeat" },
      ],
    });
    expect(store.forWorkspace("s", "w")[0]?.entries).toEqual([
      { id: "A1", title: "First" },
      { id: "A2", title: "Other" },
    ]);
  });

  it("keeps the entry component across updates", () => {
    const store = new WorkspaceSummaryStore();
    const EntryComponent = () => null;
    const item = store.add(owner, { id: "asks", workspaceId: "w", title: "Asks", EntryComponent });
    item.update({ count: 1, EntryComponent: () => null } as never);
    expect(store.forWorkspace("s", "w")[0]?.EntryComponent).toBe(EntryComponent);
  });
});

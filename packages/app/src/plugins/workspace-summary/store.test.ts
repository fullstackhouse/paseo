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
});

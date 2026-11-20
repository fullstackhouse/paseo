import { describe, expect, it } from "vitest";
import {
  createLastWorkspaceSelectionStore,
  type ActiveWorkspaceSelection,
  type LastWorkspaceSelectionStorage,
} from "./last-workspace-selection";

class DelayedWorkspaceSelectionStorage implements LastWorkspaceSelectionStorage {
  private finishRead: (value: string | null) => void = () => {};
  private readonly pendingRead = new Promise<string | null>((resolve) => {
    this.finishRead = resolve;
  });
  private saved: string | null = null;

  read(): Promise<string | null> {
    return this.pendingRead;
  }

  async write(value: string): Promise<void> {
    this.saved = value;
  }

  private cleared = false;

  async clear(): Promise<void> {
    this.saved = null;
    this.cleared = true;
  }

  wasCleared(): boolean {
    return this.cleared;
  }

  finishHydrationWith(selection: ActiveWorkspaceSelection | null) {
    this.finishRead(selection ? JSON.stringify(selection) : null);
  }

  getSavedSelection(): ActiveWorkspaceSelection | null {
    if (!this.saved) return null;
    const parsed: unknown = JSON.parse(this.saved);
    if (!parsed || typeof parsed !== "object") return null;
    return this.saved ? JSON.parse(this.saved) : null;
  }
}

describe("last workspace selection", () => {
  it("hydrates the saved workspace selection", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();

    storage.finishHydrationWith({ serverId: "server-saved", workspaceId: "workspace-saved" });
    await hydration;

    expect(store.getSelection()).toEqual({
      serverId: "server-saved",
      workspaceId: "workspace-saved",
    });
    expect(store.isHydrated()).toBe(true);
  });

  it("keeps a newer workspace selection when storage hydration finishes late", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();

    store.remember({ serverId: "server-new", workspaceId: "workspace-new" });
    storage.finishHydrationWith({ serverId: "server-old", workspaceId: "workspace-old" });
    await hydration;

    expect(store.getSelection()).toEqual({
      serverId: "server-new",
      workspaceId: "workspace-new",
    });
    expect(storage.getSavedSelection()).toEqual({
      serverId: "server-new",
      workspaceId: "workspace-new",
    });
  });

  it("forgets the restored selection when it is still the current one", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();
    storage.finishHydrationWith({ serverId: "server-saved", workspaceId: "workspace-saved" });
    await hydration;

    const forgotten = store.forgetRestored({
      serverId: "server-saved",
      workspaceId: "workspace-saved",
    });

    expect(forgotten).toBe(true);
    expect(store.getSelection()).toBeNull();
    expect(store.getRestoredSelection()).toBeNull();
    await Promise.resolve();
    expect(storage.wasCleared()).toBe(true);
  });

  it("keeps a selection the user navigated to in this session", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();
    storage.finishHydrationWith({ serverId: "server-saved", workspaceId: "workspace-saved" });
    await hydration;

    store.remember({ serverId: "server-saved", workspaceId: "workspace-new" });
    store.remember({ serverId: "server-saved", workspaceId: "workspace-saved" });
    const forgotten = store.forgetRestored({
      serverId: "server-saved",
      workspaceId: "workspace-saved",
    });

    expect(forgotten).toBe(false);
    expect(store.getRestoredSelection()).toBeNull();
    expect(store.getSelection()).toEqual({
      serverId: "server-saved",
      workspaceId: "workspace-saved",
    });
  });

  it("does not forget a different workspace than the restored one", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();
    storage.finishHydrationWith({ serverId: "server-saved", workspaceId: "workspace-saved" });
    await hydration;

    expect(store.forgetRestored({ serverId: "server-saved", workspaceId: "workspace-other" })).toBe(
      false,
    );
    expect(store.getSelection()).toEqual({
      serverId: "server-saved",
      workspaceId: "workspace-saved",
    });
  });
});

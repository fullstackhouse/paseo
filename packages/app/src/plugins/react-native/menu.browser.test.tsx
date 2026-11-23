import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MenuEntry } from "@getpaseo/plugin/client/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Menu, visibleMenuEntries } from "./menu";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function mount(node: ReactNode): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function query(testID: string): HTMLElement | null {
  const found = document.querySelector(`[data-testid="${testID}"]`);
  return found instanceof HTMLElement ? found : null;
}

function element(testID: string): HTMLElement {
  const found = query(testID);
  if (!found) throw new Error(`${testID} did not render`);
  return found;
}

const TRIGGER = { icon: "Ellipsis", accessibilityLabel: "Ask actions" };
const LABELLED_TRIGGER = { ...TRIGGER, label: "Actions" };

describe("plugin Menu", () => {
  beforeEach(async () => {
    await page.viewport(1280, 900);
  });

  it("opens a popover from its trigger and runs the chosen row once the menu closes", () => {
    const markDone = vi.fn();
    const drop = vi.fn();
    mount(
      <Menu
        testID="ask-menu"
        trigger={TRIGGER}
        items={[
          { id: "done", label: "Mark done", icon: "Check", onSelect: markDone },
          { id: "sep", separator: true },
          { id: "drop", label: "Drop ask", icon: "Trash2", destructive: true, onSelect: drop },
        ]}
      />,
    );

    const trigger = element("ask-menu");
    expect(trigger.getAttribute("aria-label")).toBe("Ask actions");
    expect(query("ask-menu-content")).toBeNull();

    act(() => trigger.click());
    expect(element("ask-menu-done").textContent).toBe("Mark done");
    expect(element("ask-menu-drop").textContent).toBe("Drop ask");

    act(() => element("ask-menu-drop").click());
    expect(drop).toHaveBeenCalledTimes(1);
    expect(markDone).not.toHaveBeenCalled();
    expect(query("ask-menu-content")).toBeNull();
  });

  it("ignores a disabled row", () => {
    const onSelect = vi.fn();
    mount(
      <Menu
        testID="ask-menu"
        trigger={TRIGGER}
        items={[{ id: "chat", label: "Open chat", disabled: true, onSelect }]}
      />,
    );

    act(() => element("ask-menu").click());
    act(() => element("ask-menu-chat").click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not open when disabled", () => {
    mount(
      <Menu
        testID="ask-menu"
        disabled
        trigger={TRIGGER}
        items={[{ id: "done", label: "Mark done", onSelect: vi.fn() }]}
      />,
    );

    act(() => element("ask-menu").click());
    expect(query("ask-menu-done")).toBeNull();
  });

  it("draws the trigger label beside its icon", () => {
    mount(
      <Menu
        testID="ask-menu"
        trigger={LABELLED_TRIGGER}
        items={[{ id: "done", label: "Mark done", onSelect: vi.fn() }]}
      />,
    );

    expect(element("ask-menu").textContent).toBe("Actions");
  });
});

describe("visibleMenuEntries", () => {
  it("drops leading, trailing, and consecutive separators", () => {
    const item = (id: string): MenuEntry => ({ id, label: id, onSelect: vi.fn() });
    const separator = (id: string): MenuEntry => ({ id, separator: true });
    const entries = visibleMenuEntries([
      separator("a"),
      item("one"),
      separator("b"),
      separator("c"),
      item("two"),
      separator("d"),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["one", "b", "two"]);
  });
});

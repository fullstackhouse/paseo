import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTitleIcon } from "./workspace-title-icon";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function mount(element: ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  mounted.push({ root, container });
  return container;
}

describe("WorkspaceTitleIcon", () => {
  it("draws a known Lucide icon", () => {
    const container = mount(<WorkspaceTitleIcon name="Inbox" />);
    expect(container.querySelector('[data-testid="sidebar-row-title-icon"]')).not.toBeNull();
  });

  it("leaves no wrapper for an unknown name or no icon, so the title stays in line", () => {
    expect(mount(<WorkspaceTitleIcon name="Inboxx" />).childElementCount).toBe(0);
    expect(mount(<WorkspaceTitleIcon name={null} />).childElementCount).toBe(0);
  });
});

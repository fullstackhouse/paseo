import { render } from "@testing-library/react";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import TerminalEmulator from "./terminal-emulator";

vi.mock("expo/dom", () => ({ useDOMImperativeHandle: () => {} }));

const PADDING = 8;
const THEME = { background: "#0b0b0b", foreground: "#e6e6e6" };

function measure(container: HTMLElement) {
  const root = container.querySelector("[data-terminal-scrollbar-root]");
  const screen = root?.querySelector(".xterm-screen");
  const terminal = window.__paseoTerminal as { rows: number; cols: number } | undefined;
  if (!root || !screen || !terminal) {
    throw new Error("Terminal did not mount");
  }
  const outer = root.getBoundingClientRect();
  const grid = screen.getBoundingClientRect();
  return {
    rows: terminal.rows,
    left: grid.left - outer.left,
    top: grid.top - outer.top,
    right: outer.right - grid.right,
    bottom: outer.bottom - grid.bottom,
    rowHeight: grid.height / terminal.rows,
    outerHeight: outer.height,
  };
}

it.each([360, 361, 366, 372, 377])(
  "keeps the grid inside the padding in a %ipx tall pane",
  async (height) => {
    await page.viewport(800, 600);
    const pane = document.createElement("div");
    pane.style.cssText = `width:560px;height:${height}px`;
    // The runtime sets its root's parent to 100%, so the size lives one level up.
    const container = pane.appendChild(document.createElement("div"));
    document.body.appendChild(pane);
    const view = render(
      <TerminalEmulator
        ref={null}
        streamKey="padding"
        supportsTerminalInputModeReplay
        xtermTheme={THEME}
        scrollbackLines={1000}
        characterWidths="graphemes"
      />,
      { container },
    );
    // The runtime refits a few times after mount.
    await new Promise((resolve) => setTimeout(resolve, 2_600));

    const size = measure(view.container);
    expect(size.outerHeight).toBe(height);
    expect(size.left).toBe(PADDING);
    expect(size.top).toBe(PADDING);
    expect(size.right).toBeGreaterThanOrEqual(PADDING);
    expect(size.bottom).toBeGreaterThanOrEqual(PADDING);
    expect(size.rows).toBe(Math.floor((height - 2 * PADDING) / size.rowHeight));
    view.unmount();
    pane.remove();
  },
);

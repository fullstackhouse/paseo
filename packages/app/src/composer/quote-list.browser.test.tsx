import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteComposerAttachment } from "@/attachments/types";
import { ComposerQuoteList } from "./quote-list";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const QUOTES: QuoteComposerAttachment[] = [
  { kind: "quote", id: "quote-1", text: "first cited line" },
  { kind: "quote", id: "quote-2", text: "second cited line" },
];

interface Mounted {
  root: Root;
  container: HTMLDivElement;
  focusChanges: boolean[];
  render: (quotes: readonly QuoteComposerAttachment[]) => void;
}

const mounted: Mounted[] = [];

function ignore(): void {}

let recordFocusChange: (focused: boolean) => void = ignore;
function handleFocusChange(focused: boolean): void {
  recordFocusChange(focused);
}

function mount(quotes: readonly QuoteComposerAttachment[]): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const focusChanges: boolean[] = [];
  recordFocusChange = (focused) => focusChanges.push(focused);
  const render = (next: readonly QuoteComposerAttachment[]) =>
    act(() =>
      root.render(
        <ComposerQuoteList
          quotes={next}
          disabled={false}
          onChangeQuote={ignore}
          onRemove={ignore}
          onFocusMessage={ignore}
          onFocusChange={handleFocusChange}
        />,
      ),
    );
  render(quotes);
  const entry = { root, container, focusChanges, render };
  mounted.push(entry);
  return entry;
}

function fields(container: HTMLElement, testID: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="${testID}"]`));
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("ComposerQuoteList focus", () => {
  it("reports focus while the caret is in any quote or comment field", () => {
    const { container, focusChanges } = mount(QUOTES);
    const [firstComment, secondComment] = fields(container, "composer-quote-comment");
    const [firstQuote] = fields(container, "composer-quote-text");

    act(() => firstComment.focus());
    expect(focusChanges).toEqual([true]);

    // Moving between fields inside the list keeps the list focused.
    act(() => firstQuote.focus());
    act(() => secondComment.focus());
    expect(focusChanges.at(-1)).toBe(true);

    act(() => secondComment.blur());
    expect(focusChanges.at(-1)).toBe(false);
  });

  it("clears focus when the focused quote is removed", () => {
    const { container, focusChanges, render } = mount(QUOTES);
    const [, secondComment] = fields(container, "composer-quote-comment");

    act(() => secondComment.focus());
    expect(focusChanges).toEqual([true]);

    render(QUOTES.slice(0, 1));
    expect(focusChanges.at(-1)).toBe(false);
  });
});

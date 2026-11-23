import { describe, expect, it } from "vitest";
import { prependComposerQuotes } from "@/composer/attachments/submit";
import { splitQuotedMessage } from "./leading-quotes";

describe("splitQuotedMessage", () => {
  it("leaves a message that doesn't open with a quote as one text segment", () => {
    expect(splitQuotedMessage("  plain text\n> later quote")).toEqual([
      { kind: "text", line: 0, text: "  plain text\n> later quote" },
    ]);
  });

  it("reads back each quote with the comment written under it, in order", () => {
    const text = prependComposerQuotes("anything else?", [
      { kind: "quote", id: "a", text: "First line\n\nSecond paragraph", comment: "why?" },
      { kind: "quote", id: "b", text: "- a list item" },
      { kind: "quote", id: "c", text: "third", comment: "and this\non two lines" },
    ]);

    expect(text).toBe(
      "> First line\n>\n> Second paragraph\n\nwhy?\n\n> - a list item\n\n> third\n\nand this\non two lines\n\nanything else?",
    );
    expect(splitQuotedMessage(text)).toEqual([
      { kind: "quote", line: 0, text: "First line\n\nSecond paragraph" },
      { kind: "text", line: 4, text: "why?" },
      { kind: "quote", line: 6, text: "- a list item" },
      { kind: "quote", line: 8, text: "third" },
      { kind: "text", line: 10, text: "and this\non two lines\n\nanything else?" },
    ]);
  });

  it("handles a message that is only a quote", () => {
    expect(splitQuotedMessage("> just this")).toEqual([
      { kind: "quote", line: 0, text: "just this" },
    ]);
  });
});

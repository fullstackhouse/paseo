import { describe, expect, it } from "vitest";
import { prependComposerQuotes } from "@/composer/attachments/submit";
import { splitLeadingQuotes } from "./leading-quotes";

describe("splitLeadingQuotes", () => {
  it("leaves a message without quotes untouched", () => {
    expect(splitLeadingQuotes("  plain text\n> later quote")).toEqual({
      quotes: [],
      body: "  plain text\n> later quote",
    });
  });

  it("reads back what Cite prepends, one quote per cited fragment", () => {
    const text = prependComposerQuotes("why is that?", [
      { kind: "quote", id: "a", text: "First line\n\nSecond paragraph" },
      { kind: "quote", id: "b", text: "- a list item" },
    ]);

    expect(text).toBe("> First line\n>\n> Second paragraph\n\n> - a list item\n\nwhy is that?");
    expect(splitLeadingQuotes(text)).toEqual({
      quotes: [
        { line: 0, text: "First line\n\nSecond paragraph" },
        { line: 4, text: "- a list item" },
      ],
      body: "why is that?",
    });
  });

  it("handles a message that is only a quote", () => {
    expect(splitLeadingQuotes("> just this")).toEqual({
      quotes: [{ line: 0, text: "just this" }],
      body: "",
    });
  });
});

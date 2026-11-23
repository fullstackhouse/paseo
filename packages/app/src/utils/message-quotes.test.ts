import { describe, expect, it } from "vitest";
import { appendQuoteToText } from "@/composer/quote-text";
import { splitQuotedMessage } from "./message-quotes";

describe("appendQuoteToText", () => {
  it("quotes each line and leaves an empty line under the quote for the comment", () => {
    expect(appendQuoteToText("", "First line\n\nSecond paragraph")).toBe(
      "> First line\n>\n> Second paragraph\n\n",
    );
  });

  it("adds the quote after what was already typed", () => {
    expect(appendQuoteToText("> one\n\nwhy?\n", "two")).toBe("> one\n\nwhy?\n\n> two\n\n");
  });

  it("ignores an empty selection", () => {
    expect(appendQuoteToText("hi", "  \n ")).toBe("hi");
  });
});

describe("splitQuotedMessage", () => {
  it("leaves a message without quotes untouched", () => {
    expect(splitQuotedMessage("  plain text\nmore")).toEqual([
      { kind: "text", line: 0, text: "  plain text\nmore" },
    ]);
  });

  it("reads back each cited quote with the comment written under it, in order", () => {
    const text = ["- a list item", "third"].reduce(
      (message, quote) => appendQuoteToText(message, quote),
      "hey,\n\n" + appendQuoteToText("", "First line\n\nSecond paragraph") + "why?",
    );

    expect(splitQuotedMessage(`${text}and this\non two lines`)).toEqual([
      { kind: "text", line: 0, text: "hey," },
      { kind: "quote", line: 2, text: "First line\n\nSecond paragraph" },
      { kind: "text", line: 6, text: "why?" },
      { kind: "quote", line: 8, text: "- a list item" },
      { kind: "quote", line: 10, text: "third" },
      { kind: "text", line: 12, text: "and this\non two lines" },
    ]);
  });

  it("keeps > lines inside a code fence as text", () => {
    expect(splitQuotedMessage("```\n> not a quote\n```")).toEqual([
      { kind: "text", line: 0, text: "```\n> not a quote\n```" },
    ]);
  });
});

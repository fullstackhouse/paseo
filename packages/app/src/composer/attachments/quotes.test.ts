import { describe, expect, it } from "vitest";
import { prependComposerQuotes, splitComposerAttachmentsForSubmit } from "./submit";

describe("composer quotes", () => {
  it("keeps the text as typed when nothing was cited", () => {
    expect(prependComposerQuotes("  hello ", [])).toBe("  hello ");
  });

  it("sends a quote with no comment and no typed text as the quote alone", () => {
    expect(prependComposerQuotes("  ", [{ kind: "quote", id: "a", text: "cited" }])).toBe(
      "> cited",
    );
  });

  it("puts each comment right under its quote", () => {
    expect(
      prependComposerQuotes("", [
        { kind: "quote", id: "a", text: "one", comment: " first " },
        { kind: "quote", id: "b", text: "two", comment: "second" },
      ]),
    ).toBe("> one\n\nfirst\n\n> two\n\nsecond");
  });

  it("still sends a comment whose quote was cleared, as plain text", () => {
    expect(
      prependComposerQuotes("and the rest", [
        { kind: "quote", id: "a", text: "  ", comment: "this part" },
        { kind: "quote", id: "b", text: "two" },
      ]),
    ).toBe("this part\n\n> two\n\nand the rest");
  });

  it("does not send quotes as attachments", () => {
    expect(splitComposerAttachmentsForSubmit([{ kind: "quote", id: "a", text: "cited" }])).toEqual({
      images: [],
      attachments: [],
    });
  });
});

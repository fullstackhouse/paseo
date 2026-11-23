import { describe, expect, it } from "vitest";
import { prependComposerQuotes, splitComposerAttachmentsForSubmit } from "./submit";

describe("composer quotes", () => {
  it("keeps the text as typed when nothing was cited", () => {
    expect(prependComposerQuotes("  hello ", [])).toBe("  hello ");
  });

  it("sends a quote with no typed text as the quote alone", () => {
    expect(prependComposerQuotes("  ", [{ kind: "quote", id: "a", text: "cited" }])).toBe(
      "> cited",
    );
  });

  it("does not send quotes as attachments", () => {
    expect(splitComposerAttachmentsForSubmit([{ kind: "quote", id: "a", text: "cited" }])).toEqual({
      images: [],
      attachments: [],
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  applyChangeRequestMentionReplacement,
  filterChangeRequestMentionCandidates,
  findActiveChangeRequestMention,
  mergeChangeRequestMentionCandidates,
} from "./change-request-mention-autocomplete";

function mentionAtEnd(text: string) {
  return findActiveChangeRequestMention({ text, cursorIndex: text.length });
}

describe("findActiveChangeRequestMention", () => {
  it("opens on a bare # at the start of the text", () => {
    expect(mentionAtEnd("#")).toEqual({ start: 0, end: 1, query: "" });
  });

  it("opens after whitespace or an opening bracket", () => {
    expect(mentionAtEnd("see #12")).toEqual({ start: 4, end: 7, query: "12" });
    expect(mentionAtEnd("fixed (#4")).toEqual({ start: 7, end: 9, query: "4" });
    expect(mentionAtEnd("line one\n#fix")).toEqual({ start: 9, end: 13, query: "fix" });
  });

  it("stays closed when # is part of a word or URL", () => {
    expect(mentionAtEnd("C#")).toBeNull();
    expect(mentionAtEnd("https://example.com/page#section")).toBeNull();
  });

  it("closes once the query has whitespace, as in a Markdown heading", () => {
    expect(mentionAtEnd("# Heading")).toBeNull();
    expect(mentionAtEnd("#12 done")).toBeNull();
  });

  it("uses the cursor, not the end of the text", () => {
    const text = "see #12 and more";
    expect(findActiveChangeRequestMention({ text, cursorIndex: 7 })).toEqual({
      start: 4,
      end: 7,
      query: "12",
    });
  });
});

describe("applyChangeRequestMentionReplacement", () => {
  it("replaces the typed query with the number and a trailing space", () => {
    const text = "look at #12";
    const mention = mentionAtEnd(text)!;
    expect(applyChangeRequestMentionReplacement({ text, mention, reference: "#1234" })).toBe(
      "look at #1234 ",
    );
  });

  it("keeps the text after the cursor without doubling a space", () => {
    const text = "look at #1 please";
    const mention = findActiveChangeRequestMention({ text, cursorIndex: 10 })!;
    expect(applyChangeRequestMentionReplacement({ text, mention, reference: "!17" })).toBe(
      "look at !17 please",
    );
  });
});

describe("filterChangeRequestMentionCandidates", () => {
  const candidates = [
    { number: 120, title: "Add dark mode", headRefName: "feat/dark-mode" },
    { number: 12, title: "Fix login redirect", headRefName: "fix/login" },
    { number: 7, title: "Bump dependencies", headRefName: "chore/deps" },
  ];

  it("keeps every candidate in order for an empty query", () => {
    expect(filterChangeRequestMentionCandidates(candidates, "")).toEqual(candidates);
  });

  it("matches a number query by number prefix, exact number first", () => {
    expect(
      filterChangeRequestMentionCandidates(candidates, "12").map((item) => item.number),
    ).toEqual([12, 120]);
  });

  it("matches a text query against the title and branch", () => {
    expect(
      filterChangeRequestMentionCandidates(candidates, "login").map((item) => item.number),
    ).toEqual([12]);
    expect(
      filterChangeRequestMentionCandidates(candidates, "deps").map((item) => item.number),
    ).toEqual([7]);
  });
});

describe("mergeChangeRequestMentionCandidates", () => {
  it("joins lists and keeps the first entry for a repeated number", () => {
    const recent = [
      { number: 12, title: "Fix login redirect" },
      { number: 7, title: "Bump dependencies" },
    ];
    const lookedUp = [
      { number: 7, title: "Bump dependencies (stale copy)" },
      { number: 3, title: "Old merged change" },
    ];
    expect(mergeChangeRequestMentionCandidates([recent, lookedUp])).toEqual([
      { number: 12, title: "Fix login redirect" },
      { number: 7, title: "Bump dependencies" },
      { number: 3, title: "Old merged change" },
    ]);
  });
});

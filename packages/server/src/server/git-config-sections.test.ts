import { expect, test } from "vitest";
import { changedGitConfigSections, parseGitConfigSections } from "./git-config-sections.js";

const BASE = `[core]
\trepositoryformatversion = 0
\tbare = false
[remote "origin"]
\turl = git@example.com:acme/app.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
\tmerge = refs/heads/main
`;

test("attributes a push -u config write to that branch's section", () => {
  const next = `${BASE}[branch "feature/x"]\n\tremote = origin\n\tmerge = refs/heads/feature/x\n`;

  expect(
    changedGitConfigSections(parseGitConfigSections(BASE), parseGitConfigSections(next)),
  ).toEqual([{ name: "branch", subsection: "feature/x" }]);
});

test("ignores comments and whitespace, and reports other sections as written", () => {
  const next = BASE.replace("[core]", "# a comment\n[CORE]  ").replace(
    "bare = false",
    "bare = false\n\texcludesFile = ~/.gitignore",
  );

  expect(
    changedGitConfigSections(parseGitConfigSections(BASE), parseGitConfigSections(next)),
  ).toEqual([{ name: "core", subsection: null }]);
});

test("reads the deprecated dotted section form and same-line keys", () => {
  const sections = parseGitConfigSections("[branch.Main] remote = origin\n");

  expect([...sections.entries()]).toEqual([["branch\u0000main", "remote = origin"]]);
});

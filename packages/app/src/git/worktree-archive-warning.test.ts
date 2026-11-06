import { describe, expect, it } from "vitest";

import {
  buildWorktreeArchiveConfirmationMessage,
  buildWorktreeArchiveRiskReasons,
  toWorktreeArchiveRisk,
} from "@/git/worktree-archive-warning";

describe("workspace archive warning for worktree backing", () => {
  it("does not require a confirmation for clean and pushed worktrees", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "feature",
        isDirty: false,
        aheadOfOrigin: 0,
        diffStat: null,
      }),
    ).toBeNull();
  });

  it("explains uncommitted line changes", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: true,
        aheadOfOrigin: 0,
        diffStat: { additions: 12, deletions: 1 },
      }),
    ).toEqual(["Uncommitted changes (12 added lines, 1 deleted line)"]);
  });

  it("treats nonzero diff stats as dirty when dirty state is missing", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: undefined,
        aheadOfOrigin: 0,
        diffStat: { additions: 4, deletions: 0 },
      }),
    ).toEqual(["Uncommitted changes (4 added lines)"]);
  });

  it("explains unpushed commits", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: false,
        aheadOfOrigin: 2,
        diffStat: null,
      }),
    ).toEqual(["2 unpushed commits"]);
  });

  it("explains an open pull request", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: false,
        aheadOfOrigin: 0,
        diffStat: null,
        pullRequest: { number: 42, state: "open", forge: "github" },
      }),
    ).toEqual(["Open pull request #42"]);
  });

  it("names an open GitLab change request a merge request", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: false,
        aheadOfOrigin: 0,
        diffStat: null,
        pullRequest: { number: 7, state: "open", forge: "gitlab" },
      }),
    ).toEqual(["Open merge request !7"]);
  });

  it("does not require a confirmation for a merged or closed pull request", () => {
    for (const state of ["merged", "closed"] as const) {
      expect(
        buildWorktreeArchiveConfirmationMessage({
          workspaceName: "feature",
          isDirty: false,
          aheadOfOrigin: 0,
          diffStat: null,
          pullRequest: { number: 42, state, forge: "github" },
        }),
      ).toBeNull();
    }
  });

  it("includes every archive risk in the confirmation copy", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "risky-feature",
        isDirty: true,
        aheadOfOrigin: 1,
        diffStat: { additions: 1, deletions: 3 },
      }),
    ).toBe("Uncommitted changes (1 added line, 3 deleted lines)\n1 unpushed commit");
  });

  it("maps archive workspace fields into the shared worktree risk shape", () => {
    expect(
      toWorktreeArchiveRisk({
        archiveHasUncommittedChanges: true,
        archiveUnpushedCommitCount: 3,
        diffStat: { additions: 2, deletions: 1 },
        prHint: { number: 42, state: "open", forge: "github" },
      }),
    ).toEqual({
      isDirty: true,
      aheadOfOrigin: 3,
      diffStat: { additions: 2, deletions: 1 },
      pullRequest: { number: 42, state: "open", forge: "github" },
    });
  });
});

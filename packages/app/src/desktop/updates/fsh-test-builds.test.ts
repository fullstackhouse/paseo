import { describe, expect, it } from "vitest";
import { formatTestBuildLabel, parseFshTestBuildsInfo } from "./fsh-test-builds";

const PR_BUILD = {
  tag: "fsh-pr12-def5678",
  pr: 12,
  branch: "feat/thing",
  sha: "def5678",
  publishedAt: "2026-11-20T10:00:00Z",
};

describe("parseFshTestBuildsInfo", () => {
  it("reads what the desktop reports and drops malformed builds", () => {
    expect(
      parseFshTestBuildsInfo({
        installedTag: "fsh-pr12-def5678",
        installedTestBuild: PR_BUILD,
        testBuilds: [PR_BUILD, { tag: 3 }, null],
        errorMessage: null,
      }),
    ).toEqual({
      installedTag: "fsh-pr12-def5678",
      installedTestBuild: PR_BUILD,
      testBuilds: [PR_BUILD],
      errorMessage: null,
    });
  });

  it("is null for a desktop that isn't an FSH build", () => {
    expect(parseFshTestBuildsInfo(null)).toBeNull();
    expect(parseFshTestBuildsInfo({})).toBeNull();
  });
});

describe("formatTestBuildLabel", () => {
  it("names the PR, branch and commit it has", () => {
    expect(formatTestBuildLabel(PR_BUILD)).toBe("PR #12 · feat/thing · def5678");
    expect(
      formatTestBuildLabel({ ...PR_BUILD, pr: null, branch: "fsh-rebase-v0.17.1", sha: "4d2a5d0" }),
    ).toBe("fsh-rebase-v0.17.1 · 4d2a5d0");
    expect(formatTestBuildLabel({ ...PR_BUILD, pr: null, branch: null })).toBe("def5678");
  });
});

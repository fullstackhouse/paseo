import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";

import {
  buildGitSyncAccessibilityLabel,
  getGitSyncCounts,
  getGitSyncNextStep,
  getGitSyncUpstreamLabel,
  hasGitSyncDetails,
} from "./sync-summary";

const t = i18n.t.bind(i18n);

describe("git sync summary", () => {
  it("counts ahead and behind commits", () => {
    expect(getGitSyncCounts({ aheadOfOrigin: 1, behindOfOrigin: 327 })).toEqual({
      ahead: 1,
      behind: 327,
    });
    expect(getGitSyncCounts({ aheadOfOrigin: 0, behindOfOrigin: null })).toBeNull();
  });

  it("has details for uncommitted work or a diverged branch, not a clean in-sync one", () => {
    expect(hasGitSyncDetails({ isDirty: true, aheadOfOrigin: 0, behindOfOrigin: 0 })).toBe(true);
    expect(hasGitSyncDetails({ isDirty: false, aheadOfOrigin: 1, behindOfOrigin: 0 })).toBe(true);
    expect(hasGitSyncDetails({ isDirty: false, aheadOfOrigin: 0, behindOfOrigin: 0 })).toBe(false);
  });

  it("picks the same next step as the header's primary action", () => {
    expect(getGitSyncNextStep({ isDirty: true, aheadOfOrigin: 1, behindOfOrigin: 3 })).toBe(
      "commit",
    );
    expect(getGitSyncNextStep({ aheadOfOrigin: 1, behindOfOrigin: 3 })).toBe("pullThenPush");
    expect(getGitSyncNextStep({ aheadOfOrigin: 0, behindOfOrigin: 3 })).toBe("pull");
    expect(getGitSyncNextStep({ aheadOfOrigin: 2, behindOfOrigin: 0 })).toBe("push");
    expect(getGitSyncNextStep({ aheadOfOrigin: 0, behindOfOrigin: 0 })).toBeNull();
  });

  it("labels the upstream from the status, else assumes origin/<branch> when tracked", () => {
    expect(
      getGitSyncUpstreamLabel({ currentBranch: "main", upstreamRef: "refs/remotes/fork/main" }),
    ).toBe("fork/main");
    expect(
      getGitSyncUpstreamLabel({ currentBranch: "main", aheadOfOrigin: 1, behindOfOrigin: 3 }),
    ).toBe("origin/main");
    expect(
      getGitSyncUpstreamLabel({
        currentBranch: "feature",
        aheadOfOrigin: null,
        behindOfOrigin: null,
      }),
    ).toBeNull();
  });

  it("reads the state out for screen readers", () => {
    expect(
      buildGitSyncAccessibilityLabel({ isDirty: true, aheadOfOrigin: 1, behindOfOrigin: 327 }, t),
    ).toBe("Uncommitted changes, 1 to push, 327 to pull");
  });
});

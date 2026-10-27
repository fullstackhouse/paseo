import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";

import { buildGitSyncModel, buildGitSyncSummary, getGitSyncCounts } from "./sync-summary";

const t = i18n.t.bind(i18n);

describe("git sync summary", () => {
  it("describes a clean branch that is ahead of and behind its upstream", () => {
    expect(
      buildGitSyncSummary(
        { isDirty: false, aheadOfOrigin: 1, behindOfOrigin: 327, upstreamRef: "origin/main" },
        t,
      ),
    ).toEqual(["Unpushed commits: 1", "Behind origin/main: 327"]);
  });

  it("lists uncommitted changes first", () => {
    expect(buildGitSyncSummary({ isDirty: true, aheadOfOrigin: 2, behindOfOrigin: 0 }, t)).toEqual([
      "Uncommitted changes",
      "Unpushed commits: 2",
    ]);
  });

  it("falls back to a generic remote label without an upstream", () => {
    expect(buildGitSyncSummary({ behindOfOrigin: 3, upstreamRef: null }, t)).toEqual([
      "Behind remote: 3",
    ]);
  });

  it("returns nothing for an in-sync clean branch", () => {
    expect(buildGitSyncSummary({ isDirty: false, aheadOfOrigin: 0, behindOfOrigin: 0 }, t)).toEqual(
      [],
    );
    expect(getGitSyncCounts({ aheadOfOrigin: 0, behindOfOrigin: null })).toBeNull();
  });

  it("counts ahead and behind commits", () => {
    expect(getGitSyncCounts({ aheadOfOrigin: 1, behindOfOrigin: 327 })).toEqual({
      ahead: 1,
      behind: 327,
    });
  });

  it("explains a dirty in-sync branch without arrow counts", () => {
    expect(buildGitSyncModel({ isDirty: true, aheadOfOrigin: 0, behindOfOrigin: 0 }, t)).toEqual({
      counts: null,
      summary: ["Uncommitted changes"],
    });
    expect(
      buildGitSyncModel({ isDirty: false, aheadOfOrigin: 0, behindOfOrigin: 0 }, t),
    ).toBeNull();
  });
});

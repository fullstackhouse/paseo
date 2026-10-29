import { describe, expect, it } from "vitest";
import { CheckoutPrStatusSchema } from "@getpaseo/protocol/messages";

import { decideCreatePrAndMergeStep } from "./create-pr-and-merge";

function githubFacts(overrides: Record<string, unknown> = {}) {
  return {
    forge: "github",
    mergeStateStatus: "CLEAN",
    autoMergeRequest: null,
    viewerCanEnableAutoMerge: true,
    viewerCanDisableAutoMerge: true,
    repository: {
      autoMergeAllowed: true,
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      viewerDefaultMergeMethod: "SQUASH",
    },
    isMergeQueueEnabled: false,
    isInMergeQueue: false,
    ...overrides,
  };
}

function prStatus(overrides: Record<string, unknown> = {}) {
  return CheckoutPrStatusSchema.parse({
    url: "https://github.com/acme/repo/pull/7",
    title: "Ship it",
    state: "open",
    baseRefName: "main",
    headRefName: "feature",
    isMerged: false,
    mergeable: "MERGEABLE",
    forgeSpecific: githubFacts(),
    ...overrides,
  });
}

function decide(status: ReturnType<typeof prStatus> | null, autoMergeSupported = true) {
  return decideCreatePrAndMergeStep({ status, autoMergeSupported });
}

describe("decideCreatePrAndMergeStep", () => {
  it("waits until the new PR shows up in the status", () => {
    expect(decide(null)).toEqual({ kind: "wait" });
  });

  it("waits while the forge is still computing the merge state", () => {
    const status = prStatus({
      mergeable: "UNKNOWN",
      forgeSpecific: githubFacts({ mergeStateStatus: "UNKNOWN" }),
    });
    expect(decide(status)).toEqual({ kind: "wait" });
  });

  it("merges directly with the viewer's default method when the PR is clean", () => {
    const status = prStatus({
      forgeSpecific: githubFacts({
        repository: {
          autoMergeAllowed: true,
          mergeCommitAllowed: true,
          squashMergeAllowed: true,
          rebaseMergeAllowed: true,
          viewerDefaultMergeMethod: "REBASE",
        },
      }),
    });
    expect(decide(status)).toEqual({ kind: "merge", method: "rebase" });
  });

  it("prefers squash when the forge reports no default method", () => {
    const status = prStatus({
      forgeSpecific: githubFacts({
        repository: {
          autoMergeAllowed: true,
          mergeCommitAllowed: true,
          squashMergeAllowed: true,
          rebaseMergeAllowed: false,
          viewerDefaultMergeMethod: null,
        },
      }),
    });
    expect(decide(status)).toEqual({ kind: "merge", method: "squash" });
  });

  it("enables auto-merge when required checks still block the PR", () => {
    const status = prStatus({ forgeSpecific: githubFacts({ mergeStateStatus: "BLOCKED" }) });
    expect(decide(status)).toEqual({ kind: "enable-auto-merge", method: "squash" });
  });

  it("keeps waiting on a blocked PR when the daemon cannot enable auto-merge", () => {
    const status = prStatus({ forgeSpecific: githubFacts({ mergeStateStatus: "BLOCKED" }) });
    expect(decide(status, false)).toEqual({ kind: "wait" });
  });

  it("finishes once auto-merge is on or the PR is merged", () => {
    const autoMerge = prStatus({
      forgeSpecific: githubFacts({
        mergeStateStatus: "BLOCKED",
        autoMergeRequest: { enabledAt: null, mergeMethod: "SQUASH", enabledBy: null },
      }),
    });
    expect(decide(autoMerge)).toEqual({ kind: "done", outcome: "auto-merge-enabled" });
    expect(decide(prStatus({ isMerged: true }))).toEqual({ kind: "done", outcome: "merged" });
  });

  it("stops on conflicts, a merge queue, or a closed PR", () => {
    expect(decide(prStatus({ mergeable: "CONFLICTING" }))).toEqual({
      kind: "blocked",
      reason: "conflicts",
    });
    expect(decide(prStatus({ forgeSpecific: githubFacts({ isMergeQueueEnabled: true }) }))).toEqual(
      { kind: "blocked", reason: "merge-queue" },
    );
    expect(decide(prStatus({ state: "closed" }))).toEqual({ kind: "blocked", reason: "closed" });
  });

  it("merges a mergeable PR on a forge without merge facts", () => {
    expect(decide(prStatus({ forgeSpecific: undefined }))).toEqual({
      kind: "merge",
      method: "squash",
    });
    expect(decide(prStatus({ forgeSpecific: undefined, mergeable: "UNKNOWN" }))).toEqual({
      kind: "wait",
    });
  });
});

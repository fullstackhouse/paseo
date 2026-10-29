import type { CheckoutPrMergeMethod } from "@getpaseo/protocol/messages";
import { deriveMergeCapability, type MergeCapability } from "@/git/merge-capability";
import type { CheckoutPrStatusPayload } from "@/git/pr-status";

export type CreatePrAndMergeOutcome = "merged" | "auto-merge-enabled";

export type CreatePrAndMergeBlockedReason = "conflicts" | "merge-queue" | "closed";

/**
 * What "Create PR & Merge" does next once the PR exists. A freshly created PR
 * reports an unknown merge state for a few seconds while the forge computes it,
 * and the daemon refuses both direct merge and auto-merge until it settles, so
 * anything undecided is a `wait`.
 */
export type CreatePrAndMergeStep =
  | { kind: "merge"; method: CheckoutPrMergeMethod }
  | { kind: "enable-auto-merge"; method: CheckoutPrMergeMethod }
  | { kind: "done"; outcome: CreatePrAndMergeOutcome }
  | { kind: "blocked"; reason: CreatePrAndMergeBlockedReason }
  | { kind: "wait" };

type PullRequestStatus = CheckoutPrStatusPayload["status"];

export function decideCreatePrAndMergeStep(input: {
  status: PullRequestStatus;
  autoMergeSupported: boolean;
}): CreatePrAndMergeStep {
  const { status } = input;
  if (!status?.url) {
    return { kind: "wait" };
  }
  if (status.isMerged) {
    return { kind: "done", outcome: "merged" };
  }
  if (status.state === "closed") {
    return { kind: "blocked", reason: "closed" };
  }
  if (status.mergeable === "CONFLICTING") {
    return { kind: "blocked", reason: "conflicts" };
  }

  const capability = deriveMergeCapability(status.forgeSpecific, status.github);
  if (capability === null) {
    // No forge merge facts: raw mergeability is all we have.
    return status.mergeable === "MERGEABLE"
      ? { kind: "merge", method: "squash" }
      : { kind: "wait" };
  }
  if (capability.autoMergeEnabled) {
    return { kind: "done", outcome: "auto-merge-enabled" };
  }
  if (capability.mergeBlockedByQueue) {
    return { kind: "blocked", reason: "merge-queue" };
  }
  const method = pickMergeMethod(capability);
  if (method === null) {
    return { kind: "wait" };
  }
  if (capability.directMergeReady) {
    return { kind: "merge", method };
  }
  if (capability.canEnableAutoMerge && input.autoMergeSupported) {
    return { kind: "enable-auto-merge", method };
  }
  return { kind: "wait" };
}

function pickMergeMethod(capability: MergeCapability): CheckoutPrMergeMethod | null {
  const allowed = capability.allowedMethods;
  if (capability.preferredMethod && allowed.includes(capability.preferredMethod)) {
    return capability.preferredMethod;
  }
  if (allowed.includes("squash")) {
    return "squash";
  }
  return allowed[0] ?? null;
}

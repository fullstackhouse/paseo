import type { AttentionItem } from "@/workspace-attention/model";

/** What the Overview's next-step slot offers. */
export type OverviewNextStep =
  | { kind: "attention"; item: AttentionItem }
  | { kind: "working" }
  /** The header's git action: commit, push, Create PR, merge, archive… */
  | { kind: "git" };

/**
 * First match wins: something blocked on you, then a running agent (git actions would race it),
 * then failing checks, then the git action the header shows. A ready or merged PR falls through
 * to git, whose primary action is then Merge or Archive.
 */
export function deriveOverviewNextStep(input: {
  items: readonly AttentionItem[];
  agentRunning: boolean;
}): OverviewNextStep {
  const blocking = input.items.find(
    (item) => item.kind === "permission" || item.kind === "plugin" || item.kind === "failed",
  );
  if (blocking) return { kind: "attention", item: blocking };
  if (input.agentRunning) return { kind: "working" };
  const checks = input.items.find((item) => item.kind === "pr-checks-failed");
  if (checks) return { kind: "attention", item: checks };
  return { kind: "git" };
}

import {
  deriveAgentStateBucket,
  type AgentAttentionReason,
  type AgentStateBucketInput,
} from "@getpaseo/protocol/agent-state-bucket";

export type AgentStateBucket = "needs_input" | "failed" | "running" | "attention" | "done";
/**
 * A workspace's state. `blocked` never comes from an agent: a plugin reported that the workspace's
 * work waits on something other than you (other workspaces, a reviewer, CI).
 */
export type SidebarStateBucket = AgentStateBucket | "blocked";
export type SidebarAttentionReason = AgentAttentionReason;

export function deriveSidebarStateBucket(input: AgentStateBucketInput): AgentStateBucket {
  return deriveAgentStateBucket(input);
}

export function isSidebarActiveAgent(input: AgentStateBucketInput): boolean {
  return deriveSidebarStateBucket(input) !== "done";
}

// Most urgent first, for collapsing a project's workspaces into one badge. This is
// deliberately NOT STATUS_BUCKET_ORDER below, which ranks "attention" above "running": on a
// collapsed project row we want an actively-working project to keep showing the loader,
// so "running" outranks "attention" here. needs_input and failed still win over both;
// blocked only beats done.
const STATUS_BUCKET_PRIORITY: readonly SidebarStateBucket[] = [
  "needs_input",
  "failed",
  "running",
  "attention",
  "blocked",
  "done",
];

/**
 * The order states are listed in when all of them are shown side by side rather than collapsed
 * into one — the sidebar's status groups, and the subagent pill's segments. Anything the user has
 * to act on comes before anything that is still moving on its own. Blocked goes last: it waits on
 * something other than you, so it is the group you look at least.
 */
export const STATUS_BUCKET_ORDER: readonly SidebarStateBucket[] = [
  "needs_input",
  "failed",
  "attention",
  "running",
  "done",
  "blocked",
] as const;

/** Done and Blocked ask nothing of you, so a collapsed group may hide them past its limit. */
export function isIdleSidebarBucket(bucket: SidebarStateBucket): boolean {
  return bucket === "done" || bucket === "blocked";
}

/**
 * Collapses many workspace status buckets into the single most urgent one, so a
 * collapsed project row can stand in for the child rows it hides.
 */
export function aggregateSidebarStateBuckets(
  buckets: Iterable<SidebarStateBucket>,
): SidebarStateBucket {
  let bestRank = STATUS_BUCKET_PRIORITY.length - 1;
  for (const bucket of buckets) {
    const rank = STATUS_BUCKET_PRIORITY.indexOf(bucket);
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
    }
  }
  return STATUS_BUCKET_PRIORITY[bestRank] ?? "done";
}

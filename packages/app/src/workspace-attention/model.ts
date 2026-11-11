import type { ExplorerOnWorkspaceEnter } from "@/hooks/use-settings/storage";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import type { ExplorerAttentionRecord } from "@/stores/workspace-layout-store";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";

type PullRequest = NonNullable<NonNullable<WorkspaceDescriptor["githubRuntime"]>["pullRequest"]>;

/** Something in a workspace that waits on the human. `key` changes when a new thing arrives. */
export type AttentionItem =
  | { kind: "permission"; key: string; agentId: string }
  | { kind: "plugin"; key: string; item: WorkspaceSummaryItem }
  | { kind: "failed"; key: string; agentId: string }
  | { kind: "pr-checks-failed"; key: string }
  | { kind: "pr-ready"; key: string }
  | { kind: "pr-merged"; key: string };

export interface AttentionInput {
  agents: readonly Pick<Agent, "id" | "status" | "pendingPermissions" | "archivedAt">[];
  summaryItems: readonly WorkspaceSummaryItem[];
  pullRequest: PullRequest | null | undefined;
}

function pullRequestItems(pr: PullRequest | null | undefined): AttentionItem[] {
  if (!pr) return [];
  const id = pr.number ?? pr.url;
  if (pr.isMerged) return [{ kind: "pr-merged", key: `pr-merged:${id}` }];
  if (pr.state.toLowerCase() !== "open" || pr.isDraft) return [];
  const failing = (pr.checks ?? [])
    .filter((check) => check.status === "failure")
    .map((check) => check.name)
    .sort();
  if (failing.length > 0 || pr.checksStatus === "failure") {
    return [{ kind: "pr-checks-failed", key: `pr-checks-failed:${id}:${failing.join(",")}` }];
  }
  const checksPass = pr.checksStatus === "success" || pr.checksStatus === "none";
  const reviewOk = pr.reviewDecision === "approved" || pr.reviewDecision == null;
  if (checksPass && reviewOk && pr.mergeable === "MERGEABLE") {
    return [{ kind: "pr-ready", key: `pr-ready:${id}` }];
  }
  return [];
}

/** Attention items in priority order: the first one decides which tab opens. */
export function deriveAttentionItems(input: AttentionInput): AttentionItem[] {
  const agents = input.agents.filter((agent) => !agent.archivedAt);
  const items: AttentionItem[] = [];
  for (const agent of agents) {
    for (const request of agent.pendingPermissions) {
      items.push({
        kind: "permission",
        key: `permission:${agent.id}:${request.id}`,
        agentId: agent.id,
      });
    }
  }
  for (const item of input.summaryItems) {
    if (!item.needsYou) continue;
    items.push({
      kind: "plugin",
      key: `plugin:${item.pluginId}:${item.itemId}:${item.key ?? ""}`,
      item,
    });
  }
  for (const agent of agents) {
    if (agent.status === "error")
      items.push({ kind: "failed", key: `failed:${agent.id}`, agentId: agent.id });
  }
  items.push(...pullRequestItems(input.pullRequest));
  return items;
}

/** What entering a workspace does to Explorer: nothing, show it, or show it for one item. */
export type ExplorerAutoShowDecision =
  | { kind: "none" }
  | { kind: "show" }
  | { kind: "item"; item: AttentionItem };

export function decideExplorerAutoShow(input: {
  setting: ExplorerOnWorkspaceEnter;
  items: readonly AttentionItem[];
  record: ExplorerAttentionRecord | null;
}): ExplorerAutoShowDecision {
  if (input.setting === "never") return { kind: "none" };
  const seen = new Set(input.record?.seenKeys ?? []);
  const unseen = input.items.find((item) => !seen.has(item.key));
  if (unseen) return { kind: "item", item: unseen };
  if (input.setting === "always" && !input.record?.hidden) return { kind: "show" };
  return { kind: "none" };
}

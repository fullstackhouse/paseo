import type {
  ExplorerOnWorkspaceEnter,
  ExplorerOnWorkspaceEnterTab,
} from "@/hooks/use-settings/storage";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import type { ExplorerAttentionRecord } from "@/stores/workspace-layout-store";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import { unrecordedWaits } from "@/workspace-status/attention";

type PullRequest = NonNullable<NonNullable<WorkspaceDescriptor["githubRuntime"]>["pullRequest"]>;

/** Something in a workspace that waits on the human. `key` changes when a new thing arrives. */
export type AttentionItem =
  | { kind: "permission"; key: string; agentId: string }
  | { kind: "plugin"; key: string; item: WorkspaceSummaryItem }
  /** An agent's status card waits on the human, but no open ask says what for. */
  | { kind: "unrecorded"; key: string; item: WorkspaceSummaryItem; agentId: string }
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
  for (const wait of unrecordedWaits(input.summaryItems)) {
    items.push({
      kind: "unrecorded",
      key: `unrecorded:${wait.agentId}:${wait.updatedAt}`,
      item: wait.item,
      agentId: wait.agentId,
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

/** Whether a non-archived agent in the workspace is running. */
export function hasRunningAgent(
  agents: ReadonlyMap<string, Pick<Agent, "workspaceId" | "archivedAt" | "status">> | undefined,
  workspaceId: string,
): boolean {
  if (!agents) return false;
  for (const agent of agents.values()) {
    if (agent.workspaceId === workspaceId && !agent.archivedAt && agent.status === "running") {
      return true;
    }
  }
  return false;
}

/**
 * The tab an attention item opens Explorer on. Overview when its Your move lists the item
 * (`deriveYourMove`): agent and plugin items always, PR items only while no agent runs. A PR that is
 * ready or merged shows there as the git row (Merge, Archive), which a pending commit or push
 * displaces; that case still opens Overview.
 */
export function pickAttentionTab(input: {
  tabSetting: ExplorerOnWorkspaceEnterTab;
  item: AttentionItem;
  hasOverview: boolean;
  agentRunning: boolean;
}): "overview" | "item" {
  if (input.tabSetting !== "overview" || !input.hasOverview) return "item";
  switch (input.item.kind) {
    case "permission":
    case "failed":
    case "plugin":
    case "unrecorded":
      return "overview";
    case "pr-checks-failed":
    case "pr-ready":
    case "pr-merged":
      return input.agentRunning ? "item" : "overview";
  }
}

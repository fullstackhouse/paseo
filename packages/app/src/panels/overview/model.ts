import type { PluginWorkspaceStatus, PluginWorkspaceSummaryEntry } from "@getpaseo/plugin/client";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { Agent } from "@/stores/session-store";
import type { AttentionItem } from "@/workspace-attention/model";

/** Most rows a single plugin item adds to Your move; the rest are one press away in its panel. */
export const MAX_ENTRIES_PER_ITEM = 5;

export type WorkspaceStateWord =
  | "working"
  | "waiting"
  | "blocked"
  | "done"
  | "answered"
  | "failed"
  | "idle";

/**
 * One word for where a workspace stands: its status card when there is one, else its agents.
 * Used for the lineage rows, so a parent or child reads the same way its own Status section does.
 */
export function deriveWorkspaceStateWord(input: {
  status: PluginWorkspaceStatus | null;
  agents: readonly Pick<Agent, "status" | "pendingPermissions" | "archivedAt">[];
}): WorkspaceStateWord {
  if (input.status) {
    if (input.status.answered) return "answered";
    if (input.status.state === "waiting_on_you") return "waiting";
    return input.status.state;
  }
  const agents = input.agents.filter((agent) => !agent.archivedAt);
  if (agents.some((agent) => agent.pendingPermissions.length > 0)) return "waiting";
  if (agents.some((agent) => agent.status === "running")) return "working";
  if (agents.some((agent) => agent.status === "error")) return "failed";
  return "idle";
}

export type YourMoveRow =
  | { kind: "permission"; key: string; agentId: string }
  | { kind: "entry"; key: string; item: WorkspaceSummaryItem; entry: PluginWorkspaceSummaryEntry }
  | { kind: "plugin"; key: string; item: WorkspaceSummaryItem }
  | { kind: "failed"; key: string; agentId: string }
  | { kind: "checks"; key: string }
  | { kind: "git"; key: string };

/**
 * Everything that waits on the human, in the attention ladder's order, then the git step.
 * While an agent runs only blocking items show: failing checks and git actions would race it.
 * Archive is only a move once the PR merged; before that it lives in the ⋯ menu.
 */
export function deriveYourMove(input: {
  items: readonly AttentionItem[];
  agentRunning: boolean;
  gitPrimaryId: string | null;
  prMerged: boolean;
}): YourMoveRow[] {
  const rows: YourMoveRow[] = [];
  for (const item of input.items) {
    if (item.kind === "permission" || item.kind === "failed") {
      rows.push({ kind: item.kind, key: item.key, agentId: item.agentId });
    } else if (item.kind === "plugin") {
      const entries = item.item.entries ?? [];
      if (entries.length === 0) {
        rows.push({ kind: "plugin", key: item.key, item: item.item });
        continue;
      }
      for (const entry of entries.slice(0, MAX_ENTRIES_PER_ITEM)) {
        rows.push({ kind: "entry", key: `${item.key}:${entry.id}`, item: item.item, entry });
      }
    }
  }
  if (input.agentRunning) return rows;
  const checks = input.items.find((item) => item.kind === "pr-checks-failed");
  if (checks) rows.push({ kind: "checks", key: checks.key });
  const archive = input.gitPrimaryId === "archive-workspace";
  if (input.gitPrimaryId && (!archive || input.prMerged)) {
    rows.push({ kind: "git", key: `git:${input.gitPrimaryId}` });
  }
  return rows;
}

/**
 * Where each plugin summary item renders: an item with a status is the Status card; one that can
 * need the human (`needsYou`, `entries`) belongs to Your move; anything else is a fact under More.
 */
export function partitionSummaryItems(items: readonly WorkspaceSummaryItem[]): {
  status: WorkspaceSummaryItem | null;
  more: WorkspaceSummaryItem[];
} {
  let status: WorkspaceSummaryItem | null = null;
  const more: WorkspaceSummaryItem[] = [];
  for (const item of items) {
    if (item.status) {
      status ??= item;
      continue;
    }
    if (item.needsYou || item.entries !== undefined) continue;
    more.push(item);
  }
  return { status, more };
}

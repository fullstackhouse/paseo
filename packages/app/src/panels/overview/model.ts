import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
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
 * Archive is only a move once the PR merged; before that it lives in the workspace header.
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
 * need the human (`needsYou`, `entries`) belongs to Your move; anything else is a context footer fact.
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

/**
 * Whether the status card may no longer describe the work: someone prompted an agent after the card's
 * last update and that turn ended without a new card. While an agent runs the card is due for its
 * end-of-turn update, so it isn't flagged. Prompts, not `lastActivityAt`: that moves on renames and
 * mode or model changes, which don't make a summary wrong.
 */
export function isStatusOutdated(input: {
  updatedAt: number;
  agentRunning: boolean;
  lastPromptAt: number | null;
}): boolean {
  if (input.agentRunning || input.lastPromptAt === null) return false;
  return input.lastPromptAt > input.updatedAt;
}

/** The goal says what the workspace is for; without one, the project at least says where it lives. */
export function overviewSubtitle(input: {
  goal: string | null;
  project: string | null;
}): string | null {
  return input.goal || input.project || null;
}

/**
 * The one Code row worth showing, if any. The git move already names the PR (or, without one, the
 * branch), so the row would repeat it; a branch row with nothing to report is skipped too.
 */
export function deriveCodeRow(input: {
  hasPullRequest: boolean;
  gitMoveShown: boolean;
  branchHasFacts: boolean;
}): "pr" | "branch" | null {
  if (input.gitMoveShown) return null;
  if (input.hasPullRequest) return "pr";
  return input.branchHasFacts ? "branch" : null;
}

type Translate = (key: string) => string;

export interface PullRequestFacts {
  isMerged: boolean;
  checksStatus?: "none" | "pending" | "success" | "failure";
  reviewDecision?: "approved" | "changes_requested" | "pending" | null;
}

export interface BranchFactsInput {
  ahead: number | null;
  behind: number | null;
  isDirty: boolean | null;
  diffStat: { additions: number; deletions: number } | null;
  pullRequest: PullRequestFacts | null;
}

export function pullRequestFacts(pr: PullRequestFacts, t: Translate): string {
  if (pr.isMerged) return t("panels.overview.merged");
  const parts: string[] = [];
  if (pr.checksStatus === "failure") parts.push(t("panels.overview.checksFailing"));
  else if (pr.checksStatus === "pending") parts.push(t("panels.overview.checksRunning"));
  else if (pr.checksStatus === "success") parts.push(t("panels.overview.checksPassed"));
  if (pr.reviewDecision === "approved") parts.push(t("panels.overview.approved"));
  else if (pr.reviewDecision === "changes_requested")
    parts.push(t("panels.overview.changesRequested"));
  else if (pr.reviewDecision === "pending") parts.push(t("panels.overview.reviewRequired"));
  return parts.join(" · ");
}

/** What the branch has to report; empty when in sync, clean, or already merged. */
export function branchFacts(facts: BranchFactsInput | null, t: Translate): string {
  if (!facts || facts.pullRequest?.isMerged) return "";
  const sync = [facts.ahead ? `↑${facts.ahead}` : "", facts.behind ? `↓${facts.behind}` : ""]
    .filter(Boolean)
    .join(" ");
  const diff =
    facts.diffStat && (facts.diffStat.additions > 0 || facts.diffStat.deletions > 0)
      ? `+${facts.diffStat.additions} −${facts.diffStat.deletions}`
      : "";
  const dirty = facts.isDirty ? t("panels.overview.uncommitted") : "";
  return [sync, diff, dirty].filter(Boolean).join(" · ");
}

/** The git move names the PR, so it carries the PR's checks and review state the Code row would have. */
export function gitMoveFacts(facts: BranchFactsInput | null, t: Translate): string {
  const pr = facts?.pullRequest;
  const prFacts = pr && !pr.isMerged ? pullRequestFacts(pr, t) : "";
  return [prFacts, branchFacts(facts, t)].filter(Boolean).join(" · ");
}

type PermissionRequest = Pick<AgentPermissionRequest, "kind" | "detail" | "actions">;

/**
 * What a tool permission would do, in one line: the command (with its directory when that isn't the
 * workspace's), path, query or URL. Null when one line can't say it (an edit's diff, a write's
 * content), so the request has to be read in the agent.
 */
export function permissionSubject(
  request: PermissionRequest,
  workspaceCwd: string | null = null,
): string | null {
  const detail = request.detail;
  if (!detail) return null;
  let subject: string | undefined;
  switch (detail.type) {
    case "shell":
      subject =
        detail.cwd && detail.cwd !== workspaceCwd
          ? `${detail.command} (in ${detail.cwd})`
          : detail.command;
      if (!detail.command.trim()) subject = undefined;
      break;
    case "read":
      subject = detail.filePath;
      break;
    case "search":
      subject = detail.query;
      break;
    case "fetch":
      subject = detail.url;
      break;
    default:
      subject = undefined;
  }
  return subject?.trim() ? subject : null;
}

/** The facts under a permission: what it does, then why the agent asks (Codex puts the reason here). */
export function permissionFacts(
  request: Pick<AgentPermissionRequest, "kind" | "detail" | "actions" | "description">,
  workspaceCwd: string | null,
): string | null {
  const parts = [permissionSubject(request, workspaceCwd), request.description?.trim()];
  return parts.filter(Boolean).join(" · ") || null;
}

/** Answer on Overview only when the one line shows everything being approved. */
export function canAnswerPermissionInPlace(request: PermissionRequest): boolean {
  if (request.kind === "question" || request.kind === "plan") return false;
  return permissionSubject(request) !== null;
}

export function permissionActions(
  request: PermissionRequest,
  labels: { accept: string; deny: string },
): AgentPermissionAction[] {
  if (Array.isArray(request.actions) && request.actions.length > 0) return request.actions;
  return [
    { id: "accept", label: labels.accept, behavior: "allow", variant: "primary" },
    { id: "reject", label: labels.deny, behavior: "deny", variant: "danger" },
  ];
}

export function permissionResponse(action: AgentPermissionAction): AgentPermissionResponse {
  return action.behavior === "allow"
    ? { behavior: "allow", selectedActionId: action.id }
    : { behavior: "deny", selectedActionId: action.id, message: "Denied by user" };
}

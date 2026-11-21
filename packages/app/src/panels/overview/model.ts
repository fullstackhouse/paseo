import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import type {
  PluginWorkspaceBlocker,
  PluginWorkspaceStatus,
  PluginWorkspaceSummaryEntry,
} from "@getpaseo/plugin/client";
import type { GitActionId } from "@/git/policy";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { Agent } from "@/stores/session-store";
import type { AttentionItem } from "@/workspace-attention/model";

/** Most rows a single plugin item adds to Your move; the rest are one press away in its panel. */
export const MAX_ENTRIES_PER_ITEM = 5;

const ARCHIVE_ACTION_ID: GitActionId = "archive-workspace";

/** Git steps that only sync a branch. Once the work shipped, Archive replaces them; commit and PR steps stay. */
const LEFTOVER_GIT_STEPS: ReadonlySet<GitActionId> = new Set([
  "pull",
  "push",
  "pull-and-push",
  "merge-from-base",
]);

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
  | { kind: "git"; key: string; actionId: GitActionId };

/**
 * Everything that waits on the human, in the attention ladder's order, then the git step.
 * While an agent runs only blocking items show: failing checks and git actions would race it.
 * Archive is only a move once the work shipped: the PR merged, or the status card says done (work whose
 * PRs live in other repos has no branch PR to merge). Before that it lives in the workspace header.
 * Once shipped it replaces a leftover sync step (a pull or push of a stale branch), never a commit or a
 * PR step. Only in a worktree, or after a merge: a regular checkout doesn't offer Archive just because an
 * agent finished, as in the header (git/policy.ts).
 */
export function deriveYourMove(input: {
  items: readonly AttentionItem[];
  agentRunning: boolean;
  gitPrimaryId: GitActionId | null;
  /** The archive git action exists and is enabled (or running), whether or not it is the primary. */
  canArchive: boolean;
  isWorktree: boolean;
  prMerged: boolean;
  statusDone: boolean;
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
  const shipped = input.prMerged || input.statusDone;
  const archiveFits =
    shipped &&
    input.canArchive &&
    (input.isWorktree || input.prMerged) &&
    input.gitPrimaryId !== null &&
    LEFTOVER_GIT_STEPS.has(input.gitPrimaryId);
  const actionId = archiveFits ? ARCHIVE_ACTION_ID : input.gitPrimaryId;
  if (actionId && (actionId !== ARCHIVE_ACTION_ID || shipped)) {
    rows.push({ kind: "git", key: `git:${actionId}`, actionId });
  }
  return rows;
}

/**
 * The word a compact (non-lead) Your move row trails with. A git row's title is only the PR or
 * branch, so without its action ("Create PR", "Push") it reads as a plain link.
 */
export function compactMoveWord(kind: YourMoveRow["kind"], action: string): string | null {
  return kind === "git" ? action : null;
}

/**
 * The one Your move row shown open. `chosen` is the row last shown open (the host pins it), or null
 * after the human closed it. With nothing pinned, and once that row is gone (answered), the lead row
 * is open.
 */
export function openMoveKey(
  rows: readonly YourMoveRow[],
  chosen: string | null | undefined,
): string | null {
  if (chosen === null) return null;
  if (chosen !== undefined && rows.some((row) => row.key === chosen)) return chosen;
  return rows[0]?.key ?? null;
}

/**
 * What the host remembers as `chosen` after rendering `rows`. Once an ask is shown open it is pinned,
 * so a move arriving above it doesn't collapse the ask the human is answering (and drop their
 * half-written reply). Rows that can't expand are never pinned: an ask arriving above one still opens.
 */
export function pinOpenMove(
  rows: readonly YourMoveRow[],
  chosen: string | null | undefined,
): string | null | undefined {
  const key = openMoveKey(rows, chosen);
  const open = rows.find((row) => row.key === key);
  return open?.kind === "entry" && open.item.EntryComponent ? key : chosen;
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

/** A current, unanswered status card that says the work is done. */
export function isStatusDone(input: {
  status: PluginWorkspaceStatus | null;
  agentRunning: boolean;
  lastPromptAt: number | null;
}): boolean {
  const { status } = input;
  if (!status || status.state !== "done" || status.answered) return false;
  return !isStatusOutdated({ updatedAt: status.updatedAt, ...input });
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

export type BlockerTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "url"; url: string };

/** What pressing a Blocked by row opens: the agent, else its workspace, else the link. */
export function blockerTarget(blocker: PluginWorkspaceBlocker): BlockerTarget | null {
  if (blocker.agentId) return { kind: "agent", agentId: blocker.agentId };
  if (blocker.workspaceId) return { kind: "workspace", workspaceId: blocker.workspaceId };
  if (blocker.url) return { kind: "url", url: blocker.url };
  return null;
}

/** Identifies a Blocked by row: what it opens, else its label. */
export function blockerKey(blocker: PluginWorkspaceBlocker): string {
  return `${blocker.kind}:${blocker.agentId ?? blocker.workspaceId ?? blocker.url ?? blocker.label}`;
}

/**
 * The Blocked by rows, one per thing: only while the status card says blocked and the human hasn't
 * answered it.
 */
export function statusBlockers(status: PluginWorkspaceStatus | null): PluginWorkspaceBlocker[] {
  if (!status || status.state !== "blocked" || status.answered) return [];
  const seen = new Set<string>();
  return (status.blockedBy ?? []).filter((blocker) => {
    const key = blockerKey(blocker);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

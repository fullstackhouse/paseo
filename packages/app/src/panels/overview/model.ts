import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import type {
  PluginWorkspaceBlocker,
  PluginWorkspacePullRequest,
  PluginWorkspaceStatus,
  PluginWorkspaceSummaryEntry,
} from "@getpaseo/plugin/client";
import type { GitActionId } from "@/git/policy";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import type { Agent } from "@/stores/session-store";
import type { AttentionItem } from "@/workspace-attention/model";

const ARCHIVE_ACTION_ID: GitActionId = "archive-workspace";

/**
 * Git steps that only sync a branch. Once the work shipped, Archive is offered over them; a commit or
 * PR step means work that isn't in the PR yet, so Archive waits for the agent to finish it.
 */
const ARCHIVABLE_GIT_STEPS: ReadonlySet<GitActionId> = new Set([
  ARCHIVE_ACTION_ID,
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
  | { kind: "archive"; key: string };

/**
 * Everything that waits on the human, in the attention ladder's order, then Archive. Git steps and
 * failing checks are not moves: the agent handles git, and the Pull requests section shows the facts.
 * Archive is only a move once the work shipped: the PR merged, or the status card says done (work whose
 * PRs live in other repos has no branch PR to merge), and never while an agent runs. Not over a commit
 * or PR step, which means work not in the PR yet. Only in a worktree, or after a merge: a regular
 * checkout doesn't offer Archive just because an agent finished, as in the header (git/policy.ts).
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
      for (const entry of entries) {
        rows.push({ kind: "entry", key: `${item.key}:${entry.id}`, item: item.item, entry });
      }
    }
  }
  if (input.agentRunning) return rows;
  const shipped = input.prMerged || input.statusDone;
  if (
    shipped &&
    input.canArchive &&
    (input.isWorktree || input.prMerged) &&
    input.gitPrimaryId !== null &&
    ARCHIVABLE_GIT_STEPS.has(input.gitPrimaryId)
  ) {
    rows.push({ kind: "archive", key: `git:${ARCHIVE_ACTION_ID}` });
  }
  return rows;
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
 * Where each plugin summary item renders: an item with a status is the Status card; one with
 * `pullRequests` feeds the Pull requests section; one that can need the human (`needsYou`, `entries`)
 * belongs to Your move; anything else is a context footer fact.
 */
export function partitionSummaryItems(items: readonly WorkspaceSummaryItem[]): {
  status: WorkspaceSummaryItem | null;
  pullRequests: WorkspaceSummaryItem | null;
  more: WorkspaceSummaryItem[];
} {
  let status: WorkspaceSummaryItem | null = null;
  let pullRequests: WorkspaceSummaryItem | null = null;
  const more: WorkspaceSummaryItem[] = [];
  for (const item of items) {
    if (item.status) {
      status ??= item;
      continue;
    }
    if (item.pullRequests !== undefined) {
      pullRequests ??= item;
      continue;
    }
    if (item.needsYou || item.entries !== undefined) continue;
    more.push(item);
  }
  return { status, pullRequests, more };
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

type Translate = (key: string, options?: Record<string, unknown>) => string;

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

/** Same words as the panel's row tones. */
export type PullRequestTone = "danger" | "warn" | "run" | "ok" | "merged" | "muted";

export interface PullRequestRow {
  key: string;
  /** `#123`, or `paseo-prs#58` for a PR outside the workspace's repository. */
  ref: string;
  title: string;
  facts: string;
  tone: PullRequestTone;
  url: string;
  /** The workspace branch's own PR: it opens the Explorer PR tab instead of the browser. */
  isBranchPr: boolean;
}

export interface PullRequestList {
  open: PullRequestRow[];
  /** Merged and closed PRs: folded behind one row while any PR is open. */
  done: PullRequestRow[];
}

export interface HostPullRequest extends PullRequestFacts {
  number?: number;
  url: string;
  title: string;
  state: string;
  isDraft?: boolean;
}

const PLUGIN_TONES: Record<NonNullable<PluginWorkspacePullRequest["tone"]>, PullRequestTone> = {
  danger: "danger",
  warning: "warn",
  success: "ok",
  muted: "muted",
};

function hostTone(pr: HostPullRequest): PullRequestTone {
  if (pr.isMerged) return "merged";
  if (pr.checksStatus === "failure" || pr.reviewDecision === "changes_requested") return "danger";
  if (pr.checksStatus === "pending") return "run";
  if (pr.reviewDecision === "approved" || pr.checksStatus === "success") return "ok";
  return "muted";
}

function isClosed(state: string): boolean {
  return state.toLowerCase() === "closed";
}

function pluginPullRequestRow(
  pr: PluginWorkspacePullRequest,
  host: HostPullRequest | null,
  t: Translate,
): PullRequestRow {
  return {
    key: pr.id,
    ref: `${pr.repo ?? ""}#${pr.number}`,
    title: pr.title,
    facts: pr.facts ?? t(`panels.overview.prState.${pr.state}`),
    tone: pr.state === "merged" ? "merged" : PLUGIN_TONES[pr.tone ?? "muted"],
    url: pr.url,
    isBranchPr: !pr.repo && host?.number === pr.number,
  };
}

function hostFacts(pr: HostPullRequest, closed: boolean, t: Translate): string {
  if (pr.isMerged) return t("panels.overview.prState.merged");
  if (closed) return t("panels.overview.prState.closed");
  const facts = pullRequestFacts(pr, t);
  if (facts) return facts;
  return pr.isDraft ? t("panels.overview.prState.draft") : "";
}

/**
 * The PRs the work lives in. A plugin's list (paseo-prs: the branch's PRs, their stack, linked PRs)
 * wins over the host's one branch PR; a plugin that sends an empty list says there are none.
 */
export function derivePullRequests(input: {
  plugin: readonly PluginWorkspacePullRequest[] | null;
  host: HostPullRequest | null;
  t: Translate;
}): PullRequestList {
  const { plugin, host, t } = input;
  const list: PullRequestList = { open: [], done: [] };
  if (plugin) {
    for (const pr of plugin) {
      const row = pluginPullRequestRow(pr, host, t);
      (pr.state === "merged" || pr.state === "closed" ? list.done : list.open).push(row);
    }
    return list;
  }
  if (!host) return list;
  const closed = isClosed(host.state) && !host.isMerged;
  const row: PullRequestRow = {
    key: host.url,
    ref: host.number ? `#${host.number}` : "",
    title: host.title,
    facts: hostFacts(host, closed, t),
    tone: closed ? "muted" : hostTone(host),
    url: host.url,
    isBranchPr: true,
  };
  (host.isMerged || closed ? list.done : list.open).push(row);
  return list;
}

/**
 * The "No PR yet" row: only with no PR at all and commits on the branch that a PR would propose.
 * The default branch and a branch level with its base have nothing to propose, so no row.
 */
export function noPullRequestFacts(
  input: {
    aheadOfBase: number | null;
    isDirty: boolean | null;
    diffStat: { additions: number; deletions: number } | null;
  },
  t: Translate,
): string | null {
  if (!input.aheadOfBase) return null;
  const diff =
    input.diffStat && (input.diffStat.additions > 0 || input.diffStat.deletions > 0)
      ? `+${input.diffStat.additions} −${input.diffStat.deletions}`
      : "";
  return [
    t("panels.overview.commits", { count: input.aheadOfBase }),
    diff,
    input.isDirty ? t("panels.overview.uncommitted") : "",
  ]
    .filter(Boolean)
    .join(" · ");
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

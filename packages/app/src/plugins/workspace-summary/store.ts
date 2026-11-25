import { useSyncExternalStore } from "react";
import type {
  PluginText,
  PluginWorkspaceSummaryItemContribution,
  PluginWorkspaceSummaryItemRegistration,
  PluginWorkspaceSummaryItemState,
  PluginWorkspaceStatus,
  PluginWorkspaceBlocker,
  PluginWorkspaceSummaryEntry,
  PluginWorkspaceInProgressEntry,
  PluginWorkspacePullRequest,
  PluginWorkspaceWorkState,
  PluginWorkspaceSummaryEntryProps,
} from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { isHttpUrl } from "@/utils/http-url";

export interface WorkspaceSummaryItem extends PluginWorkspaceSummaryItemState {
  /** Distinguishes two registrations of the same item; never reused. */
  entryKey: number;
  serverId: string;
  pluginId: string;
  itemId: string;
  workspaceId: string;
  /** Resolved for the current locale when the item is added. */
  title: string;
  /** The plugin's renderer for one entry; set once, when the item is added. */
  EntryComponent?: ComponentType<PluginWorkspaceSummaryEntryProps>;
}

export interface WorkspaceSummaryOwner {
  serverId: string;
  pluginId: string;
  resolveText(text: PluginText): string;
}

const EMPTY: readonly WorkspaceSummaryItem[] = [];

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Workspace summary item needs a ${field}`);
  }
  return value.trim();
}

function cleanState(patch: PluginWorkspaceSummaryItemState): PluginWorkspaceSummaryItemState {
  const state: PluginWorkspaceSummaryItemState = {};
  if (patch.label !== undefined) state.label = String(patch.label);
  if (patch.count !== undefined) {
    if (!Number.isFinite(patch.count))
      throw new Error("Workspace summary item count is not a number");
    state.count = patch.count;
  }
  if (patch.needsYou !== undefined) state.needsYou = patch.needsYou === true;
  if (patch.key !== undefined) state.key = String(patch.key);
  if (patch.panelId !== undefined) state.panelId = patch.panelId.trim() || undefined;
  if (patch.workState !== undefined) {
    state.workState = WORK_STATES.has(patch.workState as PluginWorkspaceWorkState)
      ? patch.workState
      : undefined;
  }
  if (patch.status !== undefined) state.status = cleanStatus(patch.status);
  if (patch.entries !== undefined) state.entries = cleanEntries(patch.entries);
  if (patch.inProgress !== undefined) state.inProgress = cleanInProgress(patch.inProgress);
  if (patch.pullRequests !== undefined) state.pullRequests = cleanPullRequests(patch.pullRequests);
  if (patch.pullRequestsStale !== undefined)
    state.pullRequestsStale = patch.pullRequestsStale === true;
  return state;
}

const WORK_STATES = new Set<PluginWorkspaceWorkState>(["waiting", "blocked", "working", "done"]);

const STATUS_STATES = new Set<PluginWorkspaceStatus["state"]>([
  "working",
  "waiting_on_you",
  "blocked",
  "done",
]);

/** A malformed status clears the card rather than failing the whole update. */
function cleanStatus(status: PluginWorkspaceStatus | null): PluginWorkspaceStatus | null {
  if (!status || !STATUS_STATES.has(status.state)) return null;
  const summary = typeof status.summary === "string" ? status.summary.trim() : "";
  if (!summary || !Number.isFinite(status.updatedAt)) return null;
  const clean: PluginWorkspaceStatus = {
    state: status.state,
    summary,
    updatedAt: status.updatedAt,
  };
  if (status.answered === true) clean.answered = true;
  const goal = typeof status.goal === "string" ? status.goal.trim() : "";
  if (goal) clean.goal = goal;
  const now = typeof status.now === "string" ? status.now.trim() : "";
  if (now) clean.now = now;
  // Blockers only mean something on a blocked status.
  const blockedBy = status.state === "blocked" ? cleanBlockers(status.blockedBy) : [];
  if (blockedBy.length > 0) clean.blockedBy = blockedBy;
  return clean;
}

const BLOCKER_KINDS = new Set<PluginWorkspaceBlocker["kind"]>([
  "pr",
  "agent",
  "workspace",
  "person",
  "other",
]);
const BLOCKER_TONES = new Set<NonNullable<PluginWorkspaceBlocker["tone"]>>([
  "success",
  "warning",
  "danger",
  "muted",
]);
/** More than this reads as a list to scroll, not a reason; the plugin's own tab has the rest. */
const MAX_BLOCKERS = 8;

function optionalText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** Drops malformed blockers one by one, and links that aren't http(s). */
function cleanBlockers(blockers: unknown): PluginWorkspaceBlocker[] {
  if (!Array.isArray(blockers)) return [];
  const clean: PluginWorkspaceBlocker[] = [];
  for (const blocker of blockers as Partial<PluginWorkspaceBlocker>[]) {
    const label = optionalText(blocker?.label);
    if (!label || !blocker.kind || !BLOCKER_KINDS.has(blocker.kind)) continue;
    const entry: PluginWorkspaceBlocker = { kind: blocker.kind, label };
    const detail = optionalText(blocker.detail);
    if (detail) entry.detail = detail;
    const url = optionalText(blocker.url);
    if (url && isHttpUrl(url)) entry.url = url;
    const agentId = optionalText(blocker.agentId);
    if (agentId) entry.agentId = agentId;
    const workspaceId = optionalText(blocker.workspaceId);
    if (workspaceId) entry.workspaceId = workspaceId;
    if (blocker.tone && BLOCKER_TONES.has(blocker.tone)) entry.tone = blocker.tone;
    clean.push(entry);
    if (clean.length === MAX_BLOCKERS) break;
  }
  return clean;
}

function cleanEntries(
  entries: readonly PluginWorkspaceSummaryEntry[],
): PluginWorkspaceSummaryEntry[] {
  if (!Array.isArray(entries)) return [];
  const clean: PluginWorkspaceSummaryEntry[] = [];
  // Ids key the Overview rows; a repeated id would render two rows under one React key.
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const title = typeof entry?.title === "string" ? entry.title.trim() : "";
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const detail = typeof entry.detail === "string" ? entry.detail.trim() : "";
    clean.push(detail ? { id, title, detail } : { id, title });
  }
  return clean;
}

/** A list longer than this is a plugin bug; the section isn't virtualized. */
const MAX_IN_PROGRESS = 50;

/** Drops malformed in-progress entries one by one. Ids key the Overview rows. */
function cleanInProgress(entries: unknown): PluginWorkspaceInProgressEntry[] {
  if (!Array.isArray(entries)) return [];
  const clean: PluginWorkspaceInProgressEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries as Partial<PluginWorkspaceInProgressEntry>[]) {
    if (clean.length >= MAX_IN_PROGRESS) break;
    const id = optionalText(entry?.id);
    const title = optionalText(entry?.title);
    if (!id || !title || seen.has(id)) continue;
    if (typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt)) continue;
    seen.add(id);
    const item: PluginWorkspaceInProgressEntry = { id, title, updatedAt: entry.updatedAt };
    const waitingOn = optionalText(entry.waitingOn);
    if (waitingOn) item.waitingOn = waitingOn;
    if (entry.tone && BLOCKER_TONES.has(entry.tone)) item.tone = entry.tone;
    const agentId = optionalText(entry.agentId);
    if (agentId) item.agentId = agentId;
    if (entry.watched === true) item.watched = true;
    clean.push(item);
  }
  return clean;
}

const PR_STATES = new Set<PluginWorkspacePullRequest["state"]>([
  "open",
  "draft",
  "merged",
  "closed",
]);

/** A list longer than this is a plugin bug; the section isn't virtualized. */
const MAX_PULL_REQUESTS = 50;

/** Drops malformed PRs one by one, and links that aren't http(s). Ids key the Overview rows. */
function cleanPullRequests(prs: unknown): PluginWorkspacePullRequest[] {
  if (!Array.isArray(prs)) return [];
  const clean: PluginWorkspacePullRequest[] = [];
  const seen = new Set<string>();
  for (const pr of prs as Partial<PluginWorkspacePullRequest>[]) {
    if (clean.length >= MAX_PULL_REQUESTS) break;
    const id = optionalText(pr?.id);
    const title = optionalText(pr?.title);
    const url = optionalText(pr?.url);
    if (!id || !title || !url || !isHttpUrl(url) || seen.has(id)) continue;
    if (!Number.isInteger(pr.number) || (pr.number as number) <= 0) continue;
    if (!pr.state || !PR_STATES.has(pr.state)) continue;
    seen.add(id);
    const item: PluginWorkspacePullRequest = {
      id,
      number: pr.number as number,
      title,
      url,
      state: pr.state,
    };
    const repo = optionalText(pr.repo);
    if (repo) item.repo = repo;
    const facts = optionalText(pr.facts);
    if (facts) item.facts = facts;
    if (pr.tone && BLOCKER_TONES.has(pr.tone)) item.tone = pr.tone;
    clean.push(item);
  }
  return clean;
}

/** Plugin-reported facts about workspaces, keyed by host and workspace. */
export class WorkspaceSummaryStore {
  private entries: readonly WorkspaceSummaryItem[] = [];
  private byWorkspace = new Map<string, readonly WorkspaceSummaryItem[]>();
  private nextKey = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly WorkspaceSummaryItem[] => this.entries;

  /** Items for one workspace in registration order; a stable array between changes. */
  forWorkspace(serverId: string, workspaceId: string): readonly WorkspaceSummaryItem[] {
    return this.byWorkspace.get(`${serverId}:${workspaceId}`) ?? EMPTY;
  }

  add(
    owner: WorkspaceSummaryOwner,
    contribution: PluginWorkspaceSummaryItemContribution<PluginText>,
  ): PluginWorkspaceSummaryItemRegistration {
    const itemId = requireText(contribution.id, "id");
    const workspaceId = requireText(contribution.workspaceId, "workspace id");
    const title = contribution.title ? owner.resolveText(contribution.title).trim() : "";
    if (!title) throw new Error(`Workspace summary item ${itemId} needs a title`);
    const duplicate = this.entries.some(
      (entry) =>
        entry.serverId === owner.serverId &&
        entry.pluginId === owner.pluginId &&
        entry.itemId === itemId &&
        entry.workspaceId === workspaceId,
    );
    if (duplicate) throw new Error(`Duplicate workspace summary item: ${itemId} in ${workspaceId}`);
    const entryKey = this.nextKey++;
    // Static: an update can't swap it, so a mounted entry never remounts as a different component.
    const EntryComponent = contribution.EntryComponent;
    const build = (state: PluginWorkspaceSummaryItemState): WorkspaceSummaryItem => ({
      ...state,
      entryKey,
      serverId: owner.serverId,
      pluginId: owner.pluginId,
      itemId,
      workspaceId,
      title,
      ...(EntryComponent ? { EntryComponent } : {}),
    });
    let current = cleanState(contribution);
    this.replace([...this.entries, build(current)]);
    let active = true;
    return {
      update: (patch) => {
        if (!active) return;
        current = { ...current, ...cleanState(patch) };
        this.replace(
          this.entries.map((entry) => (entry.entryKey === entryKey ? build(current) : entry)),
        );
      },
      remove: () => {
        if (!active) return;
        active = false;
        this.replace(this.entries.filter((entry) => entry.entryKey !== entryKey));
      },
    };
  }

  private replace(entries: readonly WorkspaceSummaryItem[]): void {
    const previous = this.byWorkspace;
    const grouped = new Map<string, WorkspaceSummaryItem[]>();
    for (const entry of entries) {
      const key = `${entry.serverId}:${entry.workspaceId}`;
      const list = grouped.get(key);
      if (list) list.push(entry);
      else grouped.set(key, [entry]);
    }
    const next = new Map<string, readonly WorkspaceSummaryItem[]>();
    for (const [key, list] of grouped) {
      const old = previous.get(key);
      const same = old && old.length === list.length && old.every((item, i) => item === list[i]);
      next.set(key, same ? old : list);
    }
    this.entries = entries;
    this.byWorkspace = next;
    for (const listener of this.listeners) listener();
  }
}

export const workspaceSummaryStore = new WorkspaceSummaryStore();

export function useWorkspaceSummaryItems(
  serverId: string | null,
  workspaceId: string | null,
): readonly WorkspaceSummaryItem[] {
  return useSyncExternalStore(
    workspaceSummaryStore.subscribe,
    () =>
      serverId && workspaceId ? workspaceSummaryStore.forWorkspace(serverId, workspaceId) : EMPTY,
    () => EMPTY,
  );
}

import { useSyncExternalStore } from "react";
import type {
  PluginText,
  PluginWorkspaceSummaryItemContribution,
  PluginWorkspaceSummaryItemRegistration,
  PluginWorkspaceSummaryItemState,
} from "@getpaseo/plugin/client";

export interface WorkspaceSummaryItem extends PluginWorkspaceSummaryItemState {
  /** Distinguishes two registrations of the same item; never reused. */
  entryKey: number;
  serverId: string;
  pluginId: string;
  itemId: string;
  workspaceId: string;
  /** Resolved for the current locale when the item is added. */
  title: string;
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
    state.workState =
      patch.workState === "working" || patch.workState === "done" ? patch.workState : undefined;
  }
  return state;
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
    const build = (state: PluginWorkspaceSummaryItemState): WorkspaceSummaryItem => ({
      ...state,
      entryKey,
      serverId: owner.serverId,
      pluginId: owner.pluginId,
      itemId,
      workspaceId,
      title,
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

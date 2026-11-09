import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";

interface SnoozeFields {
  snoozedAt?: string | null;
  snoozedUntil?: string | null;
}

/** workspaceKey -> when its snooze ends, null for "until I wake it". */
export type SnoozedSidebarKeys = ReadonlyMap<string, string | null>;

export interface SnoozedSidebarGroups {
  /** Soonest to wake first; indefinite snoozes last. */
  snoozedChats: SidebarWorkspacePlacement[];
  /** The same projects with snoozed chats removed, so nothing above lists them twice. */
  awakeProjects: SidebarProjectEntry[];
}

const EMPTY_KEYS: SnoozedSidebarKeys = new Map();

function buildSnoozedSidebarKeys(
  projects: SidebarProjectEntry[],
  workspaceMaps: ReadonlyMap<string, ReadonlyMap<string, SnoozeFields>>,
): SnoozedSidebarKeys {
  const keys = new Map<string, string | null>();
  for (const project of projects) {
    for (const placement of project.workspaces) {
      const workspace = workspaceMaps.get(placement.serverId)?.get(placement.workspaceId);
      if (workspace?.snoozedAt) keys.set(placement.workspaceKey, workspace.snoozedUntil ?? null);
    }
  }
  return keys.size === 0 ? EMPTY_KEYS : keys;
}

function areSnoozedSidebarKeysEqual(left: SnoozedSidebarKeys, right: SnoozedSidebarKeys): boolean {
  if (left.size !== right.size) return false;
  for (const [key, until] of left) {
    if (!right.has(key) || right.get(key) !== until) return false;
  }
  return true;
}

export function useSnoozedSidebarKeys(projects: SidebarProjectEntry[]): SnoozedSidebarKeys {
  const previousKeysRef = useRef<SnoozedSidebarKeys>(EMPTY_KEYS);
  const serverIds = useMemo(
    () =>
      Array.from(
        new Set(
          projects.flatMap((project) => project.workspaces.map((workspace) => workspace.serverId)),
        ),
      ),
    [projects],
  );
  const workspaceMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => serverIds.map((serverId) => state.sessions[serverId]?.workspaces ?? null),
    shallow,
  );
  return useMemo(() => {
    const workspaceMapByServerId = new Map<string, ReadonlyMap<string, SnoozeFields>>();
    for (let index = 0; index < serverIds.length; index += 1) {
      const serverId = serverIds[index];
      const workspaceMap = workspaceMaps[index];
      if (serverId && workspaceMap) workspaceMapByServerId.set(serverId, workspaceMap);
    }
    const nextKeys = buildSnoozedSidebarKeys(projects, workspaceMapByServerId);
    if (areSnoozedSidebarKeysEqual(previousKeysRef.current, nextKeys)) {
      return previousKeysRef.current;
    }
    previousKeysRef.current = nextKeys;
    return nextKeys;
  }, [projects, serverIds, workspaceMaps]);
}

function compareSnoozeEnd(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

// Snoozed chats leave their project and the Pinned section for a Snoozed section at the bottom.
export function splitSnoozedSidebarGroups(input: {
  projects: SidebarProjectEntry[];
  keys: SnoozedSidebarKeys;
}): SnoozedSidebarGroups {
  const { projects, keys } = input;
  if (keys.size === 0) return { snoozedChats: [], awakeProjects: projects };
  const snoozedChats: SidebarWorkspacePlacement[] = [];
  const awakeProjects: SidebarProjectEntry[] = [];
  for (const project of projects) {
    const workspaces: SidebarWorkspacePlacement[] = [];
    for (const workspace of project.workspaces) {
      (keys.has(workspace.workspaceKey) ? snoozedChats : workspaces).push(workspace);
    }
    // Keep the project even when every chat is snoozed: its row owns the new-workspace action.
    awakeProjects.push(
      workspaces.length === project.workspaces.length ? project : { ...project, workspaces },
    );
  }
  snoozedChats.sort((a, b) =>
    compareSnoozeEnd(keys.get(a.workspaceKey) ?? null, keys.get(b.workspaceKey) ?? null),
  );
  return { snoozedChats, awakeProjects };
}

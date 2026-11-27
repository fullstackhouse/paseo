import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";
import { buildDelegatedWorkspaceIds } from "@/subagents/delegated-workspaces";

const EMPTY_KEYS: ReadonlySet<string> = new Set();

function areKeySetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}

/** Sidebar keys of workspaces whose agents are all subagents of another workspace's agent. */
export function useDelegatedSidebarKeys(projects: SidebarProjectEntry[]): ReadonlySet<string> {
  const previousKeysRef = useRef<ReadonlySet<string>>(EMPTY_KEYS);
  const serverIds = useMemo(
    () =>
      Array.from(
        new Set(
          projects.flatMap((project) => project.workspaces.map((workspace) => workspace.serverId)),
        ),
      ),
    [projects],
  );
  const agentMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => serverIds.map((serverId) => state.sessions[serverId]?.agents ?? null),
    shallow,
  );
  const delegatedIdsByServerId = useMemo(() => {
    const byServerId = new Map<string, ReadonlySet<string>>();
    serverIds.forEach((serverId, index) => {
      const agents = agentMaps[index];
      if (agents) byServerId.set(serverId, buildDelegatedWorkspaceIds(agents));
    });
    return byServerId;
  }, [agentMaps, serverIds]);
  return useMemo(() => {
    const keys = new Set<string>();
    for (const project of projects) {
      for (const placement of project.workspaces) {
        if (delegatedIdsByServerId.get(placement.serverId)?.has(placement.workspaceId)) {
          keys.add(placement.workspaceKey);
        }
      }
    }
    const nextKeys = keys.size === 0 ? EMPTY_KEYS : keys;
    if (areKeySetsEqual(previousKeysRef.current, nextKeys)) return previousKeysRef.current;
    previousKeysRef.current = nextKeys;
    return nextKeys;
  }, [delegatedIdsByServerId, projects]);
}

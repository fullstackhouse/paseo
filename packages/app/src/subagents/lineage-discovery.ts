import { useEffect, useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import {
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";
import { createLineageSelector, lineageCrossesWorkspace } from "./lineage";
import { useLineageFocus } from "./lineage-focus";

/**
 * Adds the Lineage tab to Explorer once per workspace, the first time the focused agent has a parent
 * or child in another workspace. Those relatives are what the sidebar doesn't connect to this one.
 */
export function useLineageAutoOpen(input: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string | null;
  workspaceActive: boolean;
}): void {
  const { serverId, workspaceId, workspaceKey, workspaceActive } = input;
  const hydrated = useWorkspaceLayoutStoreHydrated();
  const focus = useLineageFocus(serverId, workspaceId);
  const selectLineage = useMemo(() => createLineageSelector(focus), [focus]);
  const crosses = useSessionStore((state) =>
    lineageCrossesWorkspace(selectLineage(state), { serverId, workspaceId }),
  );
  useEffect(() => {
    if (hydrated && workspaceActive && crosses && workspaceKey) {
      useWorkspaceLayoutStore.getState().autoOpenLineageTab(workspaceKey);
    }
  }, [crosses, hydrated, workspaceActive, workspaceKey]);
}

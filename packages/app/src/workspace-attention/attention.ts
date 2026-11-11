import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceSummaryItems } from "@/plugins/workspace-summary/store";
import { deriveAttentionItems, type AttentionItem } from "./model";

export type { AttentionItem } from "./model";

/** Live attention items for one workspace. */
export function useWorkspaceAttention(serverId: string, workspaceId: string): AttentionItem[] {
  const agents = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      if (!session) return [];
      return [...session.agents.values()].filter((agent) => agent.workspaceId === workspaceId);
    }),
  );
  const pullRequest = useSessionStore(
    (state) => state.sessions[serverId]?.workspaces.get(workspaceId)?.githubRuntime?.pullRequest,
  );
  const summaryItems = useWorkspaceSummaryItems(serverId, workspaceId);
  return useMemo(
    () => deriveAttentionItems({ agents, summaryItems, pullRequest }),
    [agents, summaryItems, pullRequest],
  );
}

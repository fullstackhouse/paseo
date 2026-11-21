import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useViewedSheetAgent } from "@/screens/workspace/sheet-pane/sheet-pane";
import {
  buildWorkspacePaneContentModel,
  WorkspacePaneContent,
} from "@/screens/workspace/workspace-pane-content";

function ignore() {}

/**
 * An archived workspace's agent, read-only, under the recovery banner. It renders through
 * the "sheet" pane host, the read-only agent view without a composer, so its conversation
 * can be read before deciding whether to restore. Nothing in it can change the workspace.
 */
export function ArchivedWorkspacePreview({
  serverId,
  workspaceId,
  agentId,
  banner,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  banner: ReactNode;
}) {
  // Not a workspace tab, so the timeline is only fetched once this view registers the agent.
  useViewedSheetAgent({ sourceId: `archived-preview:${workspaceId}`, serverId, agentId });
  const content = useMemo(
    () =>
      buildWorkspacePaneContentModel({
        tab: {
          key: `archived-preview:${agentId}`,
          tabId: `archived-preview:${agentId}`,
          kind: "agent",
          target: { kind: "agent", agentId },
        },
        normalizedServerId: serverId,
        normalizedWorkspaceId: workspaceId,
        host: "sheet",
        readOnly: true,
        onOpenTab: ignore,
        onOpenPreferredTarget: ignore,
        onCloseCurrentTab: ignore,
        onRetargetCurrentTab: ignore,
        onSetCurrentTabState: ignore,
        onOpenWorkspaceFile: ignore,
        onOpenImportSheet: ignore,
      }),
    [agentId, serverId, workspaceId],
  );
  return (
    <View style={styles.container} testID="archived-workspace-preview">
      {banner}
      <View style={styles.conversation}>
        <WorkspacePaneContent content={content} isWorkspaceFocused isPaneFocused={false} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignSelf: "stretch",
  },
  conversation: {
    flex: 1,
    minHeight: 0,
  },
});

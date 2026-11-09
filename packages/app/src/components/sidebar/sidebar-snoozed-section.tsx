import { useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { ToggleSidebarWorkspacePin } from "@/hooks/use-sidebar-workspace-pin";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import {
  buildStatusRowProjectPresentation,
  StatusWorkspaceRow,
} from "@/components/sidebar/sidebar-status-list";

interface SidebarSnoozedSectionProps {
  workspaces: SidebarWorkspaceEntry[];
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  shortcutIndexByWorkspaceKey: ReadonlyMap<string, number>;
  showShortcutBadges: boolean;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
}

/** Snoozed workspaces, at the bottom of the sidebar in every grouping mode. Starts collapsed. */
export function SidebarSnoozedSection(props: SidebarSnoozedSectionProps) {
  const { t } = useTranslation();
  const collapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedSnoozed);
  const toggleCollapsed = useSidebarCollapsedSectionsStore((state) => state.toggleSnoozedCollapsed);
  const blockedCountByServerId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const workspace of props.workspaces) {
      if (workspace.statusBucket !== "needs_input") continue;
      counts.set(workspace.serverId, (counts.get(workspace.serverId) ?? 0) + 1);
    }
    return counts;
  }, [props.workspaces]);

  if (props.workspaces.length === 0) return null;

  return (
    <View style={styles.section} testID="sidebar-snoozed-section">
      <SidebarSectionHeader
        title={t("sidebar.snoozed.title")}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        testID="sidebar-snoozed-section-header"
      >
        {[...blockedCountByServerId].map(([serverId, count]) => (
          <SnoozedBlockedCount key={serverId} serverId={serverId} count={count} />
        ))}
      </SidebarSectionHeader>
      {collapsed
        ? null
        : props.workspaces.map((workspace) => (
            <StatusWorkspaceRow
              key={workspace.workspaceKey}
              workspace={workspace}
              {...buildStatusRowProjectPresentation({
                workspace,
                projectIconByProjectViewKey: props.projectIconByProjectViewKey,
                hostBadgeByServerId: props.hostBadgeByServerId,
              })}
              inStatusGroup={false}
              shortcutNumber={props.shortcutIndexByWorkspaceKey.get(workspace.workspaceKey) ?? null}
              showShortcutBadge={props.showShortcutBadges}
              canPin={props.supportsPinningByServerId.get(workspace.serverId) === true}
              onToggleWorkspacePin={props.onToggleWorkspacePin}
            />
          ))}
    </View>
  );
}

// Only a host set to "badge" counts agents blocked on you; "silent" shows nothing and "wake"
// wakes the workspace before it would be counted.
function SnoozedBlockedCount({ serverId, count }: { serverId: string; count: number }) {
  const { t } = useTranslation();
  const { config } = useDaemonConfig(serverId);
  if (config?.snoozedPermission !== "badge") return null;
  return (
    <Text
      style={styles.blockedCount}
      accessibilityLabel={t("sidebar.snoozed.blocked", { count })}
      testID="sidebar-snoozed-blocked-count"
    >
      {count}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginTop: theme.spacing[1],
  },
  blockedCount: {
    color: theme.colors.statusDotWarning,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
}));

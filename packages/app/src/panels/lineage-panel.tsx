import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useAgentDescriptor } from "@/agent-presentation";
import { StatusIcon } from "@/components/status-icon";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor, type PanelPresentation } from "@/panels/panel-registry";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import { createLineageSelector, isInWorkspace, type LineageNode } from "@/subagents/lineage";
import { useLineageFocus } from "@/subagents/lineage-focus";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const ThemedGitFork = withUnistyles(GitFork);
const ICON_SIZE = 16;
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export const lineagePanelPresentation = {
  label: (t) => t("panels.lineage.label"),
  subtitle: (t) => t("panels.lineage.subtitle"),
  tooltip: (t) => t("panels.lineage.tooltip"),
  icon: ThemedGitFork,
} satisfies PanelPresentation;

function LineagePanel(): ReactElement {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "lineage", "LineagePanel requires lineage target");
  const focus = useLineageFocus(serverId, workspaceId);
  const selectLineage = useMemo(() => createLineageSelector(focus), [focus]);
  const lineage = useSessionStore(selectLineage);
  const workspace = useMemo(() => ({ serverId, workspaceId }), [serverId, workspaceId]);

  if (!focus) {
    return <EmptyState text={t("panels.lineage.noAgent")} />;
  }
  if (lineage.ancestors.length === 0 && lineage.children.length === 0) {
    return <EmptyState text={t("panels.lineage.empty")} />;
  }

  // Children elsewhere come first: they are the ones the sidebar doesn't tie to this workspace.
  const elsewhere = lineage.children.filter((node) => !isInWorkspace(node, workspace));
  const here = lineage.children.filter((node) => isInWorkspace(node, workspace));

  return (
    // Themed insets sit on a View: contentContainerStyle drops them on web (docs/unistyles.md).
    <ScrollView testID="lineage-panel">
      <View style={styles.body}>
        {lineage.ancestors.length > 0 ? (
          <Section title={t("panels.lineage.startedBy")}>
            {lineage.ancestors.map((node) => (
              <LineageRow key={nodeKey(node)} node={node} workspace={workspace} />
            ))}
          </Section>
        ) : null}
        <FocusRow address={focus} />
        {elsewhere.length > 0 ? (
          <Section title={t("panels.lineage.inOtherWorkspaces")}>
            {elsewhere.map((node) => (
              <LineageRow key={nodeKey(node)} node={node} workspace={workspace} />
            ))}
          </Section>
        ) : null}
        {here.length > 0 ? (
          <Section title={t("panels.lineage.inThisWorkspace")}>
            {here.map((node) => (
              <LineageRow key={nodeKey(node)} node={node} workspace={workspace} />
            ))}
          </Section>
        ) : null}
      </View>
    </ScrollView>
  );
}

function nodeKey(node: LineageNode): string {
  return `${node.address.serverId}:${node.address.agentId}`;
}

function EmptyState({ text }: { text: string }): ReactElement {
  return (
    <View style={styles.centerState} testID="lineage-panel-empty">
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactElement[] }): ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

/** The agent whose lineage this is, between its parents and its children. Not pressable: it's already open. */
function FocusRow({ address }: { address: AgentAddress }): ReactElement {
  const { t } = useTranslation();
  const descriptor = useAgentDescriptor(
    { kind: "agent", agentId: address.agentId },
    { serverId: address.serverId },
  );
  return (
    <View style={styles.section}>
      <View style={styles.rowFocus} testID="lineage-focus-row">
        <RowIcon descriptor={descriptor} />
        <Text style={styles.rowTitle} numberOfLines={1}>
          {descriptor.label || t("panels.lineage.agent")}
        </Text>
      </View>
    </View>
  );
}

function RowIcon({ descriptor }: { descriptor: PanelDescriptor }): ReactElement {
  return (
    <StatusIcon statusBucket={descriptor.statusBucket} size={ICON_SIZE} backdrop="surface1">
      <ThemedIcon icon={descriptor.icon} uniProps={foregroundColorMapping} />
    </StatusIcon>
  );
}

function AgentIcon({
  icon: Icon,
  color = "",
}: {
  icon: PanelDescriptor["icon"];
  color?: string;
}): ReactElement {
  return <Icon size={ICON_SIZE} color={color} />;
}
const ThemedIcon = withUnistyles(AgentIcon);

function useNodeFacts(
  node: LineageNode,
  workspace: { serverId: string; workspaceId: string },
): string {
  const { t } = useTranslation();
  const hostLabel = useHosts().find((host) => host.serverId === node.address.serverId)?.label;
  const workspaceFacts = useWorkspaceFields(node.address.serverId, node.workspaceId, (entry) => ({
    name: entry.name,
    project: entry.projectCustomName || entry.projectDisplayName,
  }));
  if (node.missing) return t("panels.lineage.notLoaded");
  // Detached leads: the workspace name can be long, and truncation must not hide the link state.
  const parts: string[] = node.detached ? [t("panels.lineage.detached")] : [];
  if (!isInWorkspace(node, workspace) && workspaceFacts) {
    parts.push(workspaceFacts.name, workspaceFacts.project);
  }
  if (node.address.serverId !== workspace.serverId && hostLabel) parts.push(hostLabel);
  if (node.archived) parts.push(t("panels.lineage.archived"));
  return parts.join(" · ");
}

function LineageRow({
  node,
  workspace,
}: {
  node: LineageNode;
  workspace: { serverId: string; workspaceId: string };
}): ReactElement {
  const { t } = useTranslation();
  const descriptor = useAgentDescriptor(
    { kind: "agent", agentId: node.address.agentId },
    { serverId: node.address.serverId },
  );
  const facts = useNodeFacts(node, workspace);
  const label = node.missing
    ? t("panels.lineage.agent")
    : descriptor.label || t("panels.lineage.agent");
  const open = useCallback(() => {
    navigateToAgent({ serverId: node.address.serverId, agentId: node.address.agentId });
  }, [node.address.agentId, node.address.serverId]);

  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={facts ? `${label}, ${facts}` : label}
      disabled={node.missing}
      onPress={open}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={hovered ? styles.rowActive : styles.row}
      highlightStyle={styles.rowPressed}
      testID={`lineage-row-${node.address.agentId}`}
    >
      <RowIcon descriptor={descriptor} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        {facts ? (
          <Text style={styles.rowFacts} numberOfLines={1}>
            {facts}
          </Text>
        ) : null}
      </View>
    </PressHighlight>
  );
}

export const lineagePanelRegistration = definePanel("lineage", {
  component: LineagePanel,
  presentation: lineagePanelPresentation,
});

const styles = StyleSheet.create((theme) => {
  const row = {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  } as const;
  return {
    body: {
      padding: theme.spacing[2],
      gap: theme.spacing[3],
    },
    section: {
      gap: theme.spacing[0.5],
    },
    sectionLabel: {
      paddingHorizontal: theme.spacing[2],
      paddingBottom: theme.spacing[1],
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foregroundMuted,
    },
    row,
    rowActive: { ...row, backgroundColor: theme.colors.surface2 },
    rowPressed: { backgroundColor: theme.colors.surface2 },
    rowFocus: { ...row, backgroundColor: theme.colors.surface1 },
    rowText: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: "auto",
      minWidth: 0,
    },
    rowTitle: {
      flexShrink: 1,
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
    },
    rowFacts: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    centerState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing[4],
    },
    emptyText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      textAlign: "center",
    },
  };
});

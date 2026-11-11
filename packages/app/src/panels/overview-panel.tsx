import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { LayoutDashboard } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useShallow } from "zustand/shallow";
import { useAgentDescriptor } from "@/agent-presentation";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import { useGitActions } from "@/git/use-actions";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor, type PanelPresentation } from "@/panels/panel-registry";
import {
  useWorkspaceSummaryItems,
  type WorkspaceSummaryItem,
} from "@/plugins/workspace-summary/store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import { useLineageFocus } from "@/subagents/lineage-focus";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useWorkspaceAttention } from "@/workspace-attention/attention";
import { showExplorerForAttention } from "@/workspace-attention/auto-show";
import type { AttentionItem } from "@/workspace-attention/model";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { deriveOverviewNextStep } from "./overview/next-step";

const ThemedLayoutDashboard = withUnistyles(LayoutDashboard);
const ICON_SIZE = 16;
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export const overviewPanelPresentation = {
  label: (t) => t("panels.overview.label"),
  subtitle: (t) => t("panels.overview.subtitle"),
  tooltip: (t) => t("panels.overview.tooltip"),
  icon: ThemedLayoutDashboard,
} satisfies PanelPresentation;

type PullRequest = NonNullable<NonNullable<WorkspaceDescriptor["githubRuntime"]>["pullRequest"]>;

function selectWorkspaceFacts(workspace: WorkspaceDescriptor) {
  return {
    cwd: workspace.workspaceDirectory,
    // A plain folder has nothing to ship; checkouts and worktrees do, even before git status loads.
    isGitWorkspace: workspace.workspaceKind !== "directory",
    branch: workspace.gitRuntime?.currentBranch ?? null,
    ahead: workspace.gitRuntime?.aheadOfOrigin ?? null,
    behind: workspace.gitRuntime?.behindOfOrigin ?? null,
    isDirty: workspace.gitRuntime?.isDirty ?? null,
    diffStat: workspace.diffStat,
    pullRequest: workspace.githubRuntime?.pullRequest ?? null,
  };
}

function OverviewPanel(): ReactElement {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "overview", "OverviewPanel requires overview target");
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const facts = useWorkspaceFields(serverId, workspaceId, selectWorkspaceFacts);
  const summaryItems = useWorkspaceSummaryItems(serverId, workspaceId);
  const showGit = Boolean(facts?.isGitWorkspace);

  return (
    // Themed insets sit on a View: contentContainerStyle drops them on web (docs/unistyles.md).
    <ScrollView testID="overview-panel">
      <View style={styles.body}>
        <NextStepSection
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceKey={workspaceKey}
          cwd={facts?.cwd ?? ""}
          isGitWorkspace={showGit}
        />
        <Section title={t("panels.overview.agent")}>
          <AgentRow serverId={serverId} workspaceId={workspaceId} />
        </Section>
        {summaryItems.length > 0 && workspaceKey ? (
          <Section title={t("panels.overview.plugins")}>
            {summaryItems.map((item) => (
              <PluginSummaryRow key={item.entryKey} item={item} workspaceKey={workspaceKey} />
            ))}
          </Section>
        ) : null}
        {showGit && facts && workspaceKey ? (
          <GitSections facts={facts} workspaceKey={workspaceKey} />
        ) : null}
      </View>
    </ScrollView>
  );
}

function NextStepSection({
  serverId,
  workspaceId,
  workspaceKey,
  cwd,
  isGitWorkspace,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string | null;
  cwd: string;
  isGitWorkspace: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const items = useWorkspaceAttention(serverId, workspaceId);
  const agentRunning = useSessionStore((state) => {
    const session = state.sessions[serverId];
    if (!session) return false;
    for (const agent of session.agents.values()) {
      if (agent.workspaceId === workspaceId && !agent.archivedAt && agent.status === "running") {
        return true;
      }
    }
    return false;
  });
  const { gitActions, isGit: gitStatusLoaded } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });
  const nextStep = deriveOverviewNextStep({ items, agentRunning });
  let content: ReactElement | null = null;
  if (nextStep.kind === "working") {
    content = <Text style={styles.muted}>{t("panels.overview.working")}</Text>;
  } else if (nextStep.kind === "attention" && workspaceKey) {
    content = (
      <AttentionStep item={nextStep.item} serverId={serverId} workspaceKey={workspaceKey} />
    );
  } else if (nextStep.kind === "git" && !isGitWorkspace) {
    content = <Text style={styles.muted}>{t("panels.overview.notGit")}</Text>;
  } else if (nextStep.kind === "git" && gitStatusLoaded) {
    content = <GitActionsSplitButton gitActions={gitActions} />;
  }
  return (
    <Section title={t("panels.overview.nextStep")}>
      <View style={styles.nextStep} testID="overview-next-step">
        {content}
      </View>
    </Section>
  );
}

function PluginSummaryRow({
  item,
  workspaceKey,
}: {
  item: WorkspaceSummaryItem;
  workspaceKey: string;
}): ReactElement {
  const open = useCallback(
    () => showExplorerForAttention(workspaceKey, { kind: "plugin", key: item.key ?? "", item }),
    [item, workspaceKey],
  );
  return (
    <Row
      title={item.title}
      facts={item.label}
      onPress={item.panelId ? open : undefined}
      testID={`overview-plugin-${item.pluginId}-${item.itemId}`}
    />
  );
}

function GitSections({
  facts,
  workspaceKey,
}: {
  facts: ReturnType<typeof selectWorkspaceFacts>;
  workspaceKey: string;
}): ReactElement {
  const { t } = useTranslation();
  const openChanges = useCallback(
    () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "changes" }),
    [workspaceKey],
  );
  const openPullRequest = useCallback(
    () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "pr" }),
    [workspaceKey],
  );
  return (
    <>
      <Section title={t("panels.overview.changes")}>
        <Row
          title={facts.branch ?? t("panels.overview.noBranch")}
          facts={syncFacts(facts.ahead, facts.behind, t("panels.overview.inSync"))}
          testID="overview-branch"
        />
        <Row
          title={diffFacts(facts.diffStat) || t("panels.overview.noChanges")}
          facts={facts.isDirty ? t("panels.overview.uncommitted") : undefined}
          onPress={openChanges}
          testID="overview-changes"
        />
      </Section>
      <Section title={t("panels.overview.pullRequest")}>
        {facts.pullRequest ? (
          <Row
            title={pullRequestTitle(facts.pullRequest)}
            facts={pullRequestFacts(facts.pullRequest, t)}
            onPress={openPullRequest}
            testID="overview-pull-request"
          />
        ) : (
          <Row title={t("panels.overview.noPullRequest")} testID="overview-pull-request" />
        )}
      </Section>
    </>
  );
}

function syncFacts(ahead: number | null, behind: number | null, inSync: string): string {
  const parts = [ahead ? `↑${ahead}` : "", behind ? `↓${behind}` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : inSync;
}

function diffFacts(diffStat: { additions: number; deletions: number } | null): string {
  if (!diffStat || (diffStat.additions === 0 && diffStat.deletions === 0)) return "";
  return `+${diffStat.additions} −${diffStat.deletions}`;
}

function pullRequestTitle(pr: PullRequest): string {
  return pr.number ? `#${pr.number} ${pr.title}` : pr.title;
}

function pullRequestFacts(pr: PullRequest, t: (key: string) => string): string {
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

function AttentionStep({
  item,
  serverId,
  workspaceKey,
}: {
  item: AttentionItem;
  serverId: string;
  workspaceKey: string;
}): ReactElement {
  const { t } = useTranslation();
  const press = useCallback(() => {
    if (item.kind === "permission" || item.kind === "failed") {
      navigateToAgent({ serverId, agentId: item.agentId });
      return;
    }
    showExplorerForAttention(workspaceKey, item);
  }, [item, serverId, workspaceKey]);
  const { label, reason } = useMemo(() => {
    switch (item.kind) {
      case "permission":
        return {
          label: t("panels.overview.reviewPermission"),
          reason: t("panels.overview.permissionReason"),
        };
      case "failed":
        return { label: t("panels.overview.openAgent"), reason: t("panels.overview.failedReason") };
      case "plugin":
        return { label: item.item.title, reason: item.item.label ?? "" };
      default:
        return {
          label: t("panels.overview.openPullRequest"),
          reason: t("panels.overview.checksFailedReason"),
        };
    }
  }, [item, t]);
  return (
    <>
      <View style={styles.stepButton}>
        <Button variant="default" onPress={press} testID="overview-next-step-button">
          {label}
        </Button>
      </View>
      {reason ? <Text style={styles.muted}>{reason}</Text> : null}
    </>
  );
}

function AgentRow({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement {
  const { t } = useTranslation();
  const focus = useLineageFocus(serverId, workspaceId);
  if (!focus) return <Row title={t("panels.overview.noAgent")} testID="overview-agent" />;
  return <FocusedAgentRow serverId={focus.serverId} agentId={focus.agentId} />;
}

function FocusedAgentRow({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement {
  const { t } = useTranslation();
  const descriptor = useAgentDescriptor({ kind: "agent", agentId }, { serverId });
  const context = useSessionStore(
    useShallow((state) => {
      const usage = state.sessions[serverId]?.agents.get(agentId)?.lastUsage;
      return {
        used: usage?.contextWindowUsedTokens ?? null,
        max: usage?.contextWindowMaxTokens ?? null,
      };
    }),
  );
  const open = useCallback(() => navigateToAgent({ serverId, agentId }), [agentId, serverId]);
  const contextFacts =
    context.used && context.max
      ? t("panels.overview.context", {
          used: formatTokens(context.used),
          max: formatTokens(context.max),
        })
      : undefined;
  return (
    <Row
      agentDescriptor={descriptor}
      title={descriptor.label || t("panels.overview.agent")}
      facts={contextFacts}
      onPress={open}
      testID="overview-agent"
    />
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}m`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

function AgentStatusIcon({ descriptor }: { descriptor: PanelDescriptor }): ReactElement {
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

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  agentDescriptor,
  title,
  facts,
  onPress,
  testID,
}: {
  agentDescriptor?: PanelDescriptor;
  title: string;
  facts?: string;
  onPress?: () => void;
  testID: string;
}): ReactElement {
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const content = (
    <>
      {agentDescriptor ? <AgentStatusIcon descriptor={agentDescriptor} /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {facts ? (
          <Text style={styles.rowFacts} numberOfLines={1}>
            {facts}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={facts ? `${title}, ${facts}` : title}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={hovered ? styles.rowActive : styles.row}
      highlightStyle={styles.rowPressed}
      testID={testID}
    >
      {content}
    </PressHighlight>
  );
}

export const overviewPanelRegistration = definePanel("overview", {
  component: OverviewPanel,
  presentation: overviewPanelPresentation,
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
    nextStep: {
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      alignItems: "flex-start",
    },
    stepButton: {
      flexDirection: "row",
    },
    muted: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    row,
    rowActive: { ...row, backgroundColor: theme.colors.surface2 },
    rowPressed: { backgroundColor: theme.colors.surface2 },
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
  };
});

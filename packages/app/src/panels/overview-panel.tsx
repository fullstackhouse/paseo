import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronRight,
  CircleAlert,
  CornerDownRight,
  CornerLeftUp,
  Ellipsis,
  GitBranch,
  GitFork,
  GitPullRequest,
  LayoutDashboard,
  MessageCircleQuestion,
  ShieldQuestion,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useShallow } from "zustand/shallow";
import { useAgentDescriptor } from "@/agent-presentation";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { iconButtonChromeStyle } from "@/components/ui/icon-button-chrome";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import {
  useGitActionRunner,
  useGitActions,
  type GitAction,
  type GitActions,
} from "@/git/use-actions";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor, type PanelPresentation } from "@/panels/panel-registry";
import {
  useWorkspaceSummaryItems,
  type WorkspaceSummaryItem,
} from "@/plugins/workspace-summary/store";
import { WorkspaceSummaryEntryView } from "@/plugins/workspace-summary/entry-view";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import {
  createLineageSelector,
  deriveWorkspaceLineage,
  type WorkspaceRef,
} from "@/subagents/lineage";
import { useLineageFocus } from "@/subagents/lineage-focus";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatTimeAgo } from "@/utils/time";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { useWorkspaceAttention } from "@/workspace-attention/attention";
import { hasRunningAgent } from "@/workspace-attention/model";
import { showExplorerForAttention } from "@/workspace-attention/auto-show";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  deriveWorkspaceStateWord,
  deriveYourMove,
  partitionSummaryItems,
  type WorkspaceStateWord,
  type YourMoveRow,
} from "./overview/model";

const ThemedLayoutDashboard = withUnistyles(LayoutDashboard);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedGitFork = withUnistyles(GitFork);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedCornerLeftUp = withUnistyles(CornerLeftUp);
const ThemedCornerDownRight = withUnistyles(CornerDownRight);
const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedArchive = withUnistyles(Archive);
const ThemedAsk = withUnistyles(MessageCircleQuestion);
const ThemedShield = withUnistyles(ShieldQuestion);
const ThemedAlert = withUnistyles(CircleAlert);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const ICON_SIZE = 16;
const SMALL_ICON_SIZE = 14;
const MENU_LINEAGE_ICON = <ThemedGitFork size={ICON_SIZE} uniProps={mutedColorMapping} />;
const MENU_ARCHIVE_ICON = <ThemedArchive size={ICON_SIZE} uniProps={mutedColorMapping} />;
/** Child workspaces listed before "Show all". */
const VISIBLE_CHILDREN = 4;

export const overviewPanelPresentation = {
  label: (t) => t("panels.overview.label"),
  subtitle: (t) => t("panels.overview.subtitle"),
  tooltip: (t) => t("panels.overview.tooltip"),
  icon: ThemedLayoutDashboard,
} satisfies PanelPresentation;

type PullRequest = NonNullable<NonNullable<WorkspaceDescriptor["githubRuntime"]>["pullRequest"]>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

function selectWorkspaceFacts(workspace: WorkspaceDescriptor) {
  return {
    name: workspace.name,
    project: workspace.projectCustomName || workspace.projectDisplayName,
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
type WorkspaceFacts = ReturnType<typeof selectWorkspaceFacts>;

function OverviewPanel(): ReactElement {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "overview", "OverviewPanel requires overview target");
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const facts = useWorkspaceFields(serverId, workspaceId, selectWorkspaceFacts);
  const summaryItems = useWorkspaceSummaryItems(serverId, workspaceId);
  const { status, more } = useMemo(() => partitionSummaryItems(summaryItems), [summaryItems]);
  const agentRunning = useSessionStore((state) =>
    hasRunningAgent(state.sessions[serverId]?.agents, workspaceId),
  );
  const isGitWorkspace = Boolean(facts?.isGitWorkspace);
  const { gitActions, isGit: gitStatusLoaded } = useGitActions({
    serverId,
    cwd: facts?.cwd ?? "",
    icons: GIT_ACTION_ICONS,
  });
  const git = isGitWorkspace && gitStatusLoaded ? gitActions : null;

  return (
    // Themed insets sit on a View: contentContainerStyle drops them on web (docs/unistyles.md).
    <ScrollView testID="overview-panel">
      <View style={styles.body}>
        <View style={styles.where}>
          <WorkspaceHeader facts={facts} workspaceKey={workspaceKey} gitActions={git} />
          <AgentRow serverId={serverId} workspaceId={workspaceId} />
          <WorkspaceLineageBlock serverId={serverId} workspaceId={workspaceId} />
        </View>
        <StatusSection item={status} agentRunning={agentRunning} workspaceKey={workspaceKey} />
        <YourMoveSection
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceKey={workspaceKey}
          agentRunning={agentRunning}
          facts={facts}
          gitActions={git}
        />
        {isGitWorkspace && facts && workspaceKey ? (
          <CodeSection facts={facts} workspaceKey={workspaceKey} />
        ) : null}
        {more.length > 0 && workspaceKey ? (
          <Section title="panels.overview.more">
            {more.map((item) => (
              <PluginSummaryRow key={item.entryKey} item={item} workspaceKey={workspaceKey} />
            ))}
          </Section>
        ) : null}
      </View>
    </ScrollView>
  );
}

// ── Where am I ───────────────────────────────────────────────────────────

function findGitAction(actions: GitActions | null, id: GitAction["id"]): GitAction | null {
  if (!actions) return null;
  const all = [actions.primary, ...actions.secondary, ...actions.menu];
  return all.find((action) => action?.id === id) ?? null;
}

function WorkspaceHeader({
  facts,
  workspaceKey,
  gitActions,
}: {
  facts: WorkspaceFacts | null;
  workspaceKey: string | null;
  gitActions: GitActions | null;
}): ReactElement {
  const { t } = useTranslation();
  const subtitle = [facts?.project, facts?.branch].filter(Boolean).join(" · ");
  return (
    <View style={styles.header} testID="overview-workspace">
      <View style={styles.rowText}>
        <Text style={styles.workspaceName} numberOfLines={2}>
          {facts?.name ?? t("workspace.tabs.loading")}
        </Text>
        {subtitle ? (
          <Text style={styles.rowFacts} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <WorkspaceMenu workspaceKey={workspaceKey} gitActions={gitActions} />
    </View>
  );
}

function menuTriggerStyle(state: { hovered: boolean; pressed: boolean; open: boolean }) {
  return iconButtonChromeStyle({ size: "small", state });
}

/** Rare workspace actions: kept out of the main area so the next step stays the only button. */
function WorkspaceMenu({
  workspaceKey,
  gitActions,
}: {
  workspaceKey: string | null;
  gitActions: GitActions | null;
}): ReactElement {
  const { t } = useTranslation();
  const runGitAction = useGitActionRunner();
  const archive = findGitAction(gitActions, "archive-workspace");
  const openLineage = useCallback(
    () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "lineage" }),
    [workspaceKey],
  );
  const runArchive = useCallback(() => {
    if (archive) runGitAction(archive);
  }, [archive, runGitAction]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="overview-workspace-menu"
        style={menuTriggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.header.actions.workspaceActions")}
      >
        <ThemedEllipsis size={SMALL_ICON_SIZE} uniProps={mutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem leading={MENU_LINEAGE_ICON} onSelect={openLineage}>
          {t("panels.overview.lineageDetails")}
        </DropdownMenuItem>
        {archive ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              leading={MENU_ARCHIVE_ICON}
              disabled={archive.disabled}
              status={archive.status === "pending" ? "pending" : "idle"}
              pendingLabel={archive.pendingLabel}
              onSelect={runArchive}
            >
              {archive.label}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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

/** Lineage by workspace: where this work came from, and the workspaces it handed off to. */
function WorkspaceLineageBlock({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const focus = useLineageFocus(serverId, workspaceId);
  const selectLineage = useMemo(() => createLineageSelector(focus), [focus]);
  const lineage = useSessionStore(selectLineage);
  const { parent, children, subagentsHere } = useMemo(
    () => deriveWorkspaceLineage(lineage, { serverId, workspaceId }),
    [lineage, serverId, workspaceId],
  );
  const expand = useCallback(() => setShowAll(true), []);
  if (!parent && children.length === 0 && subagentsHere === 0) return null;
  const visible = showAll ? children : children.slice(0, VISIBLE_CHILDREN);
  return (
    <View style={styles.lineage} testID="overview-lineage">
      {parent ? (
        <>
          <Text style={styles.lineageLabel}>{t("panels.overview.from")}</Text>
          <LineageWorkspaceRow workspace={parent} direction="up" />
        </>
      ) : null}
      {children.length > 0 ? (
        <>
          <Text style={styles.lineageLabel}>{t("panels.overview.started")}</Text>
          {visible.map((child) => (
            <LineageWorkspaceRow
              key={`${child.serverId}:${child.workspaceId}`}
              workspace={child}
              direction="down"
            />
          ))}
          {visible.length < children.length ? (
            <PressHighlight
              accessibilityRole="button"
              onPress={expand}
              style={styles.showAll}
              highlightStyle={styles.rowPressed}
              testID="overview-lineage-show-all"
            >
              <Text style={styles.showAllText}>
                {t("panels.overview.showAll", { count: children.length })}
              </Text>
            </PressHighlight>
          ) : null}
        </>
      ) : null}
      {subagentsHere > 0 ? (
        <View style={styles.subagentsHere}>
          <ThemedGitFork size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
          <Text style={styles.rowFacts}>
            {t("panels.overview.subagentsHere", { count: subagentsHere })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function selectLineageWorkspace(workspace: WorkspaceDescriptor) {
  return {
    name: workspace.name,
    prMerged: Boolean(workspace.githubRuntime?.pullRequest?.isMerged),
  };
}

function useWorkspaceStateWord(workspace: WorkspaceRef): WorkspaceStateWord {
  const items = useWorkspaceSummaryItems(workspace.serverId, workspace.workspaceId);
  const status = useMemo(() => partitionSummaryItems(items).status?.status ?? null, [items]);
  return useSessionStore((state) => {
    const agents = state.sessions[workspace.serverId]?.agents;
    const target = normalizeWorkspaceOpaqueId(workspace.workspaceId);
    const inWorkspace = agents
      ? [...agents.values()].filter(
          (agent) => normalizeWorkspaceOpaqueId(agent.workspaceId) === target,
        )
      : [];
    return deriveWorkspaceStateWord({ status, agents: inWorkspace });
  });
}

function LineageWorkspaceRow({
  workspace,
  direction,
}: {
  workspace: WorkspaceRef;
  direction: "up" | "down";
}): ReactElement {
  const { t } = useTranslation();
  const fields = useWorkspaceFields(
    workspace.serverId,
    workspace.workspaceId,
    selectLineageWorkspace,
  );
  const word = useWorkspaceStateWord(workspace);
  const open = useCallback(
    () => navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId }),
    [workspace.serverId, workspace.workspaceId],
  );
  const name = fields?.name ?? t("panels.lineage.notLoaded");
  const wordText = fields?.prMerged
    ? `${t(`panels.overview.word.${word}`)} · ${t("panels.overview.prMerged")}`
    : t(`panels.overview.word.${word}`);
  const Icon = direction === "up" ? ThemedCornerLeftUp : ThemedCornerDownRight;
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${wordText}`}
      disabled={!fields}
      onPress={open}
      style={styles.lineageRow}
      highlightStyle={styles.rowPressed}
      testID={`overview-lineage-${direction}-${workspace.workspaceId}`}
    >
      <Icon size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
      <Text style={styles.lineageName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={wordStyle(word)} numberOfLines={1}>
        {wordText}
      </Text>
      {fields ? <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={mutedColorMapping} /> : null}
    </PressHighlight>
  );
}

function wordStyle(word: WorkspaceStateWord) {
  switch (word) {
    case "working":
      return styles.wordWorking;
    case "waiting":
      return styles.wordWaiting;
    case "blocked":
    case "failed":
      return styles.wordDanger;
    case "done":
      return styles.wordDone;
    default:
      return styles.word;
  }
}

// ── Status ───────────────────────────────────────────────────────────────

function StatusSection({
  item,
  agentRunning,
  workspaceKey,
}: {
  item: WorkspaceSummaryItem | null;
  agentRunning: boolean;
  workspaceKey: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const status = item?.status;
  const open = useCallback(() => {
    if (item && workspaceKey) {
      showExplorerForAttention(workspaceKey, { kind: "plugin", key: item.key ?? "", item });
    }
  }, [item, workspaceKey]);
  if (!status) {
    return (
      <Section title="panels.overview.status">
        <Text style={styles.quiet} testID="overview-status-empty">
          {agentRunning
            ? t("panels.overview.statusFallbackWorking")
            : t("panels.overview.statusFallbackIdle")}
        </Text>
      </Section>
    );
  }
  const badge = status.answered ? "answered" : status.state;
  const content = (
    <>
      <View style={styles.cardHead}>
        <View style={badgeStyle(badge)}>
          <Text style={badgeTextStyle(badge)}>{t(`panels.overview.state.${badge}`)}</Text>
        </View>
        <Text style={styles.age} numberOfLines={1}>
          {t("panels.overview.updated", { time: formatTimeAgo(new Date(status.updatedAt)) })}
        </Text>
        {item?.panelId ? (
          <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={mutedColorMapping} />
        ) : null}
      </View>
      <Text style={styles.summary} numberOfLines={4}>
        {status.summary}
      </Text>
      {status.now ? (
        <Text style={styles.rowFacts}>
          <Text style={styles.nowLabel}>{t("panels.overview.now")} </Text>
          {status.now}
        </Text>
      ) : null}
    </>
  );
  return (
    <Section title="panels.overview.status">
      {item?.panelId ? (
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel={status.summary}
          onPress={open}
          style={styles.card}
          highlightStyle={styles.rowPressed}
          testID="overview-status"
        >
          {content}
        </PressHighlight>
      ) : (
        <View style={styles.card} testID="overview-status">
          {content}
        </View>
      )}
    </Section>
  );
}

type BadgeState = "working" | "waiting_on_you" | "blocked" | "done" | "answered";

function badgeStyle(state: BadgeState) {
  if (state === "waiting_on_you") return styles.badgeWarning;
  if (state === "blocked") return styles.badgeDanger;
  if (state === "done") return styles.badgeSuccess;
  return styles.badgeNeutral;
}

function badgeTextStyle(state: BadgeState) {
  if (state === "waiting_on_you") return styles.badgeTextWarning;
  if (state === "blocked") return styles.badgeTextDanger;
  if (state === "done") return styles.badgeTextSuccess;
  if (state === "working") return styles.badgeTextWorking;
  return styles.badgeTextMuted;
}

// ── Your move ────────────────────────────────────────────────────────────

function YourMoveSection({
  serverId,
  workspaceId,
  workspaceKey,
  agentRunning,
  facts,
  gitActions,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string | null;
  agentRunning: boolean;
  facts: WorkspaceFacts | null;
  gitActions: GitActions | null;
}): ReactElement {
  const { t } = useTranslation();
  const items = useWorkspaceAttention(serverId, workspaceId);
  const rows = deriveYourMove({
    items,
    agentRunning,
    gitPrimaryId: gitActions?.primary?.id ?? null,
    prMerged: Boolean(facts?.pullRequest?.isMerged),
  });
  return (
    <Section title="panels.overview.yourMove" count={rows.length > 1 ? rows.length : undefined}>
      {rows.length === 0 ? (
        <Text style={styles.quiet} testID="overview-your-move-empty">
          {agentRunning
            ? t("panels.overview.nothingWhileWorking")
            : t("panels.overview.nothingNeedsYou")}
        </Text>
      ) : (
        rows.map((row, index) => {
          const move = (
            <MoveRow
              key={row.key}
              row={row}
              first={index === 0}
              serverId={serverId}
              workspaceKey={workspaceKey}
              facts={facts}
              gitActions={gitActions}
            />
          );
          // A plugin that renders its own entries (Asks) is acted on in place, not in its tab.
          if (row.kind !== "entry" || !row.item.EntryComponent) return move;
          return (
            <WorkspaceSummaryEntryView
              key={row.key}
              item={row.item}
              entryId={row.entry.id}
              defaultExpanded={index === 0}
            >
              {move}
            </WorkspaceSummaryEntryView>
          );
        })
      )}
    </Section>
  );
}

interface MoveView {
  icon: ReactNode;
  title: string;
  facts?: string;
  action: string;
  run: () => void;
}

function MoveRow({
  row,
  first,
  serverId,
  workspaceKey,
  facts,
  gitActions,
}: {
  row: YourMoveRow;
  first: boolean;
  serverId: string;
  workspaceKey: string | null;
  facts: WorkspaceFacts | null;
  gitActions: GitActions | null;
}): ReactElement | null {
  const view = useMoveView(row, { serverId, workspaceKey, facts, gitActions });
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  if (!view) return null;
  const text = (
    <View style={styles.rowText}>
      <Text style={styles.rowTitle} numberOfLines={2}>
        {view.title}
      </Text>
      {view.facts ? (
        <Text style={styles.rowFacts} numberOfLines={2}>
          {view.facts}
        </Text>
      ) : null}
    </View>
  );
  if (first) {
    return (
      <View style={styles.firstMove} testID={`overview-move-${row.kind}`}>
        <View style={styles.moveIcon}>{view.icon}</View>
        <View style={styles.firstMoveBody}>
          {text}
          <View style={styles.moveButton}>
            <Button variant="default" onPress={view.run} testID="overview-next-step-button">
              {view.action}
            </Button>
          </View>
        </View>
      </View>
    );
  }
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={`${view.action}: ${view.title}`}
      onPress={view.run}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={hovered ? styles.moveActive : styles.move}
      highlightStyle={styles.rowPressed}
      testID={`overview-move-${row.kind}`}
    >
      <View style={styles.moveIcon}>{view.icon}</View>
      {text}
      <ThemedChevronRight size={ICON_SIZE} uniProps={mutedColorMapping} />
    </PressHighlight>
  );
}

function useMoveView(
  row: YourMoveRow,
  context: {
    serverId: string;
    workspaceKey: string | null;
    facts: WorkspaceFacts | null;
    gitActions: GitActions | null;
  },
): MoveView | null {
  const { t } = useTranslation();
  const runGitAction = useGitActionRunner();
  const agentId = row.kind === "permission" || row.kind === "failed" ? row.agentId : "";
  const agent = useAgentDescriptor({ kind: "agent", agentId }, { serverId: context.serverId });
  const { serverId, workspaceKey, facts, gitActions } = context;
  return useMemo(() => {
    switch (row.kind) {
      case "permission":
        return {
          icon: <ThemedShield size={ICON_SIZE} uniProps={warningColorMapping} />,
          title: t("panels.overview.permissionTitle"),
          facts: agent.label || undefined,
          action: t("panels.overview.reviewPermission"),
          run: () => navigateToAgent({ serverId, agentId: row.agentId }),
        };
      case "failed":
        return {
          icon: <ThemedAlert size={ICON_SIZE} uniProps={dangerColorMapping} />,
          title: t("panels.overview.failedReason"),
          facts: agent.label || undefined,
          action: t("panels.overview.openAgent"),
          run: () => navigateToAgent({ serverId, agentId: row.agentId }),
        };
      case "entry":
      case "plugin": {
        const openPanel = () => {
          if (workspaceKey) {
            showExplorerForAttention(workspaceKey, {
              kind: "plugin",
              key: row.item.key ?? "",
              item: row.item,
            });
          }
        };
        return {
          icon: <ThemedAsk size={ICON_SIZE} uniProps={warningColorMapping} />,
          title: row.kind === "entry" ? `${row.entry.id} · ${row.entry.title}` : row.item.title,
          facts: row.kind === "entry" ? row.entry.detail : row.item.label,
          action: t("panels.overview.open"),
          run: openPanel,
        };
      }
      case "checks": {
        const failing = (facts?.pullRequest?.checks ?? [])
          .filter((check) => check.status === "failure")
          .map((check) => check.name);
        return {
          icon: <ThemedAlert size={ICON_SIZE} uniProps={dangerColorMapping} />,
          title: t("panels.overview.checksFailedReason"),
          facts: failing.join(", ") || undefined,
          action: t("panels.overview.openPullRequest"),
          run: () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "pr" }),
        };
      }
      case "git": {
        const primary = gitActions?.primary;
        if (!primary) return null;
        return {
          icon: primary.icon ?? <ThemedGitBranch size={ICON_SIZE} uniProps={mutedColorMapping} />,
          title: gitMoveTitle(facts, t),
          facts: gitMoveFacts(facts, t),
          action: primary.label,
          run: () => runGitAction(primary),
        };
      }
    }
  }, [agent.label, facts, gitActions, row, runGitAction, serverId, t, workspaceKey]);
}

function gitMoveTitle(facts: WorkspaceFacts | null, t: Translate): string {
  const pr = facts?.pullRequest;
  if (pr?.isMerged && pr.number) return t("panels.overview.prMergedTitle", { number: pr.number });
  if (pr) return pullRequestTitle(pr);
  return facts?.branch ?? t("panels.overview.noBranch");
}

function gitMoveFacts(facts: WorkspaceFacts | null, t: Translate): string {
  if (!facts) return "";
  const parts = [syncFacts(facts.ahead, facts.behind, t("panels.overview.inSync"))];
  const diff = diffFacts(facts.diffStat);
  if (diff) parts.push(diff);
  if (facts.isDirty) parts.push(t("panels.overview.uncommitted"));
  return parts.join(" · ");
}

// ── Code ─────────────────────────────────────────────────────────────────

function CodeSection({
  facts,
  workspaceKey,
}: {
  facts: WorkspaceFacts;
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
    <Section title="panels.overview.code">
      <Row
        icon={ThemedGitBranch}
        title={facts.branch ?? t("panels.overview.noBranch")}
        facts={gitMoveFacts(facts, t)}
        onPress={openChanges}
        testID="overview-branch"
      />
      {facts.pullRequest ? (
        <Row
          icon={ThemedGitPullRequest}
          title={pullRequestTitle(facts.pullRequest)}
          facts={pullRequestFacts(facts.pullRequest, t)}
          warning={
            facts.pullRequest.checksStatus === "failure" ||
            facts.pullRequest.reviewDecision === "changes_requested"
          }
          onPress={openPullRequest}
          testID="overview-pull-request"
        />
      ) : null}
    </Section>
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

function pullRequestFacts(pr: PullRequest, t: Translate): string {
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

// ── More ─────────────────────────────────────────────────────────────────

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

// ── Shared rows ──────────────────────────────────────────────────────────

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

/** `title` is an i18n key: section titles never come from data. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const label = count ? `${t(title)} · ${count}` : t(title);
  return (
    <SettingsSection title={label} flush>
      <View style={styles.sectionRows}>{children}</View>
    </SettingsSection>
  );
}

function Row({
  agentDescriptor,
  icon: Icon,
  warning = false,
  title,
  facts,
  onPress,
  testID,
}: {
  agentDescriptor?: PanelDescriptor;
  icon?: typeof ThemedGitBranch;
  warning?: boolean;
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
      {!agentDescriptor && Icon ? <Icon size={ICON_SIZE} uniProps={mutedColorMapping} /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {facts ? (
          <Text style={warning ? styles.rowWarning : styles.rowFacts} numberOfLines={2}>
            {facts}
          </Text>
        ) : null}
      </View>
      {onPress ? <ThemedChevronRight size={ICON_SIZE} uniProps={mutedColorMapping} /> : null}
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
    minHeight: 44,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  } as const;
  const move = { ...row, alignItems: "flex-start" } as const;
  const badge = {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  } as const;
  const badgeText = { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium } as const;
  const word = { fontSize: theme.fontSize.sm, flexShrink: 0 } as const;
  return {
    body: {
      padding: theme.spacing[4],
      gap: theme.spacing[6],
    },
    where: {
      gap: theme.spacing[1],
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingBottom: theme.spacing[1],
    },
    workspaceName: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.foreground,
    },
    lineage: {
      marginLeft: theme.spacing[4],
      paddingLeft: theme.spacing[2],
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.border,
    },
    lineageLabel: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundExtraMuted,
      paddingHorizontal: theme.spacing[2],
      paddingTop: theme.spacing[2],
      paddingBottom: theme.spacing[0.5],
    },
    lineageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      minHeight: 32,
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.borderRadius.md,
    },
    lineageName: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
    },
    word: { ...word, color: theme.colors.foregroundMuted },
    wordWorking: { ...word, color: theme.colors.accentBright },
    wordWaiting: { ...word, color: theme.colors.statusWarning },
    wordDanger: { ...word, color: theme.colors.statusDanger },
    wordDone: { ...word, color: theme.colors.statusSuccess },
    showAll: {
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      borderRadius: theme.borderRadius.md,
    },
    showAllText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      textDecorationLine: "underline",
    },
    subagentsHere: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
    },
    sectionRows: {
      gap: theme.spacing[1],
    },
    quiet: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
    },
    card: {
      gap: theme.spacing[1.5],
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface1,
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    age: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundExtraMuted,
    },
    summary: {
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
    },
    nowLabel: {
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
    },
    badgeNeutral: { ...badge, backgroundColor: theme.colors.surface2 },
    badgeWarning: { ...badge, backgroundColor: theme.colors.statusWarningTint },
    badgeDanger: { ...badge, backgroundColor: theme.colors.statusDangerTint },
    badgeSuccess: { ...badge, backgroundColor: theme.colors.statusSuccessTint },
    badgeTextMuted: { ...badgeText, color: theme.colors.foregroundMuted },
    badgeTextWorking: { ...badgeText, color: theme.colors.accentBright },
    badgeTextWarning: { ...badgeText, color: theme.colors.statusWarning },
    badgeTextDanger: { ...badgeText, color: theme.colors.statusDanger },
    badgeTextSuccess: { ...badgeText, color: theme.colors.statusSuccess },
    firstMove: {
      ...move,
      padding: theme.spacing[3],
      backgroundColor: theme.colors.surface1,
    },
    firstMoveBody: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    move,
    moveActive: { ...move, backgroundColor: theme.colors.interactionHighlight },
    moveIcon: {
      paddingTop: 2,
    },
    moveButton: {
      flexDirection: "row",
    },
    row,
    rowActive: { ...row, backgroundColor: theme.colors.interactionHighlight },
    rowPressed: { backgroundColor: theme.colors.interactionHighlight },
    rowText: {
      gap: theme.spacing[1],
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      flexShrink: 1,
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
    },
    rowWarning: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.destructive,
    },
    rowFacts: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
  };
});

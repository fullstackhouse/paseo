import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronRight,
  CircleAlert,
  GitBranch,
  LayoutDashboard,
  MessageCircleQuestion,
  ShieldQuestion,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import type { AgentPermissionAction, AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import type { PluginWorkspaceStatus } from "@getpaseo/plugin/client";
import { useAgentDescriptor } from "@/agent-presentation";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import {
  type GitAction,
  useGitActionRunner,
  useGitActions,
  type GitActions,
} from "@/git/use-actions";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import {
  useWorkspaceSummaryItems,
  type WorkspaceSummaryItem,
} from "@/plugins/workspace-summary/store";
import { WorkspaceSummaryEntryView } from "@/plugins/workspace-summary/entry-view";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import {
  createLineageSelector,
  deriveWorkspaceLineage,
  type WorkspaceRef,
} from "@/subagents/lineage";
import { isWorkspaceRootAgent } from "@/subagents/workspace-root-policy";
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
  branchFacts,
  canAnswerPermissionInPlace,
  deriveCodeRow,
  deriveWorkspaceStateWord,
  deriveYourMove,
  openMoveKey,
  gitMoveFacts,
  isStatusDone,
  isStatusOutdated,
  overviewSubtitle,
  partitionSummaryItems,
  permissionActions,
  permissionFacts,
  permissionResponse,
  pullRequestFacts,
  type WorkspaceStateWord,
  type YourMoveRow,
} from "./overview/model";

const ThemedLayoutDashboard = withUnistyles(LayoutDashboard);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedArchive = withUnistyles(Archive);
const ThemedAsk = withUnistyles(MessageCircleQuestion);
const ThemedShield = withUnistyles(ShieldQuestion);
const ThemedAlert = withUnistyles(CircleAlert);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const mergedColorMapping = (theme: Theme) => ({ color: theme.colors.statusMerged });
const ICON_SIZE = 16;
const SMALL_ICON_SIZE = 14;
/** Child workspaces listed before "Show all". */
const VISIBLE_CHILDREN = 4;
const PERMISSION_TIMEOUT_MS = 15_000;

export const overviewPanelPresentation = {
  label: (t) => t("panels.overview.label"),
  subtitle: (t) => t("panels.overview.subtitle"),
  tooltip: (t) => t("panels.overview.tooltip"),
  icon: ThemedLayoutDashboard,
} satisfies PanelPresentation;

type PullRequest = NonNullable<NonNullable<WorkspaceDescriptor["githubRuntime"]>["pullRequest"]>;
type Translate = (key: string, options?: Record<string, unknown>) => string;
type Tone = "run" | "warn" | "danger" | "ok" | "muted" | "merged";

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

/**
 * Four blocks, each answering one question: what is this (title, goal), where does it stand
 * (status), what do I do (Your move), then context the first three don't already say.
 */
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
  const moves = useYourMove({
    serverId,
    workspaceId,
    agentRunning,
    facts,
    gitActions: git,
    status: status?.status ?? null,
  });

  return (
    // Themed insets sit on a View: contentContainerStyle drops them on web (docs/unistyles.md).
    <ScrollView testID="overview-panel">
      <View style={styles.body}>
        <Identity
          name={facts?.name ?? null}
          subtitle={overviewSubtitle({
            goal: status?.status?.goal ?? null,
            project: facts?.project ?? null,
          })}
          isGoal={Boolean(status?.status?.goal)}
        />
        <StatusBlock
          item={status}
          serverId={serverId}
          workspaceId={workspaceId}
          agentRunning={agentRunning}
          workspaceKey={workspaceKey}
        />
        <YourMove
          rows={moves}
          serverId={serverId}
          workspaceKey={workspaceKey}
          facts={facts}
          gitActions={git}
        />
        <ContextFooter
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceKey={workspaceKey}
          codeRow={isGitWorkspace && gitStatusLoaded ? overviewCodeRow(facts, moves) : null}
          facts={facts}
          more={more}
        />
      </View>
    </ScrollView>
  );
}

/** Your move, shared with the context footer so it can skip a code row that repeats the git move. */
function useYourMove(input: {
  serverId: string;
  workspaceId: string;
  agentRunning: boolean;
  facts: WorkspaceFacts | null;
  gitActions: GitActions | null;
  status: PluginWorkspaceStatus | null;
}): YourMoveRow[] {
  const items = useWorkspaceAttention(input.serverId, input.workspaceId);
  const lastPromptAt = useSessionStore((state) =>
    selectLastPromptAt(state.sessions[input.serverId]?.agents, input.workspaceId),
  );
  const archive = input.gitActions && findGitAction(input.gitActions, "archive-workspace");
  return deriveYourMove({
    items,
    agentRunning: input.agentRunning,
    gitPrimaryId: input.gitActions?.primary?.id ?? null,
    canArchive: Boolean(archive && !archive.disabled),
    prMerged: Boolean(input.facts?.pullRequest?.isMerged),
    statusDone: isStatusDone({
      status: input.status,
      agentRunning: input.agentRunning,
      lastPromptAt,
    }),
  });
}

function overviewCodeRow(
  facts: WorkspaceFacts | null,
  moves: readonly YourMoveRow[],
): "pr" | "branch" | null {
  if (!facts) return null;
  return deriveCodeRow({
    hasPullRequest: Boolean(facts.pullRequest),
    gitMoveShown: moves.some((move) => move.kind === "git"),
    branchHasFacts: branchFacts(facts, (key) => key) !== "",
  });
}

// ── 1. What is this ──────────────────────────────────────────────────────

function Identity({
  name,
  subtitle,
  isGoal,
}: {
  name: string | null;
  subtitle: string | null;
  isGoal: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.identity} testID="overview-workspace">
      <Text style={styles.title} numberOfLines={2}>
        {name ?? t("workspace.tabs.loading")}
      </Text>
      {subtitle ? (
        <Text
          style={isGoal ? styles.goal : styles.goalFallback}
          numberOfLines={3}
          testID="overview-subtitle"
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

// ── 2. Where does it stand ───────────────────────────────────────────────

/** Newest prompt among the workspace's agents, to tell whether the status card is outdated. */
function selectLastPromptAt(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): number | null {
  if (!agents) return null;
  const target = normalizeWorkspaceOpaqueId(workspaceId);
  let latest: number | null = null;
  for (const agent of agents.values()) {
    if (agent.archivedAt || normalizeWorkspaceOpaqueId(agent.workspaceId) !== target) continue;
    const at = agent.lastUserMessageAt?.getTime() ?? null;
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

type StatusTone = "working" | "waiting_on_you" | "blocked" | "done" | "answered";

function StatusBlock({
  item,
  serverId,
  workspaceId,
  agentRunning,
  workspaceKey,
}: {
  item: WorkspaceSummaryItem | null;
  serverId: string;
  workspaceId: string;
  agentRunning: boolean;
  workspaceKey: string | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const status = item?.status;
  const lastPromptAt = useSessionStore((state) =>
    selectLastPromptAt(state.sessions[serverId]?.agents, workspaceId),
  );
  const open = useCallback(() => {
    if (item && workspaceKey) {
      showExplorerForAttention(workspaceKey, { kind: "plugin", key: item.key ?? "", item });
    }
  }, [item, workspaceKey]);
  // No card says nothing worth a line: the title and Your move carry the workspace on their own.
  if (!status) return null;
  const state: StatusTone = status.answered ? "answered" : status.state;
  const outdated = isStatusOutdated({ updatedAt: status.updatedAt, agentRunning, lastPromptAt });
  // A card so the agent's own account reads as one object: the state as a pill, then its summary.
  // "Now" stays in the Status tab; next to the summary it described the same progress twice.
  const content = (
    <>
      <View style={styles.stateLine}>
        <StatePill state={state} />
        <View style={styles.fill} />
        {item?.panelId ? (
          <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
        ) : null}
      </View>
      <Text style={outdated ? styles.summaryStale : styles.summary} numberOfLines={5}>
        {status.summary}
      </Text>
      {outdated && lastPromptAt !== null ? (
        <Text style={styles.outdated} testID="overview-status-outdated">
          {t("panels.overview.outdated", { time: formatTimeAgo(new Date(lastPromptAt)) })}
        </Text>
      ) : null}
    </>
  );
  if (item?.panelId) {
    return (
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={status.summary}
        onPress={open}
        style={styles.story}
        highlightStyle={styles.pressed}
        testID="overview-status"
      >
        {content}
      </PressHighlight>
    );
  }
  return (
    <View style={styles.story} testID="overview-status">
      {content}
    </View>
  );
}

function StatePill({ state }: { state: StatusTone }): ReactElement {
  const { t } = useTranslation();
  const dot = useMemo(() => <View style={dotStyle(state)} />, [state]);
  return (
    <StatusBadge
      label={t(`panels.overview.state.${state}`)}
      variant={badgeVariant(state)}
      leading={dot}
    />
  );
}

function badgeVariant(state: StatusTone): StatusBadgeVariant {
  if (state === "waiting_on_you") return "warning";
  if (state === "blocked") return "error";
  if (state === "done") return "success";
  return "muted";
}

function dotStyle(state: StatusTone) {
  if (state === "working") return styles.dotRun;
  if (state === "waiting_on_you") return styles.dotWarn;
  if (state === "blocked") return styles.dotDanger;
  if (state === "done") return styles.dotOk;
  return styles.dotMuted;
}

// ── 3. What do I do ──────────────────────────────────────────────────────

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
  // A label on the panel's rail, like the agent list's section headings: SettingsSection insets
  // its title for settings cards, which put it off the title and card rail here.
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.moves}>{children}</View>
    </View>
  );
}

function YourMove({
  rows,
  serverId,
  workspaceKey,
  facts,
  gitActions,
}: {
  rows: YourMoveRow[];
  serverId: string;
  workspaceKey: string | null;
  facts: WorkspaceFacts | null;
  gitActions: GitActions | null;
}): ReactElement | null {
  // One row open at a time: opening an ask closes the one that was open.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  if (rows.length === 0) return null;
  const openKey = openMoveKey(rows, chosen);
  return (
    <Section title="panels.overview.yourMove" count={rows.length > 1 ? rows.length : undefined}>
      {rows.map((row, index) => {
        const lead = index === 0;
        const move = (
          <MoveRow
            key={row.key}
            row={row}
            lead={lead}
            serverId={serverId}
            workspaceKey={workspaceKey}
            facts={facts}
            gitActions={gitActions}
          />
        );
        // A plugin that renders its own entries (Asks) is answered in place, not in its tab.
        if (row.kind !== "entry" || !row.item.EntryComponent) return move;
        return (
          <EntryMove
            key={row.key}
            row={row}
            lead={lead}
            open={row.key === openKey}
            onOpenChange={setChosen}
          >
            {move}
          </EntryMove>
        );
      })}
    </Section>
  );
}

function EntryMove({
  row,
  lead,
  open,
  onOpenChange,
  children,
}: {
  row: Extract<YourMoveRow, { kind: "entry" }>;
  lead: boolean;
  open: boolean;
  onOpenChange: (key: string | null) => void;
  children: ReactElement;
}): ReactElement {
  const onExpandedChange = useCallback(
    (expanded: boolean) => onOpenChange(expanded ? row.key : null),
    [onOpenChange, row.key],
  );
  return (
    <WorkspaceSummaryEntryView
      item={row.item}
      entryId={row.entry.id}
      defaultExpanded={lead}
      expanded={open}
      onExpandedChange={onExpandedChange}
    >
      {children}
    </WorkspaceSummaryEntryView>
  );
}

interface MoveView {
  icon: ReactNode;
  tone: Tone;
  title: string;
  facts?: string;
  action: string;
  run: () => void;
}

function MoveRow({
  row,
  lead,
  serverId,
  workspaceKey,
  facts,
  gitActions,
}: {
  row: YourMoveRow;
  lead: boolean;
  serverId: string;
  workspaceKey: string | null;
  facts: WorkspaceFacts | null;
  gitActions: GitActions | null;
}): ReactElement | null {
  const view = useMoveView(row, { serverId, workspaceKey, facts, gitActions });
  if (!view) return null;
  if (!lead) {
    return (
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={`${view.action}: ${view.title}`}
        onPress={view.run}
        style={styles.next}
        highlightStyle={styles.pressed}
        testID={`overview-move-${row.kind}`}
      >
        {view.icon}
        <Text style={styles.nextTitle} numberOfLines={1}>
          {view.title}
        </Text>
        <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
      </PressHighlight>
    );
  }
  return (
    <View style={styles.lead} testID={`overview-move-${row.kind}`}>
      <View style={styles.leadHead}>
        <View style={styles.leadIcon}>{view.icon}</View>
        <View style={styles.leadText}>
          <Text style={styles.leadTitle}>{view.title}</Text>
          {view.facts ? <Text style={styles.leadFacts}>{view.facts}</Text> : null}
        </View>
      </View>
      <View style={styles.leadActions}>
        {row.kind === "permission" ? (
          <PermissionActions serverId={serverId} agentId={row.agentId} fallback={view} />
        ) : (
          <Button variant="default" onPress={view.run} testID="overview-next-step-button">
            {view.action}
          </Button>
        )}
      </View>
    </View>
  );
}

function selectPendingPermission(
  agents: ReadonlyMap<string, Agent> | undefined,
  agentId: string,
): AgentPermissionRequest | null {
  return agents?.get(agentId)?.pendingPermissions[0] ?? null;
}

/**
 * A plain tool permission is answered in place with its own actions. Plans and questions need the
 * full card (the plan text, the form), so they keep the button that opens the agent.
 */
function PermissionActions({
  serverId,
  agentId,
  fallback,
}: {
  serverId: string;
  agentId: string;
  fallback: MoveView;
}): ReactElement {
  const { t } = useTranslation();
  const request = useSessionStore((state) =>
    selectPendingPermission(state.sessions[serverId]?.agents, agentId),
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [responding, setResponding] = useState<string | null>(null);
  const respond = useCallback(
    (action: AgentPermissionAction) => {
      if (!client || !request) return;
      setResponding(action.id);
      const response = permissionResponse(action);
      client
        .respondToPermissionAndWait(agentId, request.id, response, PERMISSION_TIMEOUT_MS)
        .catch((error: unknown) => {
          console.error("[Overview] Failed to respond to permission:", error);
        })
        .finally(() => setResponding(null));
    },
    [agentId, client, request],
  );
  if (!request || !canAnswerPermissionInPlace(request)) {
    return (
      <Button variant="default" onPress={fallback.run} testID="overview-next-step-button">
        {fallback.action}
      </Button>
    );
  }
  const actions = permissionActions(request, {
    accept: t("agentStream.permission.accept"),
    deny: t("agentStream.permission.deny"),
  });
  return (
    <>
      {actions.map((action) => (
        <PermissionButton
          key={action.id}
          action={action}
          disabled={responding !== null}
          pending={responding === action.id}
          onPress={respond}
        />
      ))}
    </>
  );
}

function PermissionButton({
  action,
  disabled,
  pending,
  onPress,
}: {
  action: AgentPermissionAction;
  disabled: boolean;
  pending: boolean;
  onPress: (action: AgentPermissionAction) => void;
}): ReactElement {
  const press = useCallback(() => onPress(action), [action, onPress]);
  let variant: "default" | "outline" | "ghost" = "outline";
  if (action.variant === "primary") variant = "default";
  else if (action.behavior === "deny") variant = "ghost";
  return (
    <Button
      variant={variant}
      onPress={press}
      disabled={disabled}
      loading={pending}
      testID={`overview-permission-${action.id}`}
    >
      {action.label}
    </Button>
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
  const permission = useSessionStore((state) =>
    row.kind === "permission"
      ? selectPendingPermission(state.sessions[context.serverId]?.agents, row.agentId)
      : null,
  );
  const { serverId, workspaceKey, facts, gitActions } = context;
  return useMemo(() => {
    const input = { t, serverId, workspaceKey, facts, agentLabel: agent.label };
    switch (row.kind) {
      case "permission":
        return permissionMoveView(row.agentId, permission, input);
      case "failed":
        return failedMoveView(row.agentId, input);
      case "entry":
      case "plugin":
        return pluginMoveView(row, input);
      case "checks":
        return checksMoveView(input);
      case "git": {
        const action = gitActions && findGitAction(gitActions, row.actionId);
        return action ? gitMoveView(action, runGitAction, input) : null;
      }
    }
  }, [agent.label, facts, gitActions, permission, row, runGitAction, serverId, t, workspaceKey]);
}

interface MoveViewInput {
  t: Translate;
  serverId: string;
  workspaceKey: string | null;
  facts: WorkspaceFacts | null;
  agentLabel: string;
}

function permissionMoveView(
  agentId: string,
  permission: AgentPermissionRequest | null,
  { t, serverId, agentLabel, facts: workspace }: MoveViewInput,
): MoveView {
  const workspaceCwd = workspace?.cwd ?? null;
  return {
    icon: <ThemedShield size={ICON_SIZE} uniProps={warningColorMapping} />,
    tone: "warn",
    title: permission?.title ?? permission?.name ?? t("panels.overview.permissionTitle"),
    facts: (permission && permissionFacts(permission, workspaceCwd)) || agentLabel || undefined,
    action: t("panels.overview.reviewPermission"),
    run: () => navigateToAgent({ serverId, agentId }),
  };
}

function failedMoveView(agentId: string, { t, serverId, agentLabel }: MoveViewInput): MoveView {
  return {
    icon: <ThemedAlert size={ICON_SIZE} uniProps={dangerColorMapping} />,
    tone: "danger",
    title: t("panels.overview.failedReason"),
    facts: agentLabel || undefined,
    action: t("panels.overview.openAgent"),
    run: () => navigateToAgent({ serverId, agentId }),
  };
}

function pluginMoveView(
  row: Extract<YourMoveRow, { kind: "entry" | "plugin" }>,
  { t, workspaceKey }: MoveViewInput,
): MoveView {
  return {
    icon: <ThemedAsk size={ICON_SIZE} uniProps={warningColorMapping} />,
    tone: "warn",
    title: row.kind === "entry" ? row.entry.title : row.item.title,
    facts: row.kind === "entry" ? row.entry.detail : row.item.label,
    action: t("panels.overview.open"),
    run: () => {
      if (workspaceKey) {
        showExplorerForAttention(workspaceKey, {
          kind: "plugin",
          key: row.item.key ?? "",
          item: row.item,
        });
      }
    },
  };
}

function checksMoveView({ t, workspaceKey, facts }: MoveViewInput): MoveView {
  const failing = (facts?.pullRequest?.checks ?? [])
    .filter((check) => check.status === "failure")
    .map((check) => check.name);
  return {
    icon: <ThemedAlert size={ICON_SIZE} uniProps={dangerColorMapping} />,
    tone: "danger",
    title: t("panels.overview.checksFailedReason"),
    facts: failing.join(", ") || undefined,
    action: t("panels.overview.openPullRequest"),
    run: () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "pr" }),
  };
}

function findGitAction(gitActions: GitActions, id: string): GitAction | null {
  if (gitActions.primary?.id === id) return gitActions.primary;
  return gitActions.secondary.find((action) => action.id === id) ?? null;
}

function gitMoveView(
  primary: GitAction,
  runGitAction: (action: GitAction) => void,
  { t, facts }: MoveViewInput,
): MoveView {
  const pr = facts?.pullRequest;
  const run = () => runGitAction(primary);
  // Archive is only a move once the work shipped: a merged PR, or a done status card (deriveYourMove).
  if (primary.id === "archive-workspace") {
    return {
      icon: <ThemedArchive size={ICON_SIZE} uniProps={mergedColorMapping} />,
      tone: "merged",
      title: t("panels.overview.readyToArchive"),
      facts:
        pr?.isMerged && pr.number
          ? t("panels.overview.prMergedTitle", { number: pr.number })
          : branchFacts(facts, t) || undefined,
      action: primary.label,
      run,
    };
  }
  return {
    icon: primary.icon ?? <ThemedGitBranch size={ICON_SIZE} uniProps={mutedColorMapping} />,
    tone: "ok",
    title: pr ? pullRequestTitle(pr) : (facts?.branch ?? t("panels.overview.noBranch")),
    facts: gitMoveFacts(facts, t) || undefined,
    action: primary.label,
    run,
  };
}

function pullRequestTitle(pr: PullRequest): string {
  return pr.number ? `#${pr.number} ${pr.title}` : pr.title;
}

// ── 4. Context ───────────────────────────────────────────────────────────

function countWorkspaceRootAgents(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): number {
  if (!agents) return 0;
  const target = normalizeWorkspaceOpaqueId(workspaceId);
  let count = 0;
  for (const agent of agents.values()) {
    if (agent.archivedAt || normalizeWorkspaceOpaqueId(agent.workspaceId) !== target) continue;
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (isWorkspaceRootAgent(agent, parent)) count += 1;
  }
  return count;
}

/**
 * One-line facts the blocks above don't already say: where the work came from, what it started,
 * a PR or branch that isn't the move, several agents, other plugins' facts. Renders nothing when
 * there is nothing to say.
 */
function ContextFooter({
  serverId,
  workspaceId,
  workspaceKey,
  codeRow,
  facts,
  more,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string | null;
  codeRow: "pr" | "branch" | null;
  facts: WorkspaceFacts | null;
  more: WorkspaceSummaryItem[];
}): ReactElement | null {
  const { t } = useTranslation();
  const focus = useLineageFocus(serverId, workspaceId);
  const selectLineage = useMemo(() => createLineageSelector(focus), [focus]);
  const lineage = useSessionStore(selectLineage);
  const { parent, children } = useMemo(
    () => deriveWorkspaceLineage(lineage, { serverId, workspaceId }),
    [lineage, serverId, workspaceId],
  );
  const rootAgentCount = useSessionStore((state) =>
    countWorkspaceRootAgents(state.sessions[serverId]?.agents, workspaceId),
  );
  const openLineage = useCallback(
    () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "lineage" }),
    [workspaceKey],
  );
  const showCode =
    codeRow !== null && facts !== null && (codeRow === "branch" || facts.pullRequest !== null);
  const showAgents = rootAgentCount > 1;
  if (!parent && children.length === 0 && !showCode && !showAgents && more.length === 0) {
    return null;
  }
  return (
    <View style={styles.context} testID="overview-context">
      {parent ? (
        <LineageRow label={t("panels.overview.from")} workspace={parent} direction="up" />
      ) : null}
      {children.length > 0 ? <StartedRows workspaces={children} /> : null}
      {showCode ? (
        <CodeContextRow kind={codeRow} facts={facts} workspaceKey={workspaceKey} />
      ) : null}
      {showAgents ? (
        <ContextRow
          label={t("panels.overview.contextAgents")}
          value={t("panels.overview.agentsHere", { count: rootAgentCount })}
          onPress={openLineage}
          testID="overview-agents"
        />
      ) : null}
      {more.map((item) => (
        <PluginContextRow key={item.entryKey} item={item} workspaceKey={workspaceKey} />
      ))}
    </View>
  );
}

function StartedRows({ workspaces }: { workspaces: WorkspaceRef[] }): ReactElement {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const expand = useCallback(() => setShowAll(true), []);
  const visible = showAll ? workspaces : workspaces.slice(0, VISIBLE_CHILDREN);
  return (
    <>
      <ContextRow label={t("panels.overview.started")} testID="overview-started" />
      {visible.map((child) => (
        <LineageRow
          key={`${child.serverId}:${child.workspaceId}`}
          workspace={child}
          direction="down"
        />
      ))}
      {visible.length < workspaces.length ? (
        <PressHighlight
          accessibilityRole="button"
          onPress={expand}
          style={styles.showAll}
          highlightStyle={styles.pressed}
          testID="overview-lineage-show-all"
        >
          <Text style={styles.showAllText}>
            {t("panels.overview.showAll", { count: workspaces.length })}
          </Text>
        </PressHighlight>
      ) : null}
    </>
  );
}

/** The PR, or else a branch with something to report: only when the git move doesn't already name it. */
function CodeContextRow({
  kind,
  facts,
  workspaceKey,
}: {
  kind: "pr" | "branch" | null;
  facts: WorkspaceFacts | null;
  workspaceKey: string | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const openChanges = useCallback(
    () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "changes" }),
    [workspaceKey],
  );
  const openPullRequest = useCallback(
    () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "pr" }),
    [workspaceKey],
  );
  const pr = facts?.pullRequest ?? null;
  if (kind === "pr" && pr) {
    const attention = pr.checksStatus === "failure" || pr.reviewDecision === "changes_requested";
    return (
      <ContextRow
        label={t("panels.overview.contextPr")}
        value={pullRequestTitle(pr)}
        word={pullRequestFacts(pr, t)}
        tone={attention ? "danger" : "muted"}
        onPress={openPullRequest}
        testID="overview-pull-request"
      />
    );
  }
  if (kind === "branch" && facts) {
    return (
      <ContextRow
        label={t("panels.overview.contextBranch")}
        value={facts.branch ?? t("panels.overview.noBranch")}
        word={branchFacts(facts, t)}
        onPress={openChanges}
        testID="overview-branch"
      />
    );
  }
  return null;
}

function ContextRow({
  label,
  value,
  word,
  tone = "muted",
  onPress,
  testID,
}: {
  label: string;
  value?: string;
  word?: string;
  tone?: Tone;
  onPress?: () => void;
  testID: string;
}): ReactElement {
  const content = (
    <>
      <Text style={styles.contextLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.contextValue} numberOfLines={1}>
        {value ?? ""}
      </Text>
      {word ? (
        <Text style={wordStyle(tone)} numberOfLines={1}>
          {word}
        </Text>
      ) : null}
      {onPress ? (
        <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.contextRow} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={[label, value, word].filter(Boolean).join(", ")}
      onPress={onPress}
      style={styles.contextRow}
      highlightStyle={styles.pressed}
      testID={testID}
    >
      {content}
    </PressHighlight>
  );
}

function PluginContextRow({
  item,
  workspaceKey,
}: {
  item: WorkspaceSummaryItem;
  workspaceKey: string | null;
}): ReactElement {
  const open = useCallback(() => {
    if (workspaceKey) {
      showExplorerForAttention(workspaceKey, { kind: "plugin", key: item.key ?? "", item });
    }
  }, [item, workspaceKey]);
  return (
    <ContextRow
      label={item.title}
      value={item.label ?? ""}
      onPress={item.panelId ? open : undefined}
      testID={`overview-plugin-${item.pluginId}-${item.itemId}`}
    />
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

/** A parent (`From`) or child workspace with its one state word; pressing it opens that workspace. */
function LineageRow({
  label,
  workspace,
  direction,
}: {
  label?: string;
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
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${wordText}`}
      disabled={!fields}
      onPress={open}
      style={label ? styles.contextRow : styles.childRow}
      highlightStyle={styles.pressed}
      testID={`overview-lineage-${direction}-${workspace.workspaceId}`}
    >
      {label ? (
        <Text style={styles.contextLabel} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      <Text style={styles.contextValue} numberOfLines={1}>
        {name}
      </Text>
      <Text style={wordStyle(toneOfWord(word))} numberOfLines={1}>
        {wordText}
      </Text>
      {fields ? (
        <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
      ) : null}
    </PressHighlight>
  );
}

function toneOfWord(word: WorkspaceStateWord): Tone {
  switch (word) {
    case "working":
      return "run";
    case "waiting":
      return "warn";
    case "blocked":
    case "failed":
      return "danger";
    case "done":
      return "ok";
    default:
      return "muted";
  }
}

function wordStyle(tone: Tone) {
  switch (tone) {
    case "run":
      return styles.wordRun;
    case "warn":
      return styles.wordWarn;
    case "danger":
      return styles.wordDanger;
    case "ok":
      return styles.wordOk;
    default:
      return styles.word;
  }
}

export const overviewPanelRegistration = definePanel("overview", {
  component: OverviewPanel,
  presentation: overviewPanelPresentation,
});

const styles = StyleSheet.create((theme) => {
  const dot = {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  } as const;
  const word = { fontSize: theme.fontSize.sm, flexShrink: 0, maxWidth: "50%" } as const;
  const lead = {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  } as const;
  const summary = { fontSize: theme.fontSize.base, color: theme.colors.foreground } as const;
  const contextRow = {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 30,
    paddingHorizontal: theme.spacing[1.5],
    marginHorizontal: -theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  } as const;
  return {
    body: {
      padding: theme.spacing[4],
      gap: theme.spacing[6],
    },
    identity: {
      gap: theme.spacing[1],
    },
    title: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
    },
    goal: {
      fontSize: theme.fontSize.base,
      color: theme.colors.foregroundMuted,
    },
    goalFallback: {
      fontSize: theme.fontSize.base,
      color: theme.colors.foregroundExtraMuted,
    },
    story: {
      gap: theme.spacing[2],
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface1,
    },
    stateLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    fill: { flex: 1 },
    dotRun: { ...dot, backgroundColor: theme.colors.statusDotRunning },
    dotWarn: { ...dot, backgroundColor: theme.colors.statusDotWarning },
    dotDanger: { ...dot, backgroundColor: theme.colors.statusDotDanger },
    dotOk: { ...dot, backgroundColor: theme.colors.statusDotSuccess },
    dotMuted: { ...dot, backgroundColor: theme.colors.foregroundMuted },
    outdated: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.statusWarning,
    },
    summary,
    summaryStale: { ...summary, opacity: 0.55 },
    section: {
      gap: theme.spacing[2],
    },
    sectionLabel: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foregroundMuted,
    },
    moves: {
      gap: theme.spacing[1],
    },
    lead,
    leadHead: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[3],
    },
    leadIcon: {
      paddingTop: 2,
    },
    leadText: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[0.5],
    },
    leadTitle: {
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
    },
    leadFacts: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    leadActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[1.5],
      paddingLeft: ICON_SIZE + theme.spacing[3],
    },
    next: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[3],
      minHeight: 36,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
    },
    nextTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foreground,
    },
    context: {
      gap: theme.spacing[0.5],
    },
    contextRow,
    childRow: { ...contextRow, paddingLeft: theme.spacing[1.5] + 60 },
    contextLabel: {
      width: 60,
      flexShrink: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundExtraMuted,
    },
    contextValue: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foreground,
    },
    word: { ...word, color: theme.colors.foregroundMuted },
    wordRun: { ...word, color: theme.colors.accentBright },
    wordWarn: { ...word, color: theme.colors.statusWarning },
    wordDanger: { ...word, color: theme.colors.statusDanger },
    wordOk: { ...word, color: theme.colors.statusSuccess },
    showAll: {
      paddingLeft: theme.spacing[1.5] + 60,
      paddingVertical: theme.spacing[1],
      borderRadius: theme.borderRadius.md,
    },
    showAllText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      textDecorationLine: "underline",
    },
    pressed: { backgroundColor: theme.colors.interactionHighlight },
  };
});

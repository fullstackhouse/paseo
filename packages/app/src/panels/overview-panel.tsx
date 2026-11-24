import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Bot,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  FolderOpen,
  GitPullRequest,
  LayoutDashboard,
  MessageCircleQuestion,
  ShieldQuestion,
  User,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import type { AgentPermissionAction, AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import type { PluginWorkspaceBlocker, PluginWorkspaceStatus } from "@getpaseo/plugin/client";
import { useAgentDescriptor } from "@/agent-presentation";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import {
  type GitAction,
  type GitActionId,
  useGitActionRunner,
  useGitActions,
  type GitActions,
} from "@/git/use-actions";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import {
  useWorkspaceSummaryItems,
  workspaceSummaryStore,
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
import { openExternalUrl } from "@/utils/open-external-url";
import { formatTimeAgo } from "@/utils/time";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { useWorkspaceAttention } from "@/workspace-attention/attention";
import { hasRunningAgent } from "@/workspace-attention/model";
import { foldReportedWork } from "@/workspace-status/reported-work";
import { showExplorerForAttention } from "@/workspace-attention/auto-show";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  blockerKey,
  blockerTarget,
  branchFacts,
  canAnswerPermissionInPlace,
  countLabel,
  derivePullRequests,
  foldsDonePullRequests,
  findBlocking,
  isTreeBlocker,
  orderChildren,
  deriveWorkspaceStateWord,
  deriveYourMove,
  openMoveKey,
  pinOpenMove,
  isStatusDone,
  isStatusOutdated,
  isWorkStillOpen,
  noPullRequestFacts,
  overviewSubtitle,
  partitionSummaryItems,
  permissionActions,
  permissionFacts,
  permissionResponse,
  statusBlockers,
  type PullRequestRow,
  type WorkspaceStateWord,
  type YourMoveRow,
} from "./overview/model";

const ThemedLayoutDashboard = withUnistyles(LayoutDashboard);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedArchive = withUnistyles(Archive);
const ThemedAsk = withUnistyles(MessageCircleQuestion);
const ThemedShield = withUnistyles(ShieldQuestion);
const ThemedAlert = withUnistyles(CircleAlert);
const ThemedPullRequest = withUnistyles(GitPullRequest);
const ThemedBot = withUnistyles(Bot);
const ThemedFolder = withUnistyles(FolderOpen);
const ThemedUser = withUnistyles(User);
const ThemedCircleDashed = withUnistyles(CircleDashed);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const mergedColorMapping = (theme: Theme) => ({ color: theme.colors.statusMerged });
const ICON_SIZE = 16;
const SMALL_ICON_SIZE = 14;
/** Child workspaces listed before "Show all". */
const VISIBLE_CHILDREN = 5;
/** How far each generation steps in, in the Tree: the ↳ and the gap after it. */
const TREE_INDENT = 16;
const PERMISSION_TIMEOUT_MS = 15_000;

export const overviewPanelPresentation = {
  label: (t) => t("panels.overview.label"),
  subtitle: (t) => t("panels.overview.subtitle"),
  tooltip: (t) => t("panels.overview.tooltip"),
  icon: ThemedLayoutDashboard,
} satisfies PanelPresentation;

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Tone = "run" | "warn" | "danger" | "ok" | "muted" | "merged";

function selectWorkspaceFacts(workspace: WorkspaceDescriptor) {
  return {
    name: workspace.name,
    project: workspace.projectCustomName || workspace.projectDisplayName,
    cwd: workspace.workspaceDirectory,
    // A plain folder has nothing to ship; checkouts and worktrees do, even before git status loads.
    isGitWorkspace: workspace.workspaceKind !== "directory",
    isWorktree: workspace.workspaceKind === "worktree",
    // Monitors and subagents hold it running without runningFromBackgroundWork; any of them is live work.
    isRunning: workspace.status === "running",
    branch: workspace.gitRuntime?.currentBranch ?? null,
    ahead: workspace.gitRuntime?.aheadOfOrigin ?? null,
    aheadOfBase: workspace.gitRuntime?.aheadBehind?.ahead ?? null,
    behind: workspace.gitRuntime?.behindOfOrigin ?? null,
    isDirty: workspace.gitRuntime?.isDirty ?? null,
    diffStat: workspace.diffStat,
    pullRequest: workspace.githubRuntime?.pullRequest ?? null,
  };
}
type WorkspaceFacts = ReturnType<typeof selectWorkspaceFacts>;

/**
 * Top to bottom: what is this (title, goal), where does it stand (status, what it waits on), what
 * do I do (Your move), where it sits (Tree), other plugins' facts, then its PRs for information.
 */
function OverviewPanel(): ReactElement {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "overview", "OverviewPanel requires overview target");
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const facts = useWorkspaceFields(serverId, workspaceId, selectWorkspaceFacts);
  const summaryItems = useWorkspaceSummaryItems(serverId, workspaceId);
  const { status, pullRequests, more } = useMemo(
    () => partitionSummaryItems(summaryItems),
    [summaryItems],
  );
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
    summaryItems,
  });
  const statusCard = status?.status ?? null;
  const name = facts?.name ?? null;
  const showPullRequests = isGitWorkspace && (gitStatusLoaded || pullRequests !== null);

  return (
    // Themed insets sit on a View: contentContainerStyle drops them on web (docs/unistyles.md).
    <ScrollView testID="overview-panel">
      <View style={styles.body}>
        <Identity
          name={name}
          subtitle={overviewSubtitle({
            goal: statusCard?.goal ?? null,
            project: facts?.project ?? null,
          })}
          isGoal={Boolean(statusCard?.goal)}
        />
        <StatusBlock
          item={status}
          serverId={serverId}
          workspaceId={workspaceId}
          agentRunning={agentRunning}
          workspaceKey={workspaceKey}
        />
        <WaitingOn item={status} serverId={serverId} />
        <YourMove
          rows={moves}
          serverId={serverId}
          workspaceKey={workspaceKey}
          facts={facts}
          gitActions={git}
        />
        <Tree
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceKey={workspaceKey}
          name={name}
          status={statusCard}
        />
        <ContextFooter workspaceKey={workspaceKey} more={more} />
        {showPullRequests ? (
          <PullRequests item={pullRequests} facts={facts} workspaceKey={workspaceKey} />
        ) : null}
      </View>
    </ScrollView>
  );
}

function useYourMove(input: {
  serverId: string;
  workspaceId: string;
  agentRunning: boolean;
  facts: WorkspaceFacts | null;
  gitActions: GitActions | null;
  status: PluginWorkspaceStatus | null;
  summaryItems: readonly WorkspaceSummaryItem[];
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
    // A running archive disables the action; keep its row so it doesn't flip back to the old step.
    canArchive: Boolean(archive && (!archive.disabled || archive.status === "pending")),
    isWorktree: Boolean(input.facts?.isWorktree),
    prMerged: Boolean(input.facts?.pullRequest?.isMerged),
    statusDone: isStatusDone({
      status: input.status,
      agentRunning: input.agentRunning,
      lastPromptAt,
    }),
    workOpen: isWorkStillOpen({
      reported: foldReportedWork(input.summaryItems),
      workspaceRunning: Boolean(input.facts?.isRunning),
      cardState: input.status?.state ?? null,
    }),
    liveWork: Boolean(input.facts?.isRunning),
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
  if (state === "done") return "success";
  return "muted";
}

function dotStyle(state: StatusTone) {
  if (state === "working") return styles.dotRun;
  if (state === "waiting_on_you") return styles.dotWarn;
  if (state === "blocked") return styles.dotBlocked;
  if (state === "done") return styles.dotOk;
  return styles.dotMuted;
}

/** What a blocked status waits on, under its card: each row opens the PR, agent or workspace. */
/** What a blocked workspace waits on besides other workspaces and agents, which the Tree lists. */
function WaitingOn({
  item,
  serverId,
}: {
  item: WorkspaceSummaryItem | null;
  serverId: string;
}): ReactElement | null {
  const blockers = statusBlockers(item?.status ?? null).filter(
    (blocker) => !isTreeBlocker(blocker),
  );
  if (blockers.length === 0) return null;
  return (
    <Section title="panels.overview.waitingOn" testID="overview-waiting-on">
      {blockers.map((blocker) => (
        <BlockerRow key={blockerKey(blocker)} blocker={blocker} serverId={serverId} />
      ))}
    </Section>
  );
}

function BlockerRow({
  blocker,
  serverId,
}: {
  blocker: PluginWorkspaceBlocker;
  serverId: string;
}): ReactElement {
  const target = blockerTarget(blocker);
  const open = useCallback(() => {
    if (!target) return;
    if (target.kind === "agent") navigateToAgent({ serverId, agentId: target.agentId });
    else if (target.kind === "workspace") {
      navigateToWorkspace({ serverId, workspaceId: target.workspaceId });
    } else void openExternalUrl(target.url);
  }, [serverId, target]);
  // Two lines: a PR title and its facts both need the width of the narrow Explorer column.
  const content = (
    <>
      <BlockerIcon kind={blocker.kind} />
      <View style={styles.blockerText}>
        <Text style={styles.blockerLabel} numberOfLines={1}>
          {blocker.label}
        </Text>
        {blocker.detail ? (
          <Text style={blockerDetailStyle(blocker.tone)} numberOfLines={1}>
            {blocker.detail}
          </Text>
        ) : null}
      </View>
      {target ? (
        <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
      ) : null}
    </>
  );
  const testID = `overview-blocker-${blocker.kind}`;
  if (!target) {
    return (
      <View style={styles.blocker} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <PressHighlight
      accessibilityRole={target.kind === "url" ? "link" : "button"}
      accessibilityLabel={[blocker.label, blocker.detail].filter(Boolean).join(", ")}
      onPress={open}
      style={styles.blocker}
      highlightStyle={styles.pressed}
      testID={testID}
    >
      {content}
    </PressHighlight>
  );
}

function BlockerIcon({ kind }: { kind: PluginWorkspaceBlocker["kind"] }): ReactElement {
  switch (kind) {
    case "pr":
      return <ThemedPullRequest size={ICON_SIZE} uniProps={mutedColorMapping} />;
    case "agent":
      return <ThemedBot size={ICON_SIZE} uniProps={mutedColorMapping} />;
    case "workspace":
      return <ThemedFolder size={ICON_SIZE} uniProps={mutedColorMapping} />;
    case "person":
      return <ThemedUser size={ICON_SIZE} uniProps={mutedColorMapping} />;
    default:
      return <ThemedCircleDashed size={ICON_SIZE} uniProps={mutedColorMapping} />;
  }
}

function blockerDetailStyle(tone: PluginWorkspaceBlocker["tone"]) {
  switch (tone) {
    case "success":
      return styles.blockerDetailOk;
    case "warning":
      return styles.blockerDetailWarn;
    case "danger":
      return styles.blockerDetailDanger;
    default:
      return styles.blockerDetail;
  }
}

// ── 3. What do I do ──────────────────────────────────────────────────────

/** `title` is an i18n key: section titles never come from data. */
function Section({
  title,
  count,
  suffix,
  children,
  testID,
}: {
  title: string;
  count?: number;
  /** An i18n key appended after the count, such as "not refreshed". */
  suffix?: string;
  children: ReactNode;
  testID?: string;
}): ReactElement {
  const { t } = useTranslation();
  const label = [t(title), count ? String(count) : "", suffix ? t(suffix) : ""]
    .filter(Boolean)
    .join(" · ");
  // A label on the panel's rail, like the agent list's section headings: SettingsSection insets
  // its title for settings cards, which put it off the title and card rail here.
  return (
    <View style={styles.section} testID={testID}>
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
  const pinned = pinOpenMove(rows, chosen);
  if (pinned !== chosen) setChosen(pinned);
  const openKey = openMoveKey(rows, pinned);
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
  /** Omitted for a row that only explains (Archive held back): no button, not pressable. */
  press?: { action: string; run: () => void };
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
  const { press } = view;
  if (!lead && !press) {
    return (
      <View style={styles.next} testID={`overview-move-${row.kind}`}>
        {view.icon}
        <Text style={styles.nextTitleMuted} numberOfLines={1}>
          {view.title}
        </Text>
      </View>
    );
  }
  if (!lead && press) {
    return (
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={`${press.action}: ${view.title}`}
        onPress={press.run}
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
      <LeadActions row={row} view={view} serverId={serverId} />
    </View>
  );
}

/** A permission is answered in place; other rows press their action; an explaining row has none. */
function LeadActions({
  row,
  view,
  serverId,
}: {
  row: YourMoveRow;
  view: MoveView;
  serverId: string;
}): ReactElement | null {
  if (row.kind === "permission") {
    return (
      <View style={styles.leadActions}>
        <PermissionActions serverId={serverId} agentId={row.agentId} fallback={view} />
      </View>
    );
  }
  if (!view.press) return null;
  return (
    <View style={styles.leadActions}>
      <Button variant="default" onPress={view.press.run} testID="overview-next-step-button">
        {view.press.action}
      </Button>
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
      <Button variant="default" onPress={fallback.press?.run} testID="overview-next-step-button">
        {fallback.press?.action}
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
      case "archive": {
        const action = gitActions && findGitAction(gitActions, "archive-workspace");
        return action ? archiveMoveView(action, runGitAction, input) : null;
      }
      case "archive-held":
        return archiveHeldMoveView(input);
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
    press: {
      action: t("panels.overview.reviewPermission"),
      run: () => navigateToAgent({ serverId, agentId }),
    },
  };
}

function failedMoveView(agentId: string, { t, serverId, agentLabel }: MoveViewInput): MoveView {
  return {
    icon: <ThemedAlert size={ICON_SIZE} uniProps={dangerColorMapping} />,
    tone: "danger",
    title: t("panels.overview.failedReason"),
    facts: agentLabel || undefined,
    press: {
      action: t("panels.overview.openAgent"),
      run: () => navigateToAgent({ serverId, agentId }),
    },
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
    press: {
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
    },
  };
}

function findGitAction(gitActions: GitActions, id: GitActionId): GitAction | null {
  if (gitActions.primary?.id === id) return gitActions.primary;
  return gitActions.secondary.find((action) => action.id === id) ?? null;
}

/**
 * In Archive's place while live background work holds it (deriveYourMove): says why, offers nothing.
 * Archiving from the header stays possible and stops that work.
 */
function archiveHeldMoveView({ t }: MoveViewInput): MoveView {
  return {
    icon: <ThemedArchive size={ICON_SIZE} uniProps={mutedColorMapping} />,
    tone: "muted",
    title: t("panels.overview.archiveHeldTitle"),
    facts: t("panels.overview.archiveHeldFacts"),
  };
}

/** Archive is only a move once the work shipped: a merged PR, or a done status card (deriveYourMove). */
function archiveMoveView(
  action: GitAction,
  runGitAction: (action: GitAction) => void,
  { t, facts }: MoveViewInput,
): MoveView {
  const pr = facts?.pullRequest;
  return {
    icon: <ThemedArchive size={ICON_SIZE} uniProps={mergedColorMapping} />,
    tone: "merged",
    title: t("panels.overview.readyToArchive"),
    facts:
      pr?.isMerged && pr.number
        ? t("panels.overview.prMergedTitle", { number: pr.number })
        : branchFacts(facts, t) || undefined,
    press: { action: action.label, run: () => runGitAction(action) },
  };
}

// ── 4. Context ───────────────────────────────────────────────────────────

const NO_AGENTS: readonly Agent[] = [];
const agentsByWorkspace = new WeakMap<ReadonlyMap<string, Agent>, Map<string, Agent[]>>();

/**
 * A host's agents in one workspace. Session selectors run on every store write (stream chunks
 * included), so the per-workspace index is built once per agents map, not per call.
 */
function agentsInWorkspace(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): readonly Agent[] {
  if (!agents) return NO_AGENTS;
  let index = agentsByWorkspace.get(agents);
  if (!index) {
    index = new Map();
    for (const agent of agents.values()) {
      const key = normalizeWorkspaceOpaqueId(agent.workspaceId) ?? "";
      const list = index.get(key);
      if (list) list.push(agent);
      else index.set(key, [agent]);
    }
    agentsByWorkspace.set(agents, index);
  }
  return index.get(normalizeWorkspaceOpaqueId(workspaceId) ?? "") ?? NO_AGENTS;
}

function countWorkspaceRootAgents(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): number {
  let count = 0;
  for (const agent of agentsInWorkspace(agents, workspaceId)) {
    if (agent.archivedAt) continue;
    const parent = agent.parentAgentId ? agents?.get(agent.parentAgentId) : undefined;
    if (isWorkspaceRootAgent(agent, parent)) count += 1;
  }
  return count;
}

function selectAgentIdsHere(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): string {
  return agentsInWorkspace(agents, workspaceId)
    .map((agent) => agent.id)
    .sort()
    .join("\n");
}

function useAllSummaryItems(): readonly WorkspaceSummaryItem[] {
  return useSyncExternalStore(
    workspaceSummaryStore.subscribe,
    workspaceSummaryStore.getSnapshot,
    workspaceSummaryStore.getSnapshot,
  );
}

function useWorkspaceLineage(serverId: string, workspaceId: string) {
  const focus = useLineageFocus(serverId, workspaceId);
  const selectLineage = useMemo(() => createLineageSelector(focus), [focus]);
  const lineage = useSessionStore(selectLineage);
  return useMemo(
    () => deriveWorkspaceLineage(lineage, { serverId, workspaceId }),
    [lineage, serverId, workspaceId],
  );
}

/** Children that need the human first, then newest first (orderChildren). */
function useOrderedChildren(children: WorkspaceRef[]): WorkspaceRef[] {
  // Re-read the status cards whenever any changes; the words key below keeps the order stable.
  useAllSummaryItems();
  const wordsKey = useSessionStore((state) =>
    children
      .map((child) =>
        workspaceStateWord(state.sessions[child.serverId]?.agents, child, (ref) =>
          workspaceSummaryStore.forWorkspace(ref.serverId, ref.workspaceId),
        ),
      )
      .join(","),
  );
  return useMemo(() => {
    const words = wordsKey.split(",") as WorkspaceStateWord[];
    const pairs = children.map((child, index) => ({ child, word: words[index] ?? "idle" }));
    return orderChildren(pairs, (pair) => pair.word).map((pair) => pair.child);
  }, [children, wordsKey]);
}

/**
 * Where the workspace sits: its lineage as one indented chain (ancestors root first, this
 * workspace, its children), then the workspaces and agents it is blocked by and the ones it blocks.
 * Renders nothing when there is none of that.
 */
function Tree({
  serverId,
  workspaceId,
  workspaceKey,
  name,
  status,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string | null;
  name: string | null;
  status: PluginWorkspaceStatus | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const { ancestors, children } = useWorkspaceLineage(serverId, workspaceId);
  const orderedChildren = useOrderedChildren(children);
  const rootAgentCount = useSessionStore((state) =>
    countWorkspaceRootAgents(state.sessions[serverId]?.agents, workspaceId),
  );
  const agentIdsKey = useSessionStore((state) =>
    selectAgentIdsHere(state.sessions[serverId]?.agents, workspaceId),
  );
  const allItems = useAllSummaryItems();
  const blocking = useMemo(
    () =>
      findBlocking({
        items: allItems,
        serverId,
        workspaceId,
        agentIdsHere: new Set(agentIdsKey ? agentIdsKey.split("\n") : []),
        normalize: normalizeWorkspaceOpaqueId,
      }),
    [agentIdsKey, allItems, serverId, workspaceId],
  );
  const blockers = statusBlockers(status).filter(isTreeBlocker);
  const hasLineage = ancestors.length > 0 || children.length > 0 || rootAgentCount > 1;
  if (!hasLineage && blockers.length === 0 && blocking.length === 0) return null;
  return (
    <Section title="panels.overview.tree" testID="overview-tree">
      {hasLineage ? (
        <View style={styles.context}>
          {ancestors.map((ref, index) => (
            <LineageRow
              key={`${ref.serverId}:${ref.workspaceId}`}
              workspace={ref}
              level={index}
              testID={`overview-lineage-up-${ref.workspaceId}`}
            />
          ))}
          <HereRow
            name={name}
            level={ancestors.length}
            agents={rootAgentCount}
            workspaceKey={workspaceKey}
          />
          <ChildRows workspaces={orderedChildren} level={ancestors.length + 1} />
        </View>
      ) : null}
      {blockers.length > 0 ? (
        <View style={styles.context} testID="overview-tree-blocked-by">
          <Text style={styles.groupLabel}>{t("panels.overview.blockedBy")}</Text>
          {blockers.map((blocker) =>
            // A workspace shows its live state word; an agent keeps the plugin's label and detail.
            blocker.kind === "workspace" && blocker.workspaceId ? (
              <BlockerWorkspaceRow
                key={blockerKey(blocker)}
                serverId={serverId}
                workspaceId={blocker.workspaceId}
              />
            ) : (
              <BlockerRow key={blockerKey(blocker)} blocker={blocker} serverId={serverId} />
            ),
          )}
        </View>
      ) : null}
      {blocking.length > 0 ? (
        <View style={styles.context} testID="overview-tree-blocking">
          <Text style={styles.groupLabel}>{t("panels.overview.blocking")}</Text>
          {blocking.map((ref) => (
            <LineageRow
              key={`${ref.serverId}:${ref.workspaceId}`}
              workspace={ref}
              level={0}
              testID={`overview-blocking-${ref.workspaceId}`}
            />
          ))}
        </View>
      ) : null}
    </Section>
  );
}

function Spacer({ width }: { width: number }): ReactElement {
  const style = useMemo(() => ({ width }), [width]);
  return <View style={style} />;
}

function BlockerWorkspaceRow({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement {
  const workspace = useMemo(() => ({ serverId, workspaceId }), [serverId, workspaceId]);
  return (
    <LineageRow workspace={workspace} level={0} testID={`overview-blocked-by-${workspaceId}`} />
  );
}

/** Steps a Tree row in one level per generation; levels past the root sit behind a ↳. */
function Indent({ level }: { level: number }): ReactElement | null {
  if (level === 0) return null;
  return (
    <>
      {level > 1 ? <Spacer width={(level - 1) * TREE_INDENT} /> : null}
      <Text style={styles.treeArrow}>↳</Text>
    </>
  );
}

/** This workspace in its own lineage. With several agents it names them and opens Lineage. */
function HereRow({
  name,
  level,
  agents,
  workspaceKey,
}: {
  name: string | null;
  level: number;
  agents: number;
  workspaceKey: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const openLineage = useCallback(
    () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "lineage" }),
    [workspaceKey],
  );
  const content = (
    <>
      <Indent level={level} />
      <Text style={styles.hereName} numberOfLines={1}>
        {name ?? ""}
        {agents > 1 ? (
          <Text style={styles.hereAgents}>
            {" · "}
            {countLabel(t, "panels.overview.agents", agents)}
          </Text>
        ) : null}
      </Text>
      {agents > 1 ? (
        <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
      ) : null}
    </>
  );
  if (agents <= 1) {
    return (
      <View style={styles.hereRow} testID="overview-tree-here">
        {content}
      </View>
    );
  }
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={`${name ?? ""}, ${countLabel(t, "panels.overview.agents", agents)}`}
      onPress={openLineage}
      style={styles.hereRow}
      highlightStyle={styles.pressed}
      testID="overview-tree-here"
    >
      {content}
    </PressHighlight>
  );
}

function ChildRows({
  workspaces,
  level,
}: {
  workspaces: WorkspaceRef[];
  level: number;
}): ReactElement | null {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const expand = useCallback(() => setShowAll(true), []);
  if (workspaces.length === 0) return null;
  const visible = showAll ? workspaces : workspaces.slice(0, VISIBLE_CHILDREN);
  return (
    <>
      {visible.map((child) => (
        <ChildRow key={`${child.serverId}:${child.workspaceId}`} workspace={child} level={level} />
      ))}
      {visible.length < workspaces.length ? (
        <PressHighlight
          accessibilityRole="button"
          onPress={expand}
          style={styles.contextRow}
          highlightStyle={styles.pressed}
          testID="overview-lineage-show-all"
        >
          <Spacer width={level * TREE_INDENT} />
          <Text style={styles.showAllText}>
            {t("panels.overview.showAll", { count: workspaces.length })}
          </Text>
        </PressHighlight>
      ) : null}
    </>
  );
}

/** A child workspace, with how many workspaces it started in turn. */
function ChildRow({ workspace, level }: { workspace: WorkspaceRef; level: number }): ReactElement {
  const { children } = useWorkspaceLineage(workspace.serverId, workspace.workspaceId);
  return (
    <LineageRow
      workspace={workspace}
      level={level}
      started={children.length}
      testID={`overview-lineage-down-${workspace.workspaceId}`}
    />
  );
}

/** Plugins' one-line facts that are neither a status, a move nor PRs. Renders nothing without any. */
function ContextFooter({
  workspaceKey,
  more,
}: {
  workspaceKey: string | null;
  more: WorkspaceSummaryItem[];
}): ReactElement | null {
  if (more.length === 0) return null;
  return (
    <View style={styles.context} testID="overview-context">
      {more.map((item) => (
        <PluginContextRow key={item.entryKey} item={item} workspaceKey={workspaceKey} />
      ))}
    </View>
  );
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

function workspaceStateWord(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspace: WorkspaceRef,
  summaryItems: (workspace: WorkspaceRef) => readonly WorkspaceSummaryItem[],
): WorkspaceStateWord {
  const status = partitionSummaryItems(summaryItems(workspace)).status?.status ?? null;
  return deriveWorkspaceStateWord({
    status,
    agents: agentsInWorkspace(agents, workspace.workspaceId),
  });
}

function useWorkspaceStateWord(workspace: WorkspaceRef): WorkspaceStateWord {
  const items = useWorkspaceSummaryItems(workspace.serverId, workspace.workspaceId);
  return useSessionStore((state) =>
    workspaceStateWord(state.sessions[workspace.serverId]?.agents, workspace, () => items),
  );
}

/** A workspace in the Tree with its one state word; pressing it opens that workspace. */
function LineageRow({
  workspace,
  level,
  started = 0,
  testID,
}: {
  workspace: WorkspaceRef;
  level: number;
  /** How many workspaces it started in turn. */
  started?: number;
  testID: string;
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
  const startedText = started > 0 ? countLabel(t, "panels.overview.startedCount", started) : "";
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={[name, wordText, startedText].filter(Boolean).join(", ")}
      disabled={!fields}
      onPress={open}
      style={styles.contextRow}
      highlightStyle={styles.pressed}
      testID={testID}
    >
      <Indent level={level} />
      <Text style={fields ? styles.contextValue : styles.offName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={wordStyle(toneOfWord(word))} numberOfLines={1}>
        {wordText}
        {startedText ? <Text style={styles.word}>{` · ${startedText}`}</Text> : null}
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
    case "merged":
      return styles.wordMerged;
    default:
      return styles.word;
  }
}

// ── 5. Pull requests ─────────────────────────────────────────────────────

/**
 * The PRs the work lives in, for information: no buttons, the agent handles git. Open PRs show;
 * merged and closed ones fold behind a toggle row (`foldsDonePullRequests`). With no PR, a
 * "No PR yet" row says what a PR would propose.
 */
function PullRequests({
  item,
  facts,
  workspaceKey,
}: {
  item: WorkspaceSummaryItem | null;
  facts: WorkspaceFacts | null;
  workspaceKey: string | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const [showDone, setShowDone] = useState(false);
  const toggleDone = useCallback(() => setShowDone((shown) => !shown), []);
  const doneState = useMemo(() => ({ expanded: showDone }), [showDone]);
  const openChanges = useCallback(
    () => openExplorerSidebarView({ isCompact: false, workspaceKey, view: "changes" }),
    [workspaceKey],
  );
  const list = useMemo(
    () =>
      derivePullRequests({
        plugin: item?.pullRequests ?? null,
        host: facts?.pullRequest ?? null,
        t,
      }),
    [facts?.pullRequest, item?.pullRequests, t],
  );
  const total = list.open.length + list.done.length;
  const suffix = item?.pullRequestsStale ? "panels.overview.notRefreshed" : undefined;
  if (total === 0) {
    const branchFactsText = facts ? noPullRequestFacts(facts, t) : null;
    if (!branchFactsText) return null;
    return (
      <Section title="panels.overview.pullRequests" suffix={suffix} testID="overview-pull-requests">
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel={`${t("panels.overview.noPrYet")}, ${branchFactsText}`}
          onPress={openChanges}
          style={styles.contextRow}
          highlightStyle={styles.pressed}
          testID="overview-no-pr"
        >
          <Text style={styles.noPrLabel} numberOfLines={1}>
            {t("panels.overview.noPrYet")}
          </Text>
          <Text style={styles.noPrFacts} numberOfLines={1}>
            {branchFactsText}
          </Text>
          {facts?.branch ? (
            <Text style={styles.prBranch} numberOfLines={1}>
              {facts.branch}
            </Text>
          ) : null}
          <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
        </PressHighlight>
      </Section>
    );
  }
  const foldable = foldsDonePullRequests(list);
  const rows = foldable && !showDone ? list.open : [...list.open, ...list.done];
  return (
    <Section
      title="panels.overview.pullRequests"
      count={total > 1 ? total : undefined}
      suffix={suffix}
      testID="overview-pull-requests"
    >
      <View style={styles.context}>
        {rows.map((row) => (
          <PullRequestRowView key={row.key} row={row} workspaceKey={workspaceKey} />
        ))}
        {foldable ? (
          <PressHighlight
            accessibilityRole="button"
            accessibilityState={doneState}
            onPress={toggleDone}
            style={styles.contextRow}
            highlightStyle={styles.pressed}
            testID="overview-pull-requests-done"
          >
            <Text style={styles.word} numberOfLines={1}>
              {showDone
                ? t("panels.overview.prsShowLess")
                : countLabel(
                    t,
                    list.done.every((row) => row.tone === "merged")
                      ? "panels.overview.prsMerged"
                      : "panels.overview.prsDone",
                    list.done.length,
                  )}
            </Text>
          </PressHighlight>
        ) : null}
      </View>
    </Section>
  );
}

function PullRequestRowView({
  row,
  workspaceKey,
}: {
  row: PullRequestRow;
  workspaceKey: string | null;
}): ReactElement {
  const open = useCallback(() => {
    if (row.isBranchPr) openExplorerSidebarView({ isCompact: false, workspaceKey, view: "pr" });
    else void openExternalUrl(row.url);
  }, [row.isBranchPr, row.url, workspaceKey]);
  return (
    <PressHighlight
      accessibilityRole={row.isBranchPr ? "button" : "link"}
      accessibilityLabel={[row.ref, row.title, row.facts].filter(Boolean).join(", ")}
      onPress={open}
      style={styles.contextRow}
      highlightStyle={styles.pressed}
      testID={`overview-pull-request-${row.key}`}
    >
      {row.ref ? (
        <Text style={styles.prRef} numberOfLines={1}>
          {row.ref}
        </Text>
      ) : null}
      <Text style={styles.contextValue} numberOfLines={1}>
        {row.title}
      </Text>
      {row.facts ? (
        <Text style={wordStyle(row.tone)} numberOfLines={1}>
          {row.facts}
        </Text>
      ) : null}
      <ThemedChevronRight size={SMALL_ICON_SIZE} uniProps={extraMutedColorMapping} />
    </PressHighlight>
  );
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
  const blockerDetail = {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  } as const;
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
    dotBlocked: { ...dot, backgroundColor: theme.colors.statusDotBlocked },
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
    nextTitleMuted: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    blocker: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[3],
      paddingVertical: theme.spacing[1.5],
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
    },
    blockerText: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[0.5],
    },
    blockerLabel: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foreground,
    },
    blockerDetail,
    blockerDetailOk: { ...blockerDetail, color: theme.colors.statusSuccess },
    blockerDetailWarn: { ...blockerDetail, color: theme.colors.statusWarning },
    blockerDetailDanger: { ...blockerDetail, color: theme.colors.statusDanger },
    context: {
      gap: theme.spacing[0.5],
    },
    contextRow,
    hereRow: {
      ...contextRow,
      backgroundColor: theme.colors.surface1,
    },
    hereName: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.foreground,
    },
    hereAgents: {
      fontWeight: theme.fontWeight.normal,
      color: theme.colors.foregroundMuted,
    },
    offName: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundExtraMuted,
    },
    treeArrow: {
      width: TREE_INDENT - theme.spacing[2],
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundExtraMuted,
    },
    groupLabel: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundExtraMuted,
      paddingTop: theme.spacing[1],
    },
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
    wordMerged: { ...word, color: theme.colors.statusMerged },
    prRef: {
      flexShrink: 0,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    noPrLabel: {
      flexShrink: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foreground,
    },
    noPrFacts: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    prBranch: {
      flexShrink: 1,
      minWidth: 0,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundExtraMuted,
    },
    showAllText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
      textDecorationLine: "underline",
    },
    pressed: { backgroundColor: theme.colors.interactionHighlight },
  };
});

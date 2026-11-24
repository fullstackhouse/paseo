import { useMemo, useState, useCallback, useEffect, type ReactElement } from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, Import, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentList } from "@/components/agent-list";
import { resolveArchivedViewState } from "@/history/archived-view-state";
import { type HistoryView, useHistoryViewStore } from "@/history/history-view-store";
import { ArchivedWorkspaceList } from "@/components/archived-workspace-list";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SearchField } from "@/components/ui/search-field";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import {
  type AgentHistoryHostError,
  type AgentHistoryResult,
  useAgentHistory,
} from "@/hooks/use-agent-history";
import {
  ARCHIVED_WORKSPACES_LIMIT,
  type ArchivedWorkspacesHostIssue,
  useAnyHostSupportsArchivedWorkspaces,
  useArchivedWorkspaces,
} from "@/hooks/use-archived-workspaces";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useImportSession } from "@/hooks/use-import-session";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { buildOpenProjectRoute } from "@/utils/host-routes";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedX = withUnistyles(X);
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const CLEAR_FILTER_ICON = <ThemedX size={14} uniProps={mutedIconColorMapping} />;

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

const sessionsHostOptionTestID = (serverId: string) => `sessions-host-filter-item-${serverId}`;

/**
 * A host that failed while others answered. Without this the list silently
 * under-reports, and under a query "No sessions match" becomes a claim the app
 * has no basis for.
 */
function SessionHostErrorsBanner({
  errors,
  t,
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
}): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </Text>
        ))}
      </View>
    </View>
  );
}

function hostIssueText(t: TFunction, issue: ArchivedWorkspacesHostIssue): string {
  if (issue.reason === "needsUpdate") {
    return t("sessions.archived.needsUpdate", { host: issue.serverName });
  }
  return t("sessions.archived.hostLoadFailed", { host: issue.serverName });
}

function ArchivedHostIssuesBanner({
  issues,
  t,
}: {
  issues: ArchivedWorkspacesHostIssue[];
  t: TFunction;
}): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="archived-workspaces-host-issues">
        {issues.map((issue) => (
          <Text key={issue.serverId} style={styles.errorsBannerText}>
            {hostIssueText(t, issue)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Under a search, older matches are reached by narrowing it, not by searching. */
function resolveTruncatedHint(input: {
  t: TFunction;
  truncated: boolean;
  search: string;
}): string | undefined {
  if (!input.truncated) return undefined;
  const key = input.search ? "sessions.archived.truncatedSearch" : "sessions.archived.truncated";
  return input.t(key, { count: ARCHIVED_WORKSPACES_LIMIT });
}

/** Archived workspaces open on their own route, which offers Unarchive or Restore. */
function ArchivedWorkspacesContent({
  serverId,
  search,
  showHostColumn,
  onClearSearch,
}: {
  serverId: string | null;
  search: string;
  showHostColumn: boolean;
  onClearSearch: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const archived = useArchivedWorkspaces({ serverId, search });
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const { refresh } = archived;
  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refresh().finally(() => setIsManualRefresh(false));
  }, [refresh]);

  const state = resolveArchivedViewState(archived);
  let body: ReactElement | null = null;
  if (state === "loading") {
    body = (
      <View style={styles.loadingContainer}>
        <ThemedLoadingSpinner size="large" />
      </View>
    );
  } else if (state === "error") {
    body = (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t("sessions.archived.loadFailed")}</Text>
        <Button variant="ghost" onPress={handleRefresh}>
          {t("sessions.archived.retry")}
        </Button>
      </View>
    );
  } else if (state === "empty") {
    body = (
      <View style={styles.emptyContainer} testID="archived-workspaces-empty">
        <Text style={styles.emptyText}>
          {search ? t("sessions.archived.noMatches") : t("sessions.archived.empty")}
        </Text>
        {search ? (
          <Button variant="ghost" onPress={onClearSearch}>
            {t("sessions.actions.clearSearch")}
          </Button>
        ) : null}
      </View>
    );
  } else if (state === "list") {
    body = (
      <ArchivedWorkspaceList
        workspaces={archived.workspaces}
        search={search || undefined}
        showHostColumn={showHostColumn}
        isRefreshing={isManualRefresh}
        onRefresh={handleRefresh}
        footerHint={resolveTruncatedHint({ t, truncated: archived.truncated, search })}
      />
    );
  }

  return (
    <>
      {archived.hostIssues.length > 0 ? (
        <ArchivedHostIssuesBanner issues={archived.hostIssues} t={t} />
      ) : null}
      {state === "list" && archived.isError ? (
        <View style={styles.errorsBannerWrap}>
          <View style={styles.errorsBanner} testID="archived-workspaces-refresh-failed">
            <Text style={styles.errorsBannerText}>{t("sessions.archived.refreshFailed")}</Text>
          </View>
        </View>
      ) : null}
      {body}
    </>
  );
}

/** An empty list means something different once a query is narrowing it. */
function resolveEmptyText(input: {
  t: TFunction;
  isSearching: boolean;
  isAllHosts: boolean;
}): string {
  if (input.isSearching) return input.t("sessions.noMatches");
  if (input.isAllHosts) return input.t("sessions.empty");
  return "No sessions for this host";
}

// Content remounts on every screen focus, so autoFocus fires each time History opens.
// Touch screens skip it so the on-screen keyboard doesn't cover the list; a wide tablet
// browser is not compact, so width alone doesn't catch it. Native never has a fine pointer.
function useShouldAutoFocusSearch(): boolean {
  const isCompact = useIsCompactFormFactor();
  const hasFinePointer = useHasFinePointer();
  return hasFinePointer && !isCompact;
}

export function SessionsScreen() {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent />;
}

/** Agent sessions across hosts: the default History view. */
function AgentHistoryBody({
  history,
  search,
  isAllHosts,
  onClearSearch,
}: {
  history: AgentHistoryResult;
  search: string;
  isAllHosts: boolean;
  onClearSearch: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const importSession = useImportSession();
  const {
    agents,
    hasMore,
    isInitialLoad,
    isLoadingMore,
    isError,
    isSearchSupported,
    isSearchTruncated,
    hostErrors,
    loadMore,
    refreshAll,
  } = history;
  const isSearching = isSearchSupported && search.length > 0;
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const listFooterComponent = useMemo(() => {
    // COMPAT(historyPagination): old daemons return a truncated relevance page.
    // Added in v0.8.0; remove after 2027-03-16 once the daemon floor supports search pagination.
    if (isSearchTruncated) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{t("sessions.tooManyMatches")}</Text>
        </View>
      );
    }
    if (!hasMore) {
      return null;
    }
    return (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </View>
    );
  }, [hasMore, isLoadingMore, isSearchTruncated, loadMore, t]);

  let body: ReactElement;
  if (isInitialLoad) {
    body = (
      <View style={styles.loadingContainer}>
        <ThemedLoadingSpinner size="large" />
      </View>
    );
  } else if (isError && agents.length === 0) {
    body = (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Unable to load sessions</Text>
        <Button variant="ghost" onPress={handleRefresh}>
          Try again
        </Button>
      </View>
    );
  } else if (agents.length === 0) {
    // Searching filters the chronological history without changing its date buckets.
    body = (
      <View style={styles.emptyContainer} testID="sessions-empty">
        <Text style={styles.emptyText}>{resolveEmptyText({ t, isSearching, isAllHosts })}</Text>
        {isSearching ? (
          <Button variant="ghost" onPress={onClearSearch}>
            {t("sessions.actions.clearSearch")}
          </Button>
        ) : (
          <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
            Back
          </Button>
        )}
        <Button variant="ghost" leftIcon={Import} onPress={importSession.open}>
          {t("importSession.title")}
        </Button>
      </View>
    );
  } else {
    body = (
      <AgentList
        agents={agents}
        showCheckoutInfo={false}
        isRefreshing={isManualRefresh}
        onRefresh={handleRefresh}
        listFooterComponent={listFooterComponent}
        showAttentionIndicator={false}
        showHostColumn
        search={isSearching ? search : undefined}
      />
    );
  }

  return (
    <>
      {hostErrors.length > 0 ? <SessionHostErrorsBanner errors={hostErrors} t={t} /> : null}
      {body}
      {importSession.sheet}
    </>
  );
}

/** The workspace a link narrowed History to; ignored on hosts that can't filter by workspace. */
function useWorkspaceFilterParam(): { serverId: string; workspaceId: string } | null {
  const params = useLocalSearchParams<{ serverId?: string; workspaceId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentWorkspaceFilter === true,
  );
  return useMemo(
    () => (supported && serverId && workspaceId ? { serverId, workspaceId } : null),
    [serverId, supported, workspaceId],
  );
}

const selectWorkspaceName = (workspace: { name: string }) => workspace.name;

/** Shown in place of the view and host switches while History is narrowed to one workspace. */
function WorkspaceFilterChip({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement {
  const { t } = useTranslation();
  const name = useWorkspaceFields(serverId, workspaceId, selectWorkspaceName);
  const clear = useCallback(() => {
    router.setParams({ serverId: undefined, workspaceId: undefined });
  }, []);
  return (
    <Button
      size="sm"
      onPress={clear}
      trailing={CLEAR_FILTER_ICON}
      accessibilityLabel={t("sessions.workspaceFilter.clear")}
      testID="sessions-workspace-filter"
    >
      {t("sessions.workspaceFilter.label", {
        name: name ?? t("sessions.workspaceFilter.unnamed"),
      })}
    </Button>
  );
}

function SessionsScreenContent() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const autoFocusSearch = useShouldAutoFocusSearch();
  const workspaceFilter = useWorkspaceFilterParam();
  const [hostChoice, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  // A workspace link pins its host; clearing the filter returns to the host choice.
  const selectedHost = workspaceFilter?.serverId ?? hostChoice;
  const view = useHistoryViewStore((state) => state.view);
  const setView = useHistoryViewStore((state) => state.setView);
  // Gate on any host that can list them; hosts that can't are named inside the view.
  const canShowArchived = useAnyHostSupportsArchivedWorkspaces() && !workspaceFilter;
  const activeView: HistoryView = canShowArchived ? view : "agents";
  const viewOptions = useMemo(
    (): SegmentedControlOption<HistoryView>[] => [
      { value: "agents", label: t("sessions.views.agents"), testID: "sessions-view-agents" },
      {
        value: "archived",
        label: t("sessions.views.archivedWorkspaces"),
        testID: "sessions-view-archived",
      },
    ],
    [t],
  );
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const historyServerId = selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
  const history = useAgentHistory({
    serverId: historyServerId,
    search,
    enabled: activeView === "agents",
    workspaceId: workspaceFilter?.workspaceId ?? null,
  });

  useEffect(() => {
    if (hostChoice !== ALL_HOSTS_OPTION_ID && !hosts.some((host) => host.serverId === hostChoice)) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, hostChoice]);

  const showHostFilter = hosts.length > 1 && !workspaceFilter;
  const showSearch = history.isSearchSupported || activeView === "archived";
  const showFilterRow = showHostFilter || showSearch || canShowArchived || Boolean(workspaceFilter);
  const searchPlaceholder =
    activeView === "archived"
      ? t("sessions.archived.searchPlaceholder")
      : t("sessions.searchPlaceholder");

  const handleClearSearch = useCallback(() => setSearchInput(""), []);

  return (
    <View style={styles.container}>
      <MenuHeader title={t("sessions.title")} />
      {showFilterRow ? (
        <View style={styles.filterContainer}>
          {workspaceFilter ? (
            <WorkspaceFilterChip
              serverId={workspaceFilter.serverId}
              workspaceId={workspaceFilter.workspaceId}
            />
          ) : null}
          {canShowArchived ? (
            <SegmentedControl
              value={activeView}
              onValueChange={setView}
              options={viewOptions}
              style={styles.viewSwitch}
              testID="sessions-view"
            />
          ) : null}
          {showSearch ? (
            <SearchField
              value={searchInput}
              onChangeText={setSearchInput}
              placeholder={searchPlaceholder}
              clearAccessibilityLabel={t("sessions.actions.clearSearch")}
              testID="sessions-search-input"
              clearTestID="sessions-search-clear"
              autoFocus={autoFocusSearch}
            />
          ) : null}
          {showHostFilter ? (
            <HostFilter
              hosts={hosts}
              selectedHost={selectedHost}
              onSelectHost={setSelectedHost}
              triggerTestID="sessions-host-filter-trigger"
              hostOptionTestID={sessionsHostOptionTestID}
            />
          ) : null}
        </View>
      ) : null}
      {activeView === "archived" ? (
        <ArchivedWorkspacesContent
          serverId={historyServerId}
          search={search}
          showHostColumn={showHostFilter}
          onClearSearch={handleClearSearch}
        />
      ) : (
        <AgentHistoryBody
          history={history}
          search={search}
          isAllHosts={selectedHost === ALL_HOSTS_OPTION_ID}
          onClearSearch={handleClearSearch}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  filterContainer: {
    flexDirection: "row",
    // On a phone the view switch takes its own line, so the search field keeps its width.
    flexWrap: {
      xs: "wrap",
      md: "nowrap",
    },
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
  },
  viewSwitch: {
    flexBasis: {
      xs: "100%",
      md: "auto",
    },
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorsBannerWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  errorsBanner: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));

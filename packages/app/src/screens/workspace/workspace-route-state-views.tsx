import { Text, View } from "react-native";
import { ArrowLeftToLine, FolderPlus, RotateCw, Settings } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatConnectionStatus } from "@/utils/daemons";
import type { WorkspaceRouteState } from "@/screens/workspace/workspace-route-state";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface WorkspaceRouteStateActions {
  onRetryHost: () => void;
  onManageHost: () => void;
  onDismissMissingWorkspace: () => void;
  onRecoverWorkspace: () => void;
  onRecreateWorkspace: () => void;
  onRetryRecoveryInspection: () => void;
}

// "banner" sits above an archived workspace's read-only conversation; "page" fills the screen.
export type WorkspaceRouteGateLayout = "page" | "banner";

export function renderWorkspaceRouteGate(input: {
  state: WorkspaceRouteState;
  actions: WorkspaceRouteStateActions;
  layout?: WorkspaceRouteGateLayout;
}): React.ReactNode {
  const layout = input.layout ?? "page";
  switch (input.state.kind) {
    case "loading":
      return <WorkspaceConnecting hostName={input.state.hostName} />;
    case "missing":
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.recovery.unavailableTitle"
          hostName={input.state.hostName}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "archived":
      return (
        <ArchivedWorkspaceRecovery
          state={input.state}
          layout={layout}
          onRecover={input.actions.onRecoverWorkspace}
        />
      );
    case "needsHostUpgrade":
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.needsHostUpgrade"
          hostName={input.state.hostName}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "unreachable":
      return (
        <WorkspaceUnreachable
          state={input.state}
          onRetry={input.actions.onRetryHost}
          onManageHost={input.actions.onManageHost}
        />
      );
    case "recoveryUnavailable":
      if (input.state.recreate) {
        return (
          <WorkspaceRecreateOffer
            layout={layout}
            message={input.state.message}
            recreate={input.state.recreate}
            onRecreate={input.actions.onRecreateWorkspace}
            onDismiss={input.actions.onDismissMissingWorkspace}
          />
        );
      }
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.recovery.unavailableTitle"
          layout={layout}
          description={input.state.message}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "recoveryInspectionFailed":
      return (
        <WorkspaceRecoveryInspectionFailed
          state={input.state}
          onRetry={input.actions.onRetryRecoveryInspection}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "ready":
    case "reconnecting":
      return null;
  }
}

function getWorkspaceHostStateTitle(
  state: Extract<WorkspaceRouteState, { kind: "unreachable" }>,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (state.connectionStatus === "connecting" || state.connectionStatus === "idle") {
    return t("workspace.route.connecting");
  }
  if (state.connectionStatus === "offline") {
    return t("workspace.route.hostOffline", { hostName: state.hostName });
  }
  return t("workspace.route.cannotReachHost", { hostName: state.hostName });
}

function WorkspaceConnecting({ hostName }: { hostName: string }) {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyState}>
      <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      <View style={styles.textStack}>
        <Text style={styles.title}>{t("workspace.route.loading")}</Text>
        <Text style={styles.description}>{hostName}</Text>
      </View>
    </View>
  );
}

function ArchivedWorkspaceRecovery({
  state,
  layout,
  onRecover,
}: {
  state: Extract<WorkspaceRouteState, { kind: "archived" }>;
  layout: WorkspaceRouteGateLayout;
  onRecover: () => void;
}) {
  const { t } = useTranslation();
  const { recovery } = state;
  const isRestoring = recovery.phase === "restoring";
  let actionLabel = t("workspace.route.recovery.unarchiveAction");
  if (recovery.recovery.action === "restore") {
    actionLabel = t("workspace.route.recovery.restoreAction");
  }
  if (recovery.phase === "failed") {
    actionLabel = t("common.actions.retry");
  }
  let description: string;
  if (recovery.recovery.action === "restore" && recovery.recovery.branch) {
    description = t("workspace.route.recovery.restoreDescription", {
      workspaceName: recovery.recovery.workspaceName,
      branch: recovery.recovery.branch,
    });
  } else if (recovery.recovery.action === "restore") {
    description = t("workspace.route.recovery.restoreWithoutBranchDescription", {
      workspaceName: recovery.recovery.workspaceName,
    });
  } else {
    description = t("workspace.route.recovery.unarchiveDescription", {
      workspaceName: recovery.recovery.workspaceName,
    });
  }

  return (
    <View style={containerStyle(layout)} testID="workspace-recovery-gate">
      {isRestoring ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={textStackStyle(layout)}>
        <Text style={[styles.title, layout === "banner" && styles.textStart]}>
          {isRestoring
            ? t("workspace.route.recovery.restoringTitle")
            : t("workspace.route.recovery.archivedTitle")}
        </Text>
        <Text style={[styles.description, layout === "banner" && styles.textStart]}>
          {description}
        </Text>
        {recovery.error ? (
          <Text
            style={[styles.error, layout === "banner" && styles.textStart]}
            testID="workspace-recovery-error"
          >
            {recovery.error}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          variant="default"
          leftIcon={isRestoring ? undefined : RotateCw}
          onPress={onRecover}
          disabled={isRestoring}
          testID="workspace-recovery-action"
        >
          {isRestoring ? t("workspace.route.recovery.restoringAction") : actionLabel}
        </Button>
      </View>
    </View>
  );
}

function WorkspaceRecreateOffer({
  layout,
  message,
  recreate,
  onRecreate,
  onDismiss,
}: {
  layout: WorkspaceRouteGateLayout;
  message: string;
  recreate: NonNullable<Extract<WorkspaceRouteState, { kind: "recoveryUnavailable" }>["recreate"]>;
  onRecreate: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const isRecreating = recreate.phase === "restoring";
  return (
    <View style={containerStyle(layout)} testID="workspace-recovery-gate">
      {isRecreating ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={textStackStyle(layout)}>
        <Text style={[styles.title, layout === "banner" && styles.textStart]}>
          {t("workspace.route.recovery.unavailableTitle")}
        </Text>
        <Text style={[styles.description, layout === "banner" && styles.textStart]}>{message}</Text>
        <Text style={[styles.description, layout === "banner" && styles.textStart]}>
          {t("workspace.route.recovery.recreateDescription")}
        </Text>
        {recreate.error ? (
          <Text
            style={[styles.error, layout === "banner" && styles.textStart]}
            testID="workspace-recovery-recreate-error"
          >
            {recreate.error}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          variant="outline"
          leftIcon={FolderPlus}
          onPress={onRecreate}
          disabled={isRecreating}
          testID="workspace-recovery-recreate"
        >
          {isRecreating
            ? t("workspace.route.recovery.restoringAction")
            : t("workspace.route.recovery.recreateAction")}
        </Button>
        <Button variant="default" leftIcon={ArrowLeftToLine} onPress={onDismiss}>
          {t("common.actions.back")}
        </Button>
      </View>
    </View>
  );
}

function WorkspaceRecoveryInspectionFailed({
  state,
  onRetry,
  onDismiss,
}: {
  state: Extract<WorkspaceRouteState, { kind: "recoveryInspectionFailed" }>;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyState}>
      <View style={styles.textStack}>
        <Text style={styles.title}>{t("workspace.route.recovery.checkFailedTitle")}</Text>
        <Text style={styles.error}>{state.error}</Text>
      </View>
      <View style={styles.actions}>
        <Button variant="default" leftIcon={RotateCw} onPress={onRetry}>
          {t("common.actions.retry")}
        </Button>
        <Button variant="outline" leftIcon={ArrowLeftToLine} onPress={onDismiss}>
          {t("common.actions.back")}
        </Button>
      </View>
    </View>
  );
}

function WorkspaceUnreachable({
  state,
  onRetry,
  onManageHost,
}: {
  state: Extract<WorkspaceRouteState, { kind: "unreachable" }>;
  onRetry: () => void;
  onManageHost: () => void;
}) {
  const { t } = useTranslation();
  const canRetry = state.connectionStatus === "offline" || state.connectionStatus === "error";

  return (
    <View style={styles.emptyState}>
      {state.connectionStatus === "connecting" || state.connectionStatus === "idle" ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={styles.textStack}>
        <Text style={styles.title}>{getWorkspaceHostStateTitle(state, t)}</Text>
        <Text style={styles.description}>
          {state.connectionStatus === "connecting" || state.connectionStatus === "idle"
            ? state.hostName
            : t("workspace.route.hostStatus", {
                status: formatConnectionStatus(state.connectionStatus),
              })}
        </Text>
        {state.lastError ? (
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Text style={styles.error} numberOfLines={3}>
                {state.lastError}
              </Text>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.errorTooltip}>{state.lastError}</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </View>
      {canRetry ? (
        <View style={styles.actions}>
          <Button variant="default" leftIcon={RotateCw} onPress={onRetry}>
            {t("common.actions.retry")}
          </Button>
          <Button variant="outline" leftIcon={Settings} onPress={onManageHost}>
            {t("workspace.route.manageHost")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function WorkspaceEmptyState({
  titleKey,
  layout = "page",
  hostName,
  description,
  onDismiss,
}: {
  titleKey: "workspace.route.needsHostUpgrade" | "workspace.route.recovery.unavailableTitle";
  layout?: WorkspaceRouteGateLayout;
  hostName?: string;
  description?: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={containerStyle(layout)}>
      <View style={textStackStyle(layout)}>
        <Text style={[styles.title, layout === "banner" && styles.textStart]}>{t(titleKey)}</Text>
        <Text style={[styles.description, layout === "banner" && styles.textStart]}>
          {description ?? hostName}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button variant="default" leftIcon={ArrowLeftToLine} onPress={onDismiss}>
          {t("common.actions.back")}
        </Button>
      </View>
    </View>
  );
}

function containerStyle(layout: WorkspaceRouteGateLayout) {
  return layout === "banner" ? styles.banner : styles.emptyState;
}

function textStackStyle(layout: WorkspaceRouteGateLayout) {
  return layout === "banner" ? styles.bannerTextStack : styles.textStack;
}

const styles = StyleSheet.create((theme) => ({
  banner: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  bannerTextStack: {
    flex: 1,
    minWidth: 240,
    gap: theme.spacing[1],
  },
  textStart: {
    textAlign: "left",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  textStack: {
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 520,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    lineHeight: Math.round(theme.fontSize.base * 1.4),
    textAlign: "center",
  },
  errorTooltip: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.base,
    maxWidth: 420,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));

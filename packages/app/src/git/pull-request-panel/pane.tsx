import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { CLIENT_FORGE_VIEW_MODULES } from "@/git/forges/view";
import type { PaneNativeContribution } from "@/git/client-forge-module";
import type { ForgeSpecificStatusFacts } from "@/git/merge-capability";
import {
  buildPullRequestCommentContextAttachment,
  buildPullRequestCheckContextAttachment,
  buildPullRequestReviewContextAttachment,
  buildPullRequestThreadContextAttachment,
  canAddPullRequestActivityToChat,
} from "./context-attachment";
import { getCheckIdentity } from "./checks-section";
import type { PrPaneActivity, PrPaneCheck, PrPaneData } from "./data";
import type { PrThreadEntry } from "./timeline";
import { PullRequestPaneView } from "./view";

const CLIENT_PANE_CONTRIBUTIONS: readonly PaneNativeContribution[] =
  CLIENT_FORGE_VIEW_MODULES.flatMap((module) => module.paneContributions ?? []);

function resolvePaneContribution(
  facts: ForgeSpecificStatusFacts | undefined,
): PaneNativeContribution | null {
  if (!facts) {
    return null;
  }
  return CLIENT_PANE_CONTRIBUTIONS.find((contribution) => contribution.guard(facts)) ?? null;
}

function addLoadingCheck(current: ReadonlySet<string>, checkKey: string): ReadonlySet<string> {
  if (current.has(checkKey)) {
    return current;
  }
  const next = new Set(current);
  next.add(checkKey);
  return next;
}

function removeLoadingCheck(current: ReadonlySet<string>, checkKey: string): ReadonlySet<string> {
  if (!current.has(checkKey)) {
    return current;
  }
  const next = new Set(current);
  next.delete(checkKey);
  return next;
}

export function PullRequestPane({
  serverId,
  cwd,
  data,
  activityLoading,
  workspaceAttachmentScopeKey,
}: {
  serverId: string;
  cwd: string;
  data: PrPaneData;
  activityLoading: boolean;
  workspaceAttachmentScopeKey?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const daemonClient = useHostRuntimeClient(serverId);
  // COMPAT(githubCheckDetailsRpc): recognize the legacy capability on daemons
  // predating checkout.forge.get_check_details.*. Remove after 2027-01-17 once
  // the supported daemon floor is >= v0.2.0.
  const canFetchGitHubCheckDetails = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.githubCheckDetails === true,
  );
  const canFetchForgeCheckDetails = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeCheckDetails === true,
  );
  const forgeProvidersEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeProviders === true,
  );
  const addWorkspaceAttachment = useWorkspaceAttachmentsStore(
    (state) => state.addWorkspaceAttachment,
  );
  const [loadingCheckKeys, setLoadingCheckKeys] = useState<ReadonlySet<string>>(() => new Set());

  const refreshSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const runRefresh = useCheckoutGitActionsStore((state) => state.refresh);
  const isRefreshing =
    useCheckoutGitActionsStore((state) =>
      state.getStatus({ serverId, cwd, actionId: "refresh" }),
    ) === "pending";

  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    void runRefresh({ serverId, cwd }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [cwd, isRefreshing, runRefresh, serverId, t, toast]);

  const handleAddActivityToChat = useCallback(
    (activity: PrPaneActivity) => {
      if (!workspaceAttachmentScopeKey || !canAddPullRequestActivityToChat(activity)) {
        return;
      }
      const input = {
        provider: data.provider,
        forge: data.forge,
        pullRequest: { number: data.number, title: data.title, url: data.url },
        activity,
      };
      const attachment =
        activity.kind === "comment"
          ? buildPullRequestCommentContextAttachment(input)
          : buildPullRequestReviewContextAttachment(input);
      if (!attachment) {
        return;
      }
      addWorkspaceAttachment({
        scopeKey: workspaceAttachmentScopeKey,
        attachment,
      });
    },
    [
      addWorkspaceAttachment,
      data.forge,
      data.number,
      data.provider,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  const handleAddThreadToChat = useCallback(
    (thread: PrThreadEntry) => {
      if (!workspaceAttachmentScopeKey) {
        return;
      }
      const attachment = buildPullRequestThreadContextAttachment({
        provider: data.provider,
        forge: data.forge,
        pullRequest: { number: data.number, title: data.title, url: data.url },
        thread,
      });
      if (!attachment) {
        return;
      }
      addWorkspaceAttachment({
        scopeKey: workspaceAttachmentScopeKey,
        attachment,
      });
    },
    [
      addWorkspaceAttachment,
      data.forge,
      data.number,
      data.provider,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  const handleAddCheckLogsToChat = useCallback(
    async (check: PrPaneCheck) => {
      if (!workspaceAttachmentScopeKey) {
        return;
      }
      const checkKey = getCheckIdentity(check);
      setLoadingCheckKeys((current) => addLoadingCheck(current, checkKey));

      let details = null;
      try {
        const ref = check.detailRef;
        // The neutral forge RPC fetches detail for any forge; fall back to the
        // legacy github-only RPC only for GitHub against a daemon that predates
        // it. A non-GitHub forge therefore needs the neutral capability present.
        const canFetchDetail =
          canFetchForgeCheckDetails || (check.provider === "github" && canFetchGitHubCheckDetails);
        if (
          canFetchDetail &&
          daemonClient &&
          (ref?.checkRunId !== undefined || ref?.workflowRunId !== undefined) &&
          data.repoOwner &&
          data.repoName
        ) {
          try {
            const request = {
              cwd,
              repoOwner: data.repoOwner,
              repoName: data.repoName,
              checkRunId: ref.checkRunId,
              workflowRunId: ref.workflowRunId,
              changeRequestNumber: data.number,
            };
            // COMPAT(githubCheckDetailsRpc): use the legacy GitHub RPC with
            // daemons predating checkout.forge.get_check_details.*. Remove after
            // 2027-01-17 once the supported daemon floor is >= v0.2.0.
            const payload = canFetchForgeCheckDetails
              ? await daemonClient.checkoutForgeGetCheckDetails(request)
              : await daemonClient.checkoutGithubGetCheckDetails(request);
            details = payload.success ? payload.details : null;
          } catch {
            details = null;
          }
        }
        const attachment = buildPullRequestCheckContextAttachment({
          provider: data.provider,
          forge: data.forge,
          pullRequest: { number: data.number, title: data.title, url: data.url },
          check,
          githubDetails: details,
        });
        addWorkspaceAttachment({
          scopeKey: workspaceAttachmentScopeKey,
          attachment,
        });
      } catch {
        // The check row should recover even if attachment formatting or insertion fails.
      } finally {
        setLoadingCheckKeys((current) => removeLoadingCheck(current, checkKey));
      }
    },
    [
      addWorkspaceAttachment,
      canFetchForgeCheckDetails,
      canFetchGitHubCheckDetails,
      cwd,
      daemonClient,
      data.forge,
      data.number,
      data.provider,
      data.repoName,
      data.repoOwner,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  // Native forge surfaces (e.g. GitLab approvals/pipeline) come from a registry
  // keyed by the facts-family, so the central render has no per-forge branch.
  const nativeContribution = resolvePaneContribution(data.forgeSpecific);
  const nativeHeaderMeta = data.forgeSpecific
    ? nativeContribution?.renderHeaderMeta(data.forgeSpecific)
    : null;
  const renderNativeChecks = useCallback(
    (state: { open: boolean; onToggle(): void }) =>
      data.forgeSpecific
        ? nativeContribution?.renderChecksSection(data.forgeSpecific, {
            serverId,
            cwd,
            changeRequestNumber: data.number,
            ...state,
            enabled: forgeProvidersEnabled,
            canFetchCheckDetails: canFetchForgeCheckDetails,
          })
        : null,
    [
      data.forgeSpecific,
      data.number,
      nativeContribution,
      serverId,
      cwd,
      forgeProvidersEnabled,
      canFetchForgeCheckDetails,
    ],
  );
  const attachments = useMemo(
    () =>
      workspaceAttachmentScopeKey
        ? {
            loadingCheckKeys,
            addActivity: handleAddActivityToChat,
            addThread: handleAddThreadToChat,
            addCheck: handleAddCheckLogsToChat,
          }
        : undefined,
    [
      workspaceAttachmentScopeKey,
      loadingCheckKeys,
      handleAddActivityToChat,
      handleAddThreadToChat,
      handleAddCheckLogsToChat,
    ],
  );

  return (
    <PullRequestPaneView
      data={data}
      activityLoading={activityLoading}
      onRefresh={refreshSupported ? handleRefresh : undefined}
      isRefreshing={isRefreshing}
      nativeHeaderMeta={nativeHeaderMeta}
      renderNativeChecks={renderNativeChecks}
      attachments={attachments}
    />
  );
}

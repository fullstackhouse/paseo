import type { CheckoutPrMergeMethod } from "@getpaseo/protocol/messages";
import { create } from "zustand";
import { queryClient as appQueryClient } from "@/data/query-client";
import { useSessionStore } from "@/stores/session-store";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import { i18n } from "@/i18n/i18next";
import {
  decideCreatePrAndMergeStep,
  type CreatePrAndMergeBlockedReason,
  type CreatePrAndMergeOutcome,
} from "@/git/create-pr-and-merge";

const SUCCESS_DISPLAY_MS = 1000;
const CREATE_PR_AND_MERGE_POLL_MS = 3000;
const CREATE_PR_AND_MERGE_TIMEOUT_MS = 45_000;

export type CheckoutGitActionStatus = "idle" | "pending" | "success";

export type CheckoutGitAsyncActionId =
  | "commit"
  | "pull"
  | "push"
  | "pull-and-push"
  | "refresh"
  | "create-pr"
  | "create-pr-and-merge"
  | "merge-pr-squash"
  | "merge-pr-merge"
  | "merge-pr-rebase"
  | "enable-pr-auto-merge-squash"
  | "enable-pr-auto-merge-merge"
  | "enable-pr-auto-merge-rebase"
  | "disable-pr-auto-merge"
  | "merge-branch"
  | "merge-from-base"
  | "discard-changes";

type CheckoutKey = string;
type StatusMap = Partial<Record<CheckoutGitAsyncActionId, CheckoutGitActionStatus>>;

function checkoutKey(serverId: string, cwd: string): CheckoutKey {
  return `${serverId}::${cwd}`;
}

function resolveClient(serverId: string) {
  const session = useSessionStore.getState().sessions[serverId];
  const client = session?.client ?? null;
  if (!client) {
    throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
  }
  return client;
}

type AutoMergeActionsRpc = "forge" | "github";

function findAutoMergeActionsRpc(serverId: string): AutoMergeActionsRpc | null {
  const session = useSessionStore.getState().sessions[serverId];
  if (session?.serverInfo?.features?.checkoutForgeSetAutoMerge === true) {
    return "forge";
  }
  // COMPAT(githubAutoMergeRpc): use the legacy GitHub RPC with daemons that
  // predate checkout.forge.set_auto_merge.*. Remove after 2027-01-17 once the
  // supported daemon floor is >= v0.2.0.
  if (session?.serverInfo?.features?.checkoutGithubSetAutoMerge === true) {
    return "github";
  }
  return null;
}

function resolveAutoMergeActionsRpc(serverId: string): AutoMergeActionsRpc {
  const rpc = findAutoMergeActionsRpc(serverId);
  if (!rpc) {
    throw new Error("Update the host to use auto-merge actions.");
  }
  return rpc;
}

type DaemonClient = ReturnType<typeof resolveClient>;

async function setPrAutoMerge(
  client: DaemonClient,
  rpc: AutoMergeActionsRpc,
  cwd: string,
  input: { enabled: true; method: CheckoutPrMergeMethod } | { enabled: false },
): Promise<void> {
  // COMPAT(githubAutoMergeRpc): use the legacy GitHub RPC with daemons that
  // predate checkout.forge.set_auto_merge.*. Remove after 2027-01-17 once the
  // supported daemon floor is >= v0.2.0.
  const payload =
    rpc === "forge"
      ? await client.checkoutForgeSetAutoMerge(cwd, input)
      : await client.checkoutGithubSetAutoMerge(cwd, input);
  if (payload.error) {
    throw new Error(payload.error.message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrAndMergeBlockedMessage(
  reason: CreatePrAndMergeBlockedReason | "not-ready",
  context: "mr" | undefined,
): string {
  const options = context ? { context } : undefined;
  switch (reason) {
    case "conflicts":
      return i18n.t("workspace.git.actions.createPrAndMerge.blockedConflicts", options);
    case "merge-queue":
      return i18n.t("workspace.git.actions.createPrAndMerge.blockedQueue", options);
    case "closed":
      return i18n.t("workspace.git.actions.createPrAndMerge.blockedClosed", options);
    case "not-ready":
      return i18n.t("workspace.git.actions.createPrAndMerge.notReady", options);
  }
}

/**
 * Polls the new PR until the forge settles its merge state, then merges it
 * directly or turns on auto-merge. Each round forces a forge refresh: the
 * daemon's background poll is too slow for a just-created PR.
 */
async function mergePrWhenReady(input: {
  client: DaemonClient;
  serverId: string;
  cwd: string;
  changeRequestContext: "mr" | undefined;
}): Promise<CreatePrAndMergeOutcome> {
  const { client, serverId, cwd, changeRequestContext } = input;
  const autoMergeRpc = findAutoMergeActionsRpc(serverId);
  const deadline = Date.now() + CREATE_PR_AND_MERGE_TIMEOUT_MS;
  for (;;) {
    const refresh = await client.checkoutRefresh(cwd);
    if (refresh.error) {
      throw new Error(refresh.error.message);
    }
    const prStatus = await client.checkoutPrStatus(cwd);
    if (prStatus.error) {
      throw new Error(prStatus.error.message);
    }
    const step = decideCreatePrAndMergeStep({
      status: prStatus.status,
      autoMergeSupported: autoMergeRpc !== null,
    });
    switch (step.kind) {
      case "merge": {
        const payload = await client.checkoutPrMerge(cwd, { method: step.method });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
        return "merged";
      }
      case "enable-auto-merge":
        // autoMergeSupported was true, so the RPC exists.
        await setPrAutoMerge(client, autoMergeRpc!, cwd, { enabled: true, method: step.method });
        return "auto-merge-enabled";
      case "done":
        return step.outcome;
      case "blocked":
        throw new Error(createPrAndMergeBlockedMessage(step.reason, changeRequestContext));
      case "wait":
        if (Date.now() >= deadline) {
          throw new Error(createPrAndMergeBlockedMessage("not-ready", changeRequestContext));
        }
        await sleep(CREATE_PR_AND_MERGE_POLL_MS);
    }
  }
}

function setStatus(
  key: CheckoutKey,
  actionId: CheckoutGitAsyncActionId,
  status: CheckoutGitActionStatus,
) {
  useCheckoutGitActionsStore.setState((state) => {
    const current = state.statusByCheckout[key]?.[actionId] ?? "idle";
    if (current === status) {
      return state;
    }
    return {
      ...state,
      statusByCheckout: {
        ...state.statusByCheckout,
        [key]: {
          ...state.statusByCheckout[key],
          [actionId]: status,
        },
      },
    };
  });
}

function invalidateCheckoutGitQueries(serverId: string, cwd: string) {
  return invalidateCheckoutGitQueriesForClient(appQueryClient, { serverId, cwd });
}

const successTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<unknown>>();

function inFlightKey(key: CheckoutKey, actionId: CheckoutGitAsyncActionId): string {
  return `${key}::${actionId}`;
}

interface CheckoutGitActionsStoreState {
  statusByCheckout: Record<CheckoutKey, StatusMap>;

  getStatus: (params: {
    serverId: string;
    cwd: string;
    actionId: CheckoutGitAsyncActionId;
  }) => CheckoutGitActionStatus;

  commit: (params: { serverId: string; cwd: string }) => Promise<void>;
  pull: (params: { serverId: string; cwd: string }) => Promise<void>;
  push: (params: { serverId: string; cwd: string }) => Promise<void>;
  pullAndPush: (params: { serverId: string; cwd: string }) => Promise<void>;
  refresh: (params: { serverId: string; cwd: string }) => Promise<void>;
  createPr: (params: { serverId: string; cwd: string }) => Promise<void>;
  /**
   * Commits local changes (when asked), creates the PR (the daemon pushes
   * first), then merges it or enables auto-merge. Resolves to undefined when it
   * joined a run that was already in flight.
   */
  createPrAndMerge: (params: {
    serverId: string;
    cwd: string;
    commitFirst: boolean;
    changeRequestContext: "mr" | undefined;
  }) => Promise<CreatePrAndMergeOutcome | undefined>;
  mergePr: (params: {
    serverId: string;
    cwd: string;
    method: CheckoutPrMergeMethod;
  }) => Promise<void>;
  enablePrAutoMerge: (params: {
    serverId: string;
    cwd: string;
    method: CheckoutPrMergeMethod;
  }) => Promise<void>;
  disablePrAutoMerge: (params: { serverId: string; cwd: string }) => Promise<void>;
  mergeBranch: (params: { serverId: string; cwd: string; baseRef: string }) => Promise<void>;
  mergeFromBase: (params: { serverId: string; cwd: string; baseRef: string }) => Promise<void>;
  discardChanges: (params: { serverId: string; cwd: string; paths: string[] }) => Promise<void>;
}

async function runCheckoutAction({
  serverId,
  cwd,
  actionId,
  run,
}: {
  serverId: string;
  cwd: string;
  actionId: CheckoutGitAsyncActionId;
  run: () => Promise<void>;
}): Promise<void> {
  const key = checkoutKey(serverId, cwd);
  const inflightId = inFlightKey(key, actionId);

  const existing = inFlight.get(inflightId);
  if (existing) {
    await existing;
    return;
  }

  const prevTimer = successTimers.get(inflightId);
  if (prevTimer) {
    clearTimeout(prevTimer);
    successTimers.delete(inflightId);
  }

  setStatus(key, actionId, "pending");

  const promise = (async () => {
    try {
      await run();
      await invalidateCheckoutGitQueries(serverId, cwd);
      setStatus(key, actionId, "success");
      const timer = setTimeout(() => {
        setStatus(key, actionId, "idle");
        successTimers.delete(inflightId);
      }, SUCCESS_DISPLAY_MS);
      successTimers.set(inflightId, timer);
    } catch (error) {
      setStatus(key, actionId, "idle");
      throw error;
    } finally {
      inFlight.delete(inflightId);
    }
  })();

  inFlight.set(inflightId, promise);
  await promise;
}

export const useCheckoutGitActionsStore = create<CheckoutGitActionsStoreState>()((set, get) => ({
  statusByCheckout: {},

  getStatus: ({ serverId, cwd, actionId }) => {
    const key = checkoutKey(serverId, cwd);
    return get().statusByCheckout[key]?.[actionId] ?? "idle";
  },

  commit: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "commit",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutCommit(cwd, { addAll: true });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  pull: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "pull",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutPull(cwd);
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  push: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "push",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutPush(cwd);
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  refresh: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "refresh",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutRefresh(cwd);
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  pullAndPush: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "pull-and-push",
      run: async () => {
        const client = resolveClient(serverId);
        const pullPayload = await client.checkoutPull(cwd);
        if (pullPayload.error) {
          throw new Error(pullPayload.error.message);
        }
        const pushPayload = await client.checkoutPush(cwd);
        if (pushPayload.error) {
          throw new Error(pushPayload.error.message);
        }
      },
    });
  },

  createPr: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "create-pr",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutPrCreate(cwd, {});
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  createPrAndMerge: async ({ serverId, cwd, commitFirst, changeRequestContext }) => {
    let outcome: CreatePrAndMergeOutcome | undefined;
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "create-pr-and-merge",
      run: async () => {
        const client = resolveClient(serverId);
        if (commitFirst) {
          const commit = await client.checkoutCommit(cwd, { addAll: true });
          if (commit.error) {
            throw new Error(commit.error.message);
          }
        }
        const created = await client.checkoutPrCreate(cwd, {});
        if (created.error) {
          throw new Error(created.error.message);
        }
        outcome = await mergePrWhenReady({ client, serverId, cwd, changeRequestContext });
      },
    });
    return outcome;
  },

  mergePr: async ({ serverId, cwd, method }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: `merge-pr-${method}`,
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutPrMerge(cwd, { method });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  enablePrAutoMerge: async ({ serverId, cwd, method }) => {
    const rpc = resolveAutoMergeActionsRpc(serverId);
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: `enable-pr-auto-merge-${method}`,
      run: async () => {
        await setPrAutoMerge(resolveClient(serverId), rpc, cwd, { enabled: true, method });
      },
    });
  },

  disablePrAutoMerge: async ({ serverId, cwd }) => {
    const rpc = resolveAutoMergeActionsRpc(serverId);
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "disable-pr-auto-merge",
      run: async () => {
        await setPrAutoMerge(resolveClient(serverId), rpc, cwd, { enabled: false });
      },
    });
  },

  mergeBranch: async ({ serverId, cwd, baseRef }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "merge-branch",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutMerge(cwd, {
          baseRef,
          strategy: "merge",
          requireCleanTarget: true,
        });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  mergeFromBase: async ({ serverId, cwd, baseRef }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "merge-from-base",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutMergeFromBase(cwd, {
          baseRef,
          requireCleanTarget: true,
        });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  discardChanges: async ({ serverId, cwd, paths }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "discard-changes",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutDiscardChanges(cwd, { paths });
        if (!payload.success) {
          throw new Error(
            payload.error?.message ?? i18n.t("workspace.fileActions.confirmRevert.failed"),
          );
        }
      },
    });
  },
}));

export function __resetCheckoutGitActionsStoreForTests() {
  for (const timer of successTimers.values()) {
    clearTimeout(timer);
  }
  successTimers.clear();
  inFlight.clear();
  useCheckoutGitActionsStore.setState({ statusByCheckout: {} });
}

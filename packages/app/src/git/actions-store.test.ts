import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { queryClient as appQueryClient } from "@/data/query-client";
import { useSessionStore } from "@/stores/session-store";
import {
  __resetCheckoutGitActionsStoreForTests,
  useCheckoutGitActionsStore,
} from "@/git/actions-store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("checkout-git-actions-store", () => {
  const serverId = "server-1";
  const cwd = "/tmp/repo/worktrees/feature";

  beforeEach(() => {
    vi.useFakeTimers();
    __resetCheckoutGitActionsStoreForTests();
    appQueryClient.clear();
    useSessionStore.setState((state) => ({ ...state, sessions: {} }));
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetCheckoutGitActionsStoreForTests();
    appQueryClient.clear();
    useSessionStore.setState((state) => ({ ...state, sessions: {} }));
  });

  it("shares pending state per checkout and de-dupes in-flight calls", async () => {
    const deferred = createDeferred<unknown>();
    const client = {
      checkoutCommit: vi.fn(() => deferred.promise),
    };

    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: { client } as unknown as (typeof state.sessions)[string],
      },
    }));

    const store = useCheckoutGitActionsStore.getState();

    const first = store.commit({ serverId, cwd });
    const second = store.commit({ serverId, cwd });

    expect(store.getStatus({ serverId, cwd, actionId: "commit" })).toBe("pending");

    deferred.resolve({});
    await Promise.all([first, second]);

    expect(store.getStatus({ serverId, cwd, actionId: "commit" })).toBe("success");

    vi.advanceTimersByTime(1000);
    expect(store.getStatus({ serverId, cwd, actionId: "commit" })).toBe("idle");
  });

  it("runs pull then push sequentially for pull-and-push", async () => {
    const order: string[] = [];
    const client = {
      checkoutPull: vi.fn(async () => {
        order.push("pull");
        return {};
      }),
      checkoutPush: vi.fn(async () => {
        order.push("push");
        return {};
      }),
    };
    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: { client } as unknown as (typeof state.sessions)[string],
      },
    }));

    await useCheckoutGitActionsStore.getState().pullAndPush({ serverId, cwd });

    expect(order).toEqual(["pull", "push"]);
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "pull-and-push" }),
    ).toBe("success");
  });

  it("does not push when pull fails for pull-and-push", async () => {
    const client = {
      checkoutPull: vi.fn(async () => ({ error: { message: "pull conflict" } })),
      checkoutPush: vi.fn(async () => ({})),
    };
    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: { client } as unknown as (typeof state.sessions)[string],
      },
    }));

    await expect(
      useCheckoutGitActionsStore.getState().pullAndPush({ serverId, cwd }),
    ).rejects.toThrow("pull conflict");
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "pull-and-push" }),
    ).toBe("idle");
  });

  it("surfaces push errors from pull-and-push after a successful pull", async () => {
    const client = {
      checkoutPull: vi.fn(async () => ({})),
      checkoutPush: vi.fn(async () => ({ error: { message: "push rejected" } })),
    };
    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: { client } as unknown as (typeof state.sessions)[string],
      },
    }));

    await expect(
      useCheckoutGitActionsStore.getState().pullAndPush({ serverId, cwd }),
    ).rejects.toThrow("push rejected");
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "pull-and-push" }),
    ).toBe("idle");
  });

  it("refreshes git and GitHub state and reports success", async () => {
    const client = {
      checkoutRefresh: vi.fn(async () => ({ success: true, error: null })),
    };
    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: { client } as unknown as (typeof state.sessions)[string],
      },
    }));

    await useCheckoutGitActionsStore.getState().refresh({ serverId, cwd });

    expect(client.checkoutRefresh).toHaveBeenCalledWith(cwd);
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "refresh" }),
    ).toBe("success");
  });

  it("surfaces a refresh error and returns to idle", async () => {
    const client = {
      checkoutRefresh: vi.fn(async () => ({ error: { message: "not a git repository" } })),
    };
    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: { client } as unknown as (typeof state.sessions)[string],
      },
    }));

    await expect(useCheckoutGitActionsStore.getState().refresh({ serverId, cwd })).rejects.toThrow(
      "not a git repository",
    );
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "refresh" }),
    ).toBe("idle");
  });

  it("discards selected paths through the shared checkout action workflow", async () => {
    const checkoutDiscardChanges = vi.fn(async () => ({ success: true, error: null }));
    const client = { checkoutDiscardChanges };
    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: { client } as unknown as (typeof state.sessions)[string],
      },
    }));

    await useCheckoutGitActionsStore
      .getState()
      .discardChanges({ serverId, cwd, paths: ["renamed.ts", "original.ts"] });

    expect(checkoutDiscardChanges).toHaveBeenCalledWith(cwd, {
      paths: ["renamed.ts", "original.ts"],
    });
    expect(
      useCheckoutGitActionsStore
        .getState()
        .getStatus({ serverId, cwd, actionId: "discard-changes" }),
    ).toBe("success");
  });

  for (const rpc of [
    {
      label: "forge",
      method: "checkoutForgeSetAutoMerge",
      feature: "checkoutForgeSetAutoMerge",
    },
    {
      label: "legacy GitHub",
      method: "checkoutGithubSetAutoMerge",
      feature: "checkoutGithubSetAutoMerge",
    },
  ] as const) {
    it(`enables PR auto-merge through the ${rpc.label} RPC`, async () => {
      const setAutoMerge = vi.fn(async () => ({
        enabled: true,
        success: true,
        error: null,
      }));
      const client = { [rpc.method]: setAutoMerge };
      useSessionStore.getState().initializeSession(serverId, client as unknown as DaemonClient);
      useSessionStore.getState().updateSessionServerInfo(serverId, {
        serverId,
        hostname: null,
        version: null,
        features: { [rpc.feature]: true },
      });

      await useCheckoutGitActionsStore
        .getState()
        .enablePrAutoMerge({ serverId, cwd, method: "squash" });

      expect(setAutoMerge).toHaveBeenCalledWith(cwd, {
        enabled: true,
        method: "squash",
      });
      expect(
        useCheckoutGitActionsStore
          .getState()
          .getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-squash" }),
      ).toBe("success");
    });

    it(`disables PR auto-merge through the ${rpc.label} RPC`, async () => {
      const setAutoMerge = vi.fn(async () => ({
        enabled: false,
        success: true,
        error: null,
      }));
      const client = { [rpc.method]: setAutoMerge };
      useSessionStore.getState().initializeSession(serverId, client as unknown as DaemonClient);
      useSessionStore.getState().updateSessionServerInfo(serverId, {
        serverId,
        hostname: null,
        version: null,
        features: { [rpc.feature]: true },
      });

      await useCheckoutGitActionsStore.getState().disablePrAutoMerge({ serverId, cwd });

      expect(setAutoMerge).toHaveBeenCalledWith(cwd, { enabled: false });
      expect(
        useCheckoutGitActionsStore
          .getState()
          .getStatus({ serverId, cwd, actionId: "disable-pr-auto-merge" }),
      ).toBe("success");
    });
  }

  it("does not call PR auto-merge RPCs when the daemon lacks the feature flag", async () => {
    const client = {
      checkoutForgeSetAutoMerge: vi.fn(async () => ({
        enabled: true,
        success: true,
        error: null,
      })),
    };
    useSessionStore.getState().initializeSession(serverId, client as unknown as DaemonClient);
    useSessionStore.getState().updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: null,
      features: {},
    });

    await expect(
      useCheckoutGitActionsStore.getState().enablePrAutoMerge({ serverId, cwd, method: "merge" }),
    ).rejects.toThrow("Update the host to use auto-merge actions.");

    expect(client.checkoutForgeSetAutoMerge).not.toHaveBeenCalled();
    expect(
      useCheckoutGitActionsStore
        .getState()
        .getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-merge" }),
    ).toBe("idle");
  });

  describe("createPrAndMerge", () => {
    function prStatusPayload(mergeStateStatus: string | null, mergeable = "MERGEABLE") {
      return {
        error: null,
        status: {
          url: "https://github.com/acme/repo/pull/7",
          state: "open",
          isMerged: false,
          mergeable,
          forgeSpecific: {
            forge: "github",
            mergeStateStatus,
            autoMergeRequest: null,
            viewerCanEnableAutoMerge: true,
            repository: {
              autoMergeAllowed: true,
              mergeCommitAllowed: true,
              squashMergeAllowed: true,
              rebaseMergeAllowed: false,
              viewerDefaultMergeMethod: "SQUASH",
            },
          },
        },
      };
    }

    function installClient(
      client: Record<string, unknown>,
      features: Record<string, boolean> = {},
    ) {
      useSessionStore.setState((state) => ({
        ...state,
        sessions: {
          ...state.sessions,
          [serverId]: {
            client,
            serverInfo: { features },
          } as unknown as (typeof state.sessions)[string],
        },
      }));
    }

    function createClient(prStatuses: ReturnType<typeof prStatusPayload>[]) {
      const calls: string[] = [];
      const client = {
        checkoutCommit: vi.fn(async () => {
          calls.push("commit");
          return { error: null };
        }),
        checkoutPrCreate: vi.fn(async () => {
          calls.push("create-pr");
          return { error: null };
        }),
        checkoutRefresh: vi.fn(async () => ({ error: null })),
        checkoutPrStatus: vi.fn(async () => {
          calls.push("status");
          return prStatuses.length > 1 ? prStatuses.shift()! : prStatuses[0]!;
        }),
        checkoutPrMerge: vi.fn(async () => {
          calls.push("merge");
          return { error: null };
        }),
        checkoutForgeSetAutoMerge: vi.fn(async () => {
          calls.push("auto-merge");
          return { error: null };
        }),
      };
      return { client, calls };
    }

    it("commits, creates the PR, waits for the merge state, then merges", async () => {
      const { client, calls } = createClient([
        prStatusPayload("UNKNOWN", "UNKNOWN"),
        prStatusPayload("CLEAN"),
      ]);
      installClient(client);

      const run = useCheckoutGitActionsStore.getState().createPrAndMerge({
        serverId,
        cwd,
        commitFirst: true,
        changeRequestContext: undefined,
      });
      await vi.advanceTimersByTimeAsync(3000);

      await expect(run).resolves.toBe("merged");
      expect(calls).toEqual(["commit", "create-pr", "status", "status", "merge"]);
      expect(client.checkoutPrMerge).toHaveBeenCalledWith(cwd, { method: "squash" });
      expect(
        useCheckoutGitActionsStore
          .getState()
          .getStatus({ serverId, cwd, actionId: "create-pr-and-merge" }),
      ).toBe("success");
    });

    it("enables auto-merge when checks still block the PR", async () => {
      const { client, calls } = createClient([prStatusPayload("BLOCKED")]);
      installClient(client, { checkoutForgeSetAutoMerge: true });

      await expect(
        useCheckoutGitActionsStore.getState().createPrAndMerge({
          serverId,
          cwd,
          commitFirst: false,
          changeRequestContext: undefined,
        }),
      ).resolves.toBe("auto-merge-enabled");
      expect(calls).toEqual(["create-pr", "status", "auto-merge"]);
      expect(client.checkoutForgeSetAutoMerge).toHaveBeenCalledWith(cwd, {
        enabled: true,
        method: "squash",
      });
    });

    it("gives up with a clear message when the PR never becomes mergeable", async () => {
      const { client } = createClient([prStatusPayload("UNKNOWN", "UNKNOWN")]);
      installClient(client);

      const run = useCheckoutGitActionsStore.getState().createPrAndMerge({
        serverId,
        cwd,
        commitFirst: false,
        changeRequestContext: undefined,
      });
      const assertion = expect(run).rejects.toThrow(
        "The PR was created but isn't ready to merge yet. Merge it from the menu once it is.",
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(client.checkoutPrMerge).not.toHaveBeenCalled();
    });

    it("does not create the PR when the commit fails", async () => {
      const { client } = createClient([prStatusPayload("CLEAN")]);
      client.checkoutCommit.mockResolvedValueOnce({
        error: { message: "nothing to commit" },
      } as never);
      installClient(client);

      await expect(
        useCheckoutGitActionsStore.getState().createPrAndMerge({
          serverId,
          cwd,
          commitFirst: true,
          changeRequestContext: undefined,
        }),
      ).rejects.toThrow("nothing to commit");
      expect(client.checkoutPrCreate).not.toHaveBeenCalled();
    });
  });
});

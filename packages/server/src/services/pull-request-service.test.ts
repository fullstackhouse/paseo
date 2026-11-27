import { describe, expect, it } from "vitest";
import type { ChangeRequestRouter } from "./change-request-router.js";
import {
  ChangeRequestReadError,
  type ChangeRequestBranchEntry,
  type ChangeRequestBranchQuery,
  type ChangeRequestListEntry,
  type ChangeRequestListQuery,
  type ChangeRequestReadObserver,
  type ChangeRequestReadOptions,
  type ChangeRequestReadResult,
  type ChangeRequestSource,
} from "./change-request-source.js";
import {
  CORE_WORKSPACE_CALLER,
  PULL_REQUEST_BACKGROUND_INTERVAL_MS,
  PULL_REQUEST_FAST_INTERVAL_MS,
  PULL_REQUEST_SLOW_INTERVAL_MS,
  branchCostId,
  createPullRequestService,
  type PullRequestSubscriptionUpdate,
} from "./pull-request-service.js";

const PR_A = "https://github.com/acme/widgets/pull/1";
const PR_B = "https://github.com/acme/widgets/pull/2";
const REPO = "https://github.com/acme/widgets";

function result(overrides: Partial<ChangeRequestReadResult> = {}): ChangeRequestReadResult {
  return {
    state: "open",
    headSha: "abc",
    checksState: "passed",
    checks: [],
    reviewDecision: null,
    number: 1,
    title: "Fix the login redirect",
    isDraft: false,
    mergeable: "MERGEABLE",
    ...overrides,
  };
}

/** A forge the test drives: `results` is what the next read returns per URL. */
function harness() {
  let clock = 1_000_000;
  const timers: { at: number; callback: () => void; id: number }[] = [];
  let nextTimer = 1;
  const results = new Map<string, ChangeRequestReadResult | Error>();
  const reads: { urls: string[]; options?: ChangeRequestReadOptions }[] = [];
  const branchLists = new Map<string, ChangeRequestBranchEntry[] | Error>();
  const branchReads: ChangeRequestBranchQuery[] = [];
  /** What the next list of a repository returns; `listReads` records each forge list. */
  const openLists = new Map<string, ChangeRequestListEntry[] | Error>();
  const listReads: ChangeRequestListQuery[] = [];
  const observers = new Set<ChangeRequestReadObserver>();
  const source: ChangeRequestSource = {
    resolve: (url) => url.toLowerCase(),
    describe: (url) => url,
    observe: () => () => {},
    async read(urls, options) {
      reads.push({ urls, ...(options ? { options } : {}) });
      return new Map(
        urls.map((url) => [url, results.get(url) ?? new Error(`Could not read ${url}.`)]),
      );
    },
    resolveRepository: (url) => url.toLowerCase().replace(/\/pull\/\d+$/, ""),
    async listForBranch(query) {
      branchReads.push(query);
      const list = branchLists.get(query.headRef) ?? [];
      if (list instanceof Error) throw list;
      return list;
    },
    async listOpen(query) {
      listReads.push(query);
      const list = openLists.get(query.repo) ?? [];
      if (list instanceof Error) throw list;
      return list.slice(0, query.limit);
    },
    observeReads(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
  };
  const router: ChangeRequestRouter = {
    async resolve(url) {
      if (!url.startsWith("https://github.com/")) throw new Error(`Unknown host for ${url}`);
      return { forge: "github", url: url.toLowerCase() };
    },
    source: (forge) => (forge === "github" ? source : null),
    async resolveRepository(url) {
      return { forge: "github", repo: url.toLowerCase() };
    },
  };
  const service = createPullRequestService({
    router,
    now: () => clock,
    setTimer: (callback, ms) => {
      const id = nextTimer++;
      timers.push({ at: clock + ms, callback, id });
      return id;
    },
    clearTimer: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  /** Moves the clock and runs every timer that falls due, letting their reads settle. */
  async function advance(ms: number) {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      clock = next.at;
      next.callback();
      await settle();
    }
    clock = target;
  }
  return {
    service,
    results,
    reads,
    branchLists,
    branchReads,
    openLists,
    listReads,
    observers,
    advance,
    get now() {
      return clock;
    },
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

function openPullRequest(number: number): ChangeRequestListEntry {
  return {
    url: `${REPO}/pull/${number}`,
    number,
    title: `Change ${number}`,
    isDraft: false,
    headRef: `feat/change-${number}`,
    author: "octocat",
    updatedAt: "2026-11-27T10:00:00Z",
  };
}

function collect() {
  const updates: PullRequestSubscriptionUpdate[] = [];
  return { updates, onUpdate: (update: PullRequestSubscriptionUpdate) => updates.push(update) };
}

describe("createPullRequestService", () => {
  it("reads a PR once for every subscriber that follows it", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    const first = await h.service.subscribe("plugin:paseo-prs", { urls: [PR_A] }, () => {});
    const second = await h.service.subscribe("plugin:paseo-asks", { urls: [PR_A] }, () => {});

    expect(h.reads).toHaveLength(1);
    expect(first.initial.results[0]).toMatchObject({ url: PR_A, ok: true, state: "open" });
    expect(second.initial.results[0]).toMatchObject({ url: PR_A, ok: true, state: "open" });

    await h.advance(PULL_REQUEST_BACKGROUND_INTERVAL_MS);
    expect(h.reads).toHaveLength(2);
    expect(h.reads[1]!.urls).toEqual([PR_A]);
  });

  it("reads moving PRs every 20 s only while someone visible follows them", async () => {
    const h = harness();
    h.results.set(PR_A, result({ checksState: "pending" }));
    const background = await h.service.subscribe("app", { urls: [PR_A] }, () => {});
    await h.advance(PULL_REQUEST_FAST_INTERVAL_MS);
    expect(h.reads).toHaveLength(1);

    // Last read 20 s ago: due at once for a visible subscriber, then every 20 s.
    const visible = await h.service.subscribe(
      "plugin:paseo-inbox",
      { urls: [PR_A], priority: "visible" },
      () => {},
    );
    await h.advance(PULL_REQUEST_FAST_INTERVAL_MS);
    expect(h.reads).toHaveLength(3);

    visible.unsubscribe();
    await h.advance(PULL_REQUEST_FAST_INTERVAL_MS * 4);
    expect(h.reads).toHaveLength(3);
    background.unsubscribe();
  });

  it("stops reading a PR once it reads merged", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    await h.service.subscribe("app", { urls: [PR_A] }, () => {});
    h.results.set(PR_A, result({ state: "merged" }));
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS * 10);
    expect(h.reads).toHaveLength(2);
  });

  it("pushes only what changed, to the URL each subscriber asked by", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    h.results.set(PR_B, result({ number: 2 }));
    const { updates, onUpdate } = collect();
    await h.service.subscribe(
      "app",
      { urls: ["https://github.com/ACME/widgets/pull/1", PR_B], priority: "visible" },
      onUpdate,
    );

    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    expect(updates).toEqual([]);

    h.results.set(PR_A, result({ checksState: "failed" }));
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.results).toEqual([
      expect.objectContaining({
        url: "https://github.com/ACME/widgets/pull/1",
        checksState: "failing",
      }),
    ]);
  });

  it("tells subscribers about a pause once and reads again when it ends", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    const { updates, onUpdate } = collect();
    await h.service.subscribe("app", { urls: [PR_A], priority: "visible" }, onUpdate);

    const retryAt = h.now + PULL_REQUEST_SLOW_INTERVAL_MS + 600_000;
    h.results.set(PR_A, new ChangeRequestReadError("paused", { reason: "paused", retryAt }));
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.results[0]).toMatchObject({ ok: false, reason: "paused", retryAt });

    await h.advance(300_000);
    expect(h.reads).toHaveLength(2);

    h.results.set(PR_A, result({ title: "Renamed" }));
    await h.advance(retryAt - h.now);
    expect(h.reads).toHaveLength(3);
    expect(updates).toHaveLength(2);
    expect(updates[1]!.results[0]).toMatchObject({ ok: true, title: "Renamed" });
  });

  it("takes a workspace poll's status instead of reading the PR again", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    const { updates, onUpdate } = collect();
    await h.service.subscribe("app", { urls: [PR_A] }, onUpdate);

    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS - 2_000);
    for (const observer of h.observers)
      observer.read?.({
        url: PR_A,
        purpose: "workspace",
        status: {
          state: "open",
          headSha: "abc",
          checksState: "failed",
          checks: [],
          reviewDecision: "APPROVED",
        },
      });
    await settle();
    expect(updates.at(-1)!.results[0]).toMatchObject({
      checksState: "failing",
      reviewDecision: "approved",
      title: "Fix the login redirect",
    });

    await h.advance(2_000);
    expect(h.reads).toHaveLength(1);
  });

  it("serves one-shot reads from the subscriptions' cache", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    await h.service.subscribe("plugin:paseo-asks", { urls: [PR_A] }, () => {});
    const [read] = await h.service.read([PR_A], { caller: "plugin:paseo-prs" });
    expect(read).toMatchObject({ ok: true, number: 1 });
    expect(h.reads).toHaveLength(1);
  });

  it("reads deployments only for PRs whose subscribers ask for them", async () => {
    const h = harness();
    h.results.set(PR_A, result({ deployments: [] }));
    h.results.set(PR_B, result({ number: 2 }));
    await h.service.subscribe(
      "plugin:paseo-asks",
      { urls: [PR_A], include: ["deployments"] },
      () => {},
    );
    await h.service.subscribe("plugin:paseo-prs", { urls: [PR_B] }, () => {});
    expect(h.reads[0]!.options?.deployments).toEqual(new Set([PR_A]));
    expect(h.reads[1]!.options).toBeUndefined();
  });

  it("follows the PRs of a branch and pushes when the list changes", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    h.results.set(PR_B, result({ number: 2 }));
    h.branchLists.set("feat/login", [{ url: PR_A, number: 1, state: "open" }]);
    const { updates, onUpdate } = collect();
    const sub = await h.service.subscribe(
      "plugin:paseo-prs",
      { branches: [{ repo: REPO, headRef: "feat/login" }] },
      onUpdate,
    );
    expect(sub.initial.branches).toEqual([
      { repo: REPO, headRef: "feat/login", ok: true, urls: [PR_A] },
    ]);
    expect(sub.initial.results).toEqual([expect.objectContaining({ url: PR_A, ok: true })]);

    h.branchLists.set("feat/login", [
      { url: PR_B, number: 2, state: "open" },
      { url: PR_A, number: 1, state: "open" },
    ]);
    // The branch already has an open PR, so its next lookup is at the background pace.
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    expect(h.branchReads).toHaveLength(1);
    await h.advance(PULL_REQUEST_BACKGROUND_INTERVAL_MS - PULL_REQUEST_SLOW_INTERVAL_MS);
    const last = updates.at(-1)!;
    expect(last.branches).toEqual([
      { repo: REPO, headRef: "feat/login", ok: true, urls: [PR_B, PR_A] },
    ]);
    expect(last.results).toEqual([expect.objectContaining({ url: PR_B, number: 2 })]);
    expect(h.branchReads).toHaveLength(2);
  });

  it("reads idle PRs nobody looks at every 10 minutes, and pending ones every 2", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    h.results.set(PR_B, result({ number: 2, checksState: "pending" }));
    await h.service.subscribe("plugin:paseo-prs", { urls: [PR_A, PR_B] }, () => {});
    expect(h.reads).toHaveLength(1);

    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    expect(h.reads.slice(1).flatMap((read) => read.urls)).toEqual([PR_B]);

    await h.advance(PULL_REQUEST_BACKGROUND_INTERVAL_MS - PULL_REQUEST_SLOW_INTERVAL_MS);
    expect(h.reads.flatMap((read) => read.urls).filter((url) => url === PR_A)).toHaveLength(2);
  });

  it("looks up a branch someone looks at every 2 minutes only until it has an open PR", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    await h.service.subscribe(
      "plugin:paseo-prs",
      { branches: [{ repo: REPO, headRef: "feat/login" }], priority: "visible" },
      () => {},
    );
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    expect(h.branchReads).toHaveLength(2);

    h.branchLists.set("feat/login", [{ url: PR_A, number: 1, state: "open" }]);
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    expect(h.branchReads).toHaveLength(3);
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS * 2);
    expect(h.branchReads).toHaveLength(3);
    await h.advance(PULL_REQUEST_BACKGROUND_INTERVAL_MS);
    expect(h.branchReads).toHaveLength(4);
  });

  it("fetches a branch PR once when the workspace poller and a plugin both follow it", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    h.branchLists.set("feat/login", [{ url: PR_A, number: 1, state: "open" }]);
    const { updates, onUpdate } = collect();
    await h.service.subscribe(
      "plugin:paseo-prs",
      { branches: [{ repo: REPO, headRef: "feat/login" }], priority: "visible" },
      onUpdate,
    );
    expect(h.branchReads).toHaveLength(1);
    expect(h.reads).toHaveLength(1);

    // The workspace poller reads the same PR for its branch every time it is due.
    const poll = (headSha: string) => {
      for (const observer of h.observers)
        observer.read?.({
          url: PR_A,
          purpose: "workspace",
          headRef: "feat/login",
          status: {
            state: "open",
            headSha,
            checksState: "passed",
            checks: [],
            reviewDecision: null,
          },
        });
    };
    for (let i = 0; i < 6; i += 1) {
      await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS - 1_000);
      poll(`sha-${i}`);
      await settle();
    }
    expect(h.reads).toHaveLength(1);
    expect(h.branchReads).toHaveLength(1);
    expect(updates.at(-1)!.results[0]).toMatchObject({ url: PR_A, headSha: "sha-5" });
  });

  it("adds a PR a workspace poll finds to a followed branch's list", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    const { updates, onUpdate } = collect();
    await h.service.subscribe(
      "plugin:paseo-prs",
      { branches: [{ repo: REPO, headRef: "feat/login" }], priority: "visible" },
      onUpdate,
    );
    // Not in the branch list yet, but someone follows the PR so the poll's status is kept.
    await h.service.subscribe("app", { urls: [PR_A] }, () => {});
    for (const observer of h.observers)
      observer.read?.({
        url: PR_A,
        purpose: "workspace",
        headRef: "feat/login",
        status: {
          state: "open",
          headSha: "abc",
          checksState: "passed",
          checks: [],
          reviewDecision: null,
        },
      });
    await settle();
    expect(updates.at(-1)!.branches).toEqual([
      { repo: REPO, headRef: "feat/login", ok: true, urls: [PR_A] },
    ]);
  });

  it("splits each query's cost across the callers that wanted its PRs", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    h.results.set(PR_B, result({ number: 2 }));
    await h.service.subscribe("plugin:paseo-prs", { urls: [PR_A, PR_B] }, () => {});
    await h.service.subscribe("plugin:paseo-asks", { urls: [PR_A] }, () => {});
    await h.service.subscribe(
      "plugin:paseo-prs",
      { branches: [{ repo: REPO, headRef: "feat/login" }] },
      () => {},
    );
    for (const observer of h.observers) {
      observer.cost?.({
        host: "github.com",
        cost: 4,
        parts: [
          { purpose: "read", urls: [PR_A, PR_B], count: 2 },
          { purpose: "workspace", urls: [], count: 1 },
          { purpose: "branch", urls: [branchCostId(REPO, "feat/login")], count: 1 },
        ],
      });
    }
    const usage = h.service.usage();
    const byCaller = Object.fromEntries(usage.callers.map((caller) => [caller.caller, caller]));
    // Read part: 2 points over two PRs. /1 is shared by both plugins, /2 is paseo-prs' alone.
    // The branch lookup's point is paseo-prs'.
    expect(byCaller["plugin:paseo-prs"]).toMatchObject({
      points: 2.5,
      pointsLastHour: 2.5,
      subscriptions: 2,
    });
    expect(byCaller["plugin:paseo-asks"]).toMatchObject({ points: 0.5, subscriptions: 1 });
    expect(byCaller[CORE_WORKSPACE_CALLER]).toMatchObject({ points: 1, reads: 1 });
    expect(usage.followed).toBe(2);
  });

  it("answers a URL no forge recognizes without failing the subscription", async () => {
    const h = harness();
    h.results.set(PR_A, result());
    const sub = await h.service.subscribe(
      "app",
      { urls: ["https://example.com/x/pull/1", PR_A] },
      () => {},
    );
    expect(sub.initial.results).toEqual([
      expect.objectContaining({
        url: "https://example.com/x/pull/1",
        ok: false,
        reason: "unsupported",
      }),
      expect.objectContaining({ url: PR_A, ok: true }),
    ]);
  });

  it("lists a repository's open PRs once for every caller within 30 s", async () => {
    const h = harness();
    h.openLists.set(REPO, [openPullRequest(12), openPullRequest(7)]);
    const [first, second] = await Promise.all([
      h.service.listOpen(REPO, { caller: "app" }),
      h.service.listOpen(REPO, { caller: "plugin:paseo-prs" }),
    ]);
    expect(first).toEqual({
      repo: REPO,
      ok: true,
      items: [
        expect.objectContaining({ number: 12, headRef: "feat/change-12", author: "octocat" }),
        expect.objectContaining({ number: 7 }),
      ],
    });
    expect(second).toEqual(first);
    await h.advance(29_000);
    await h.service.listOpen(REPO, { caller: "app" });
    expect(h.listReads).toEqual([{ repo: REPO, limit: 50 }]);
    await h.advance(1_000);
    await h.service.listOpen(REPO, { caller: "app" });
    expect(h.listReads).toHaveLength(2);
  });

  it("serves a smaller limit from the cache and reads again for a larger one", async () => {
    const h = harness();
    h.openLists.set(REPO, [1, 2, 3, 4, 5].map(openPullRequest));
    await h.service.listOpen(REPO, { limit: 3 });
    const smaller = await h.service.listOpen(REPO, { limit: 2 });
    expect(smaller.items.map((item) => item.number)).toEqual([1, 2]);
    const larger = await h.service.listOpen(REPO, { limit: 10 });
    expect(larger.items).toHaveLength(5);
    // That list came back shorter than its limit, so it is the whole list.
    await h.service.listOpen(REPO, { limit: 100 });
    expect(h.listReads).toEqual([
      { repo: REPO, limit: 3 },
      { repo: REPO, limit: 10 },
    ]);
  });

  it("answers a pause with retryAt and asks the forge again afterwards", async () => {
    const h = harness();
    h.openLists.set(
      REPO,
      new ChangeRequestReadError("Paused", { reason: "paused", retryAt: h.now + 60_000 }),
    );
    expect(await h.service.listOpen(REPO)).toEqual({
      repo: REPO,
      ok: false,
      items: [],
      error: "Paused",
      reason: "paused",
      retryAt: h.now + 60_000,
    });
    h.openLists.set(REPO, [openPullRequest(3)]);
    expect(await h.service.listOpen(REPO)).toMatchObject({ ok: true, items: [{ number: 3 }] });
    expect(h.listReads).toHaveLength(2);
  });

  it("answers a repository no forge recognizes as unsupported", async () => {
    const h = harness();
    const router: ChangeRequestRouter = {
      resolve: async () => {
        throw new Error("unused");
      },
      source: () => null,
      async resolveRepository() {
        throw new Error("Could not recognize a supported forge for host example.com.");
      },
    };
    const service = createPullRequestService({ router, forges: [] });
    expect(await service.listOpen("https://example.com/x/y")).toMatchObject({
      repo: "https://example.com/x/y",
      ok: false,
      items: [],
      reason: "unsupported",
    });
    service.dispose();
    h.service.dispose();
  });

  it("credits a list's cost to the callers that listed the repository", async () => {
    const h = harness();
    h.openLists.set(REPO, [openPullRequest(1)]);
    await h.service.listOpen(REPO, { caller: "app" });
    await h.service.listOpen(REPO, { caller: "plugin:paseo-prs" });
    for (const observer of h.observers) {
      observer.cost?.({
        host: "github.com",
        cost: 1,
        parts: [{ purpose: "list", urls: [REPO], count: 1 }],
      });
    }
    const byCaller = Object.fromEntries(
      h.service.usage().callers.map((caller) => [caller.caller, caller]),
    );
    expect(byCaller.app).toMatchObject({ points: 0.5, reads: 0.5 });
    expect(byCaller["plugin:paseo-prs"]).toMatchObject({ points: 0.5, reads: 0.5 });
  });
});

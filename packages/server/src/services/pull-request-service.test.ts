import { describe, expect, it } from "vitest";
import type { ChangeRequestRouter } from "./change-request-router.js";
import {
  ChangeRequestReadError,
  type ChangeRequestBranchEntry,
  type ChangeRequestBranchQuery,
  type ChangeRequestReadObserver,
  type ChangeRequestReadOptions,
  type ChangeRequestReadResult,
  type ChangeRequestSource,
} from "./change-request-source.js";
import {
  CORE_WORKSPACE_CALLER,
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
    resolveRepository: (url) => url.toLowerCase(),
    async listForBranch(query) {
      branchReads.push(query);
      const list = branchLists.get(query.headRef) ?? [];
      if (list instanceof Error) throw list;
      return list;
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

    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
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
      { urls: ["https://github.com/ACME/widgets/pull/1", PR_B] },
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
    await h.service.subscribe("app", { urls: [PR_A] }, onUpdate);

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
    await h.advance(PULL_REQUEST_SLOW_INTERVAL_MS);
    const last = updates.at(-1)!;
    expect(last.branches).toEqual([
      { repo: REPO, headRef: "feat/login", ok: true, urls: [PR_B, PR_A] },
    ]);
    expect(last.results).toEqual([expect.objectContaining({ url: PR_B, number: 2 })]);
    expect(h.branchReads).toHaveLength(2);
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
});

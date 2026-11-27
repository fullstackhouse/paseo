import type {
  ChangeRequestBranchRead,
  ChangeRequestRead,
  ChangeRequestUsage,
} from "@getpaseo/protocol/messages";
import {
  ChangeRequestReadError,
  type ChangeRequestDetails,
  type ChangeRequestObservedRead,
  type ChangeRequestQueryCost,
  type ChangeRequestReadResult,
  type ChangeRequestStatus,
} from "./change-request-source.js";
import type { ChangeRequestRouter } from "./change-request-router.js";
import { createOpenPullRequestLists, type OpenPullRequestList } from "./open-pull-request-lists.js";

/** How long a read result is served again to one-shot reads before the forge is asked again. */
export const CHANGE_REQUEST_READ_TTL_MS = 30_000;
/** Open, checks or a deployment pending, someone looking. */
export const PULL_REQUEST_FAST_INTERVAL_MS = 20_000;
/** Open, otherwise; also how often branch lookups run. */
export const PULL_REQUEST_SLOW_INTERVAL_MS = 120_000;
export const PULL_REQUEST_ERROR_BACKOFF_CAP_MS = 300_000;
/** A status the workspace poller or a watch read this recently stands in for a due read. */
const OBSERVED_READ_REUSE_MS = 5_000;
/** One-shot readers count toward a PR's demand this long, for budget accounting. */
const READER_DEMAND_MS = 60_000;
const USAGE_WINDOW_MS = 60 * 60_000;
export const PULL_REQUEST_USAGE_LOG_INTERVAL_MS = 10 * 60_000;

export const CORE_WORKSPACE_CALLER = "core:workspace-polls";
export const CORE_WATCH_CALLER = "core:change-request-watches";

export type PullRequestPriority = "visible" | "background";

export interface PullRequestSubscriptionTarget {
  urls?: string[];
  branches?: { repo: string; headRef: string; includeClosed?: boolean }[];
  priority?: PullRequestPriority;
  include?: "deployments"[];
}

export interface PullRequestSubscriptionUpdate {
  results: ChangeRequestRead[];
  branches: ChangeRequestBranchRead[];
}

export interface PullRequestSubscription {
  /** Every result and branch at subscribe time. */
  initial: PullRequestSubscriptionUpdate;
  unsubscribe(): void;
}

export interface PullRequestService {
  /**
   * One result per URL, in order. A URL the router can't place, or a forge read error, is
   * `ok: false` with a `reason`; `paused` carries `retryAt`. Served from the shared cache within
   * `CHANGE_REQUEST_READ_TTL_MS`; reads already in flight are shared.
   */
  read(urls: string[], options?: { caller?: string }): Promise<ChangeRequestRead[]>;
  /**
   * A repository's open pull requests, most recently updated first (default 50, at most 100).
   * Served from a per-repository cache within 30 s; lists already in flight are shared.
   */
  listOpen(
    repo: string,
    options?: { caller?: string; limit?: number },
  ): Promise<OpenPullRequestList>;
  /** Follow PRs and branches; `onUpdate` gets only what changed, batched per tick. */
  subscribe(
    caller: string,
    target: PullRequestSubscriptionTarget,
    onUpdate: (update: PullRequestSubscriptionUpdate) => void,
  ): Promise<PullRequestSubscription>;
  usage(): ChangeRequestUsage;
  dispose(): void;
}

export interface CreatePullRequestServiceOptions {
  router: ChangeRequestRouter;
  now?: () => number;
  /** Forges whose own reads (workspace polls, watches) and query costs feed the cache from start. */
  forges?: string[];
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /** Logs the per-caller usage table every `PULL_REQUEST_USAGE_LOG_INTERVAL_MS`. */
  logUsage?: (usage: ChangeRequestUsage) => void;
}

type CheckState = ChangeRequestStatus["checksState"];

const CHECK_STATES = {
  passed: "passing",
  failed: "failing",
  pending: "pending",
  neutral: "skipped",
} as const satisfies Record<CheckState, string>;

const ROLLUP_STATES = {
  passed: "passing",
  failed: "failing",
  pending: "pending",
  neutral: "none",
} as const satisfies Record<CheckState, string>;

const MERGEABLE = {
  MERGEABLE: "mergeable",
  CONFLICTING: "conflicting",
  UNKNOWN: "unknown",
} as const;

const REVIEW_DECISIONS = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  REVIEW_REQUIRED: "review_required",
} as const;

/** Deployment states that are still moving, so the PR is read at the fast cadence. */
const PENDING_DEPLOYMENT_STATES = new Set(["IN_PROGRESS", "QUEUED", "PENDING", "WAITING"]);

function lookup<T extends Record<string, string>>(table: T, key: string | null): T[keyof T] | null {
  return key !== null && Object.hasOwn(table, key) ? table[key as keyof T] : null;
}

export function toChangeRequestRead(
  url: string,
  result: ChangeRequestReadResult,
): ChangeRequestRead {
  const mergeable = lookup(MERGEABLE, result.mergeable);
  return {
    url,
    ok: true,
    number: result.number,
    title: result.title,
    state: result.state,
    isDraft: result.isDraft,
    ...(mergeable ? { mergeable } : {}),
    reviewDecision: lookup(REVIEW_DECISIONS, result.reviewDecision),
    checksState: ROLLUP_STATES[result.checksState],
    checks: result.checks.map((check) => ({
      name: check.name,
      state: CHECK_STATES[check.state],
      ...(check.url ? { url: check.url } : {}),
    })),
    headSha: result.headSha,
    ...(result.author !== undefined ? { author: result.author } : {}),
    ...(result.reviewRequestCount !== undefined
      ? { reviewRequestCount: result.reviewRequestCount }
      : {}),
    ...(result.viewerCanMergeAsAdmin !== undefined
      ? { viewerCanMergeAsAdmin: result.viewerCanMergeAsAdmin }
      : {}),
    ...(result.deployments
      ? {
          deployments: result.deployments.map((deployment) => ({
            environment: deployment.environment,
            state: deployment.state,
            createdAt: deployment.createdAt,
            ...(deployment.url ? { url: deployment.url } : {}),
            ...(deployment.logUrl ? { logUrl: deployment.logUrl } : {}),
          })),
        }
      : {}),
  };
}

function failureRead(url: string, error: unknown): ChangeRequestRead {
  const reason = error instanceof ChangeRequestReadError ? error.reason : "error";
  const retryAt = error instanceof ChangeRequestReadError ? error.retryAt : undefined;
  return {
    url,
    ok: false,
    error: error instanceof Error ? error.message : "Could not read the change request.",
    reason,
    ...(retryAt !== undefined ? { retryAt } : {}),
  };
}

function unsupported(error: unknown): ChangeRequestReadError {
  const message = error instanceof Error ? error.message : "Unsupported change request URL.";
  return new ChangeRequestReadError(message, { reason: "unsupported", cause: error });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

type Outcome = ChangeRequestReadResult | Error;

interface Subscriber {
  id: number;
  caller: string;
  priority: PullRequestPriority;
  deployments: boolean;
  /** Entry key → the URLs this subscriber asked for it by. */
  urls: Map<string, Set<string>>;
  branches: Set<string>;
  /** False until `subscribe` returns: its `initial` covers what changed meanwhile. */
  ready: boolean;
  onUpdate(update: PullRequestSubscriptionUpdate): void;
}

interface Entry {
  key: string;
  forge: string;
  url: string;
  result: ChangeRequestReadResult | null;
  /** The last failure, cleared by a successful read. */
  failure: Error | null;
  readAt: number | null;
  nextDueAt: number;
  consecutiveErrors: number;
  /** Direct subscribers. */
  subscribers: Set<number>;
  /** Branch lookups that currently list this PR. */
  branches: Set<string>;
  /** What subscribers last got, to push only changes. */
  lastPushed: string | null;
  /** One-shot readers and when, for accounting. */
  readers: Map<string, number>;
}

interface BranchEntry {
  key: string;
  forge: string;
  repo: string;
  headRef: string;
  includeClosed: boolean;
  /** Entry keys, newest first. */
  entries: string[];
  failure: Error | null;
  readAt: number | null;
  nextDueAt: number;
  consecutiveErrors: number;
  subscribers: Set<number>;
  lastPushed: string | null;
}

interface UsageEvent {
  at: number;
  caller: string;
  points: number;
  reads: number;
}

function entryKey(forge: string, url: string): string {
  return `${forge}:${url}`;
}

function branchKey(forge: string, repo: string, headRef: string, includeClosed: boolean): string {
  return `${forge}:${repo}#${headRef}${includeClosed ? "+closed" : ""}`;
}

/** The branch identity a forge reports in a branch lookup's cost, for attribution. */
export function branchCostId(repo: string, headRef: string): string {
  return `${repo}#${headRef}`;
}

function backoff(errors: number): number {
  return Math.min(
    PULL_REQUEST_SLOW_INTERVAL_MS * 2 ** Math.max(0, errors - 1),
    PULL_REQUEST_ERROR_BACKOFF_CAP_MS,
  );
}

/**
 * The details a status read on its own (a workspace poll, a watch) stands for: its own where it
 * had them, else the last full read's. Review facts and deployments come only from full reads,
 * and deployments only while the head commit is the one they were read for. Null when neither
 * has details.
 */
function observedDetails(
  status: ChangeRequestObservedRead["status"],
  previous: ChangeRequestReadResult | null,
): ChangeRequestDetails | null {
  const own =
    status.number !== undefined && status.title !== undefined && status.isDraft !== undefined
      ? { number: status.number, title: status.title, isDraft: status.isDraft }
      : null;
  const base = own ?? previous;
  if (!base) return null;
  const details: ChangeRequestDetails = {
    number: base.number,
    title: base.title,
    isDraft: base.isDraft,
    mergeable: status.mergeable !== undefined ? status.mergeable : (previous?.mergeable ?? null),
  };
  if (!previous) return details;
  if (previous.author !== undefined) details.author = previous.author;
  if (previous.reviewRequestCount !== undefined)
    details.reviewRequestCount = previous.reviewRequestCount;
  if (previous.viewerCanMergeAsAdmin !== undefined)
    details.viewerCanMergeAsAdmin = previous.viewerCanMergeAsAdmin;
  if (previous.deployments && previous.headSha === status.headSha)
    details.deployments = previous.deployments;
  return details;
}

/**
 * The daemon's one owner of pull request data. Every forge read core makes lands in its cache
 * (subscription reads, one-shot reads, and through `observeReads` the workspace poller and
 * change request watches), each PR is read once per due time however many subscribers follow it,
 * and changes are pushed. See docs/pr-service.md.
 */
export function createPullRequestService({
  router,
  now = Date.now,
  forges = ["github"],
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer as NodeJS.Timeout),
  logUsage,
}: CreatePullRequestServiceOptions): PullRequestService {
  const entries = new Map<string, Entry>();
  const branches = new Map<string, BranchEntry>();
  const subscribers = new Map<number, Subscriber>();
  const inflight = new Map<string, Promise<Outcome>>();
  const observedForges = new Map<string, () => void>();
  const pendingUpdates = new Map<
    number,
    { results: Map<string, ChangeRequestRead>; branches: Map<string, ChangeRequestBranchRead> }
  >();
  const openLists = createOpenPullRequestLists({ router, now });
  const startedAt = now();
  const totals = new Map<string, { points: number; reads: number }>();
  let recent: UsageEvent[] = [];
  let nextSubscriberId = 1;
  let timer: unknown = null;
  let timerDueAt: number | null = null;
  let flushQueued = false;
  let disposed = false;
  const usageTimer = logUsage
    ? setInterval(() => {
        const usage = service.usage();
        if (usage.callers.some((caller) => caller.pointsLastHour > 0)) logUsage(usage);
      }, PULL_REQUEST_USAGE_LOG_INTERVAL_MS)
    : null;
  if (usageTimer && typeof usageTimer === "object" && "unref" in usageTimer) usageTimer.unref();

  for (const forge of forges) observeForge(forge);

  function observeForge(forge: string): void {
    if (observedForges.has(forge)) return;
    const source = router.source(forge);
    if (!source?.observeReads) return;
    observedForges.set(
      forge,
      source.observeReads({
        read: (read) => acceptObservedRead(forge, read),
        cost: (cost) => recordCost(forge, cost),
      }),
    );
  }

  // ---- accounting ----

  function credit(caller: string, points: number, reads: number): void {
    const total = totals.get(caller) ?? { points: 0, reads: 0 };
    total.points += points;
    total.reads += reads;
    totals.set(caller, total);
    recent.push({ at: now(), caller, points, reads });
  }

  function demand(entry: Entry): string[] {
    const callers = new Set<string>();
    for (const id of subscribersOf(entry)) {
      const subscriber = subscribers.get(id);
      if (subscriber) callers.add(subscriber.caller);
    }
    for (const [caller, at] of entry.readers) {
      if (now() - at < READER_DEMAND_MS) callers.add(caller);
      else entry.readers.delete(caller);
    }
    return [...callers];
  }

  function recordCost(forge: string, cost: ChangeRequestQueryCost): void {
    const total = cost.parts.reduce((sum, part) => sum + part.count, 0);
    if (total <= 0) return;
    for (const part of cost.parts) {
      const points = (cost.cost * part.count) / total;
      if (part.purpose === "workspace") {
        credit(CORE_WORKSPACE_CALLER, points, part.count);
        continue;
      }
      if (part.purpose === "watch") {
        credit(CORE_WATCH_CALLER, points, part.count);
        continue;
      }
      if (part.purpose === "list") {
        creditShared(
          part.urls.map((repo) => openLists.demand(forge, repo)),
          points,
          part.count,
        );
        continue;
      }
      if (part.purpose === "branch") {
        creditShared(
          part.urls.map((id) => branchDemand(forge, id)),
          points,
          part.count,
        );
        continue;
      }
      if (!part.urls.length) {
        credit("unattributed", points, part.count);
        continue;
      }
      const share = points / part.urls.length;
      for (const url of part.urls) {
        const entry = entries.get(entryKey(forge, url));
        const callers = entry ? demand(entry) : [];
        if (!callers.length) {
          credit("unattributed", share, 1);
          continue;
        }
        for (const caller of callers) credit(caller, share / callers.length, 1 / callers.length);
      }
    }
  }

  /** Splits points evenly across targets, and each target's share across its callers. */
  function creditShared(targets: string[][], points: number, count: number): void {
    if (!targets.length) {
      credit("unattributed", points, count);
      return;
    }
    for (const callers of targets) {
      if (!callers.length) credit("unattributed", points / targets.length, 1);
      for (const caller of callers)
        credit(caller, points / targets.length / callers.length, 1 / callers.length);
    }
  }

  function branchDemand(forge: string, id: string): string[] {
    const callers = new Set<string>();
    for (const branch of branches.values()) {
      if (branch.forge !== forge || branchCostId(branch.repo, branch.headRef) !== id) continue;
      for (const subscriberId of branch.subscribers) {
        const subscriber = subscribers.get(subscriberId);
        if (subscriber) callers.add(subscriber.caller);
      }
    }
    return [...callers];
  }

  // ---- reading ----

  function subscribersOf(entry: Entry): Set<number> {
    const ids = new Set(entry.subscribers);
    for (const key of entry.branches) {
      for (const id of branches.get(key)?.subscribers ?? []) ids.add(id);
    }
    return ids;
  }

  function wantsDeployments(entry: Entry): boolean {
    for (const id of subscribersOf(entry)) if (subscribers.get(id)?.deployments) return true;
    return false;
  }

  function hasVisibleSubscriber(ids: Iterable<number>): boolean {
    for (const id of ids) if (subscribers.get(id)?.priority === "visible") return true;
    return false;
  }

  function getEntry(forge: string, url: string): Entry {
    const key = entryKey(forge, url);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        key,
        forge,
        url,
        result: null,
        failure: null,
        readAt: null,
        nextDueAt: 0,
        consecutiveErrors: 0,
        subscribers: new Set(),
        branches: new Set(),
        lastPushed: null,
        readers: new Map(),
      };
      entries.set(key, entry);
    }
    return entry;
  }

  /** When an entry is next due, from its last outcome and who follows it. */
  function nextDue(entry: Entry, from: number): number {
    const { result, failure } = entry;
    if (failure instanceof ChangeRequestReadError && failure.reason === "paused")
      return failure.retryAt ?? from + PULL_REQUEST_SLOW_INTERVAL_MS;
    if (failure) return from + backoff(entry.consecutiveErrors);
    if (!result) return from;
    if (result.state !== "open") return Infinity;
    const deploying = result.deployments?.some((deployment) =>
      PENDING_DEPLOYMENT_STATES.has(deployment.state ?? ""),
    );
    const moving = result.checksState === "pending" || deploying === true;
    return (
      from +
      (moving && hasVisibleSubscriber(subscribersOf(entry))
        ? PULL_REQUEST_FAST_INTERVAL_MS
        : PULL_REQUEST_SLOW_INTERVAL_MS)
    );
  }

  function readOf(entry: Entry, url: string): ChangeRequestRead {
    if (entry.failure) return failureRead(url, entry.failure);
    if (entry.result) return toChangeRequestRead(url, entry.result);
    return failureRead(url, new Error(`Could not read ${url}.`));
  }

  /** Applies a read outcome to an entry and queues pushes when what subscribers see changed. */
  function settle(entry: Entry, outcome: Outcome, at: number): void {
    const previousState = entry.result?.state;
    if (outcome instanceof Error) {
      entry.failure = outcome;
      const paused = outcome instanceof ChangeRequestReadError && outcome.reason === "paused";
      if (!paused) entry.consecutiveErrors += 1;
    } else {
      entry.result = outcome;
      entry.failure = null;
      entry.consecutiveErrors = 0;
      entry.readAt = at;
    }
    entry.nextDueAt = nextDue(entry, at);
    queuePush(entry);
    if (
      !(outcome instanceof Error) &&
      previousState !== undefined &&
      previousState !== outcome.state
    ) {
      // A PR that changed state can leave or join its branch's list.
      for (const key of entry.branches) {
        const branch = branches.get(key);
        if (branch) branch.nextDueAt = Math.min(branch.nextDueAt, at);
      }
    }
  }

  function queuePush(entry: Entry): void {
    const read = readOf(entry, entry.url);
    const signature = JSON.stringify(read);
    if (signature === entry.lastPushed) return;
    entry.lastPushed = signature;
    for (const id of entry.subscribers) {
      const subscriber = subscribers.get(id);
      if (!subscriber) continue;
      for (const url of subscriber.urls.get(entry.key) ?? []) {
        updatesFor(id).results.set(url, readOf(entry, url));
      }
    }
    for (const key of entry.branches) {
      for (const id of branches.get(key)?.subscribers ?? []) {
        updatesFor(id).results.set(entry.url, read);
      }
    }
    scheduleFlush();
  }

  function updatesFor(id: number) {
    let updates = pendingUpdates.get(id);
    if (!updates) {
      updates = { results: new Map(), branches: new Map() };
      pendingUpdates.set(id, updates);
    }
    return updates;
  }

  function scheduleFlush(): void {
    if (flushQueued) return;
    flushQueued = true;
    // After the current tick's reads settle, so one tick's changes reach a subscriber together.
    setImmediate(() => {
      flushQueued = false;
      const updates = [...pendingUpdates];
      pendingUpdates.clear();
      for (const [id, update] of updates) {
        const subscriber = subscribers.get(id);
        if (!subscriber?.ready) continue;
        try {
          subscriber.onUpdate({
            results: [...update.results.values()],
            branches: [...update.branches.values()],
          });
        } catch {
          // A subscriber's failure must not stop the others.
        }
      }
    });
  }

  /**
   * Reads canonical addresses of one forge, sharing reads already in flight. `deployments` names
   * the addresses that need them; an in-flight read without them doesn't satisfy one that does.
   */
  async function fetchOutcomes(
    forge: string,
    urls: string[],
    deployments: ReadonlySet<string>,
  ): Promise<Map<string, Outcome>> {
    const source = router.source(forge);
    const outcomes = new Map<string, Outcome>();
    if (!source?.read) {
      const error = new ChangeRequestReadError(
        `Reading change requests is not supported for ${forge} yet.`,
        { reason: "unsupported" },
      );
      for (const url of urls) outcomes.set(url, error);
      return outcomes;
    }
    const pending = new Map<string, Promise<Outcome>>();
    const missing: string[] = [];
    for (const url of urls) {
      const flag = deployments.has(url) ? "+d" : "";
      const shared = inflight.get(`${entryKey(forge, url)}${flag}`);
      if (shared) pending.set(url, shared);
      else missing.push(url);
    }
    if (missing.length) {
      const wanted = new Set(missing.filter((url) => deployments.has(url)));
      const read = wanted.size
        ? source.read(missing, { deployments: wanted })
        : source.read(missing);
      const batch: Promise<Map<string, Outcome>> = read.catch(
        (error: unknown) => new Map(missing.map((url) => [url, asError(error)])),
      );
      for (const url of missing) {
        const key = `${entryKey(forge, url)}${wanted.has(url) ? "+d" : ""}`;
        const one = batch.then(
          (results) => results.get(url) ?? new Error(`Could not read ${url}.`),
        );
        inflight.set(key, one);
        pending.set(url, one);
        void one.finally(() => {
          if (inflight.get(key) === one) inflight.delete(key);
        });
        // A forge that read deployments too serves plain reads of the same PR.
        if (wanted.has(url) && !inflight.has(entryKey(forge, url))) {
          inflight.set(entryKey(forge, url), one);
          void one.finally(() => {
            if (inflight.get(entryKey(forge, url)) === one) inflight.delete(entryKey(forge, url));
          });
        }
      }
    }
    await Promise.all(
      [...pending].map(async ([url, outcome]) => {
        outcomes.set(url, await outcome);
      }),
    );
    return outcomes;
  }

  async function resolveAll(urls: string[]) {
    return Promise.all(
      urls.map(async (url) => {
        try {
          const target = await router.resolve(url);
          observeForge(target.forge);
          return { url, target };
        } catch (error) {
          return { url, error: unsupported(error) };
        }
      }),
    );
  }

  /** Reads entries now, grouped per forge, and settles them. */
  async function refresh(targets: Entry[]): Promise<void> {
    const byForge = new Map<string, Entry[]>();
    for (const entry of targets) {
      const list = byForge.get(entry.forge) ?? [];
      list.push(entry);
      byForge.set(entry.forge, list);
    }
    await Promise.all(
      [...byForge].map(async ([forge, list]) => {
        const deployments = new Set(list.filter(wantsDeployments).map((entry) => entry.url));
        const outcomes = await fetchOutcomes(
          forge,
          list.map((entry) => entry.url),
          deployments,
        );
        const at = now();
        for (const entry of list) {
          const outcome = outcomes.get(entry.url);
          if (outcome) settle(entry, outcome, at);
        }
      }),
    );
  }

  function acceptObservedRead(forge: string, read: ChangeRequestObservedRead): void {
    const entry = entries.get(entryKey(forge, read.url));
    if (!entry) return;
    const { status } = read;
    const details = observedDetails(status, entry.result);
    if (!details) return;
    settle(
      entry,
      {
        state: status.state,
        headSha: status.headSha,
        checksState: status.checksState,
        checks: status.checks,
        reviewDecision: status.reviewDecision,
        ...details,
      },
      now(),
    );
    // A deployment-following PR whose head moved needs its deployments read again.
    if (wantsDeployments(entry) && !entry.result?.deployments) entry.nextDueAt = now();
    armTimer();
  }

  // ---- scheduling ----

  function armTimer(): void {
    if (disposed) return;
    let earliest = Infinity;
    for (const entry of entries.values()) {
      if (subscribersOf(entry).size === 0) continue;
      earliest = Math.min(earliest, entry.nextDueAt);
    }
    for (const branch of branches.values()) {
      if (branch.subscribers.size === 0) continue;
      earliest = Math.min(earliest, branch.nextDueAt);
    }
    if (!Number.isFinite(earliest)) {
      if (timer !== null) clearTimer(timer);
      timer = null;
      timerDueAt = null;
      return;
    }
    if (timer !== null && timerDueAt !== null && timerDueAt <= earliest) return;
    if (timer !== null) clearTimer(timer);
    timerDueAt = earliest;
    timer = setTimer(
      () => {
        timer = null;
        timerDueAt = null;
        void tick();
      },
      Math.max(0, earliest - now()),
    );
  }

  async function tick(): Promise<void> {
    if (disposed) return;
    const at = now();
    const dueBranches = [...branches.values()].filter(
      (branch) => branch.subscribers.size > 0 && branch.nextDueAt <= at,
    );
    for (const branch of dueBranches) branch.nextDueAt = Infinity;
    const dueEntries = [...entries.values()].filter(
      (entry) => subscribersOf(entry).size > 0 && entry.nextDueAt <= at,
    );
    const toRead: Entry[] = [];
    for (const entry of dueEntries) {
      // The workspace poller or a watch read it moments ago: take that instead of reading again.
      if (
        entry.readAt !== null &&
        at - entry.readAt < OBSERVED_READ_REUSE_MS &&
        !(wantsDeployments(entry) && !entry.result?.deployments)
      ) {
        entry.nextDueAt = nextDue(entry, entry.readAt);
        continue;
      }
      entry.nextDueAt = Infinity;
      toRead.push(entry);
    }
    await Promise.all([...dueBranches.map(lookupBranch), refresh(toRead)]);
    armTimer();
  }

  async function lookupBranch(branch: BranchEntry): Promise<void> {
    const source = router.source(branch.forge);
    let failure: Error | null = null;
    let found: string[] = [];
    if (!source?.listForBranch) {
      failure = new ChangeRequestReadError(
        `Looking up a branch's pull requests is not supported for ${branch.forge} yet.`,
        { reason: "unsupported" },
      );
    } else {
      try {
        const list = await source.listForBranch({
          repo: branch.repo,
          headRef: branch.headRef,
          includeClosed: branch.includeClosed,
        });
        found = list.map((item) => item.url);
      } catch (error) {
        failure = asError(error);
      }
    }
    const at = now();
    if (failure) {
      branch.failure = failure;
      const paused = failure instanceof ChangeRequestReadError && failure.reason === "paused";
      if (!paused) branch.consecutiveErrors += 1;
      branch.nextDueAt =
        paused && failure instanceof ChangeRequestReadError
          ? (failure.retryAt ?? at + PULL_REQUEST_SLOW_INTERVAL_MS)
          : at + backoff(branch.consecutiveErrors);
    } else {
      branch.failure = null;
      branch.consecutiveErrors = 0;
      branch.readAt = at;
      branch.nextDueAt = at + PULL_REQUEST_SLOW_INTERVAL_MS;
      const keys = found.map((url) => getEntry(branch.forge, url).key);
      for (const key of branch.entries) {
        if (!keys.includes(key)) entries.get(key)?.branches.delete(branch.key);
      }
      const joined = keys.filter((key) => !branch.entries.includes(key));
      for (const key of keys) entries.get(key)!.branches.add(branch.key);
      branch.entries = keys;
      const unread = keys
        .map((key) => entries.get(key)!)
        .filter((entry) => entry.result === null && entry.failure === null);
      if (unread.length) await refresh(unread);
      // A PR already read for someone else joined the list: its subscribers haven't seen it.
      for (const key of joined) {
        const entry = entries.get(key)!;
        if (unread.includes(entry)) continue;
        for (const id of branch.subscribers)
          updatesFor(id).results.set(entry.url, readOf(entry, entry.url));
      }
      if (joined.length) scheduleFlush();
    }
    queueBranchPush(branch);
  }

  function branchRead(branch: BranchEntry): ChangeRequestBranchRead {
    const failure = branch.failure;
    if (failure) {
      const read = failureRead(branch.repo, failure);
      return {
        repo: branch.repo,
        headRef: branch.headRef,
        ok: false,
        urls: branch.entries.map((key) => entries.get(key)?.url ?? key),
        ...(read.ok ? {} : { error: read.error, reason: read.reason }),
        ...(!read.ok && read.retryAt !== undefined ? { retryAt: read.retryAt } : {}),
      };
    }
    return {
      repo: branch.repo,
      headRef: branch.headRef,
      ok: branch.readAt !== null,
      urls: branch.entries.map((key) => entries.get(key)?.url ?? key),
    };
  }

  function queueBranchPush(branch: BranchEntry): void {
    const read = branchRead(branch);
    const signature = JSON.stringify(read);
    if (signature === branch.lastPushed) return;
    branch.lastPushed = signature;
    for (const id of branch.subscribers) updatesFor(id).branches.set(branch.key, read);
    scheduleFlush();
  }

  // ---- usage ----

  function pruneUsage(): void {
    const cutoff = now() - USAGE_WINDOW_MS;
    if (recent.length && recent[0]!.at < cutoff) recent = recent.filter((e) => e.at >= cutoff);
  }

  // ---- subscribing ----

  async function followUrls(subscriber: Subscriber, urls: string[]) {
    const unresolved: ChangeRequestRead[] = [];
    const followed: Entry[] = [];
    for (const item of await resolveAll(urls)) {
      if (!item.target) {
        unresolved.push(failureRead(item.url, item.error));
        continue;
      }
      const entry = getEntry(item.target.forge, item.target.url);
      entry.subscribers.add(subscriber.id);
      const asked = subscriber.urls.get(entry.key) ?? new Set<string>();
      asked.add(item.url);
      subscriber.urls.set(entry.key, asked);
      followed.push(entry);
    }
    return { followed, unresolved };
  }

  async function followBranches(
    subscriber: Subscriber,
    queries: NonNullable<PullRequestSubscriptionTarget["branches"]>,
  ) {
    const followed: BranchEntry[] = [];
    const unresolved: ChangeRequestBranchRead[] = [];
    for (const query of queries) {
      try {
        const branch = await branchFor(query);
        branch.subscribers.add(subscriber.id);
        subscriber.branches.add(branch.key);
        followed.push(branch);
      } catch (error) {
        const read = failureRead(query.repo, unsupported(error));
        unresolved.push({
          repo: query.repo,
          headRef: query.headRef,
          ok: false,
          urls: [],
          ...(read.ok ? {} : { error: read.error, reason: read.reason }),
        });
      }
    }
    return { followed, unresolved };
  }

  async function branchFor(
    query: NonNullable<PullRequestSubscriptionTarget["branches"]>[number],
  ): Promise<BranchEntry> {
    const resolvedRepo = await router.resolveRepository?.(query.repo);
    if (!resolvedRepo) throw new Error(`Looking up branches is not supported for ${query.repo}.`);
    observeForge(resolvedRepo.forge);
    const includeClosed = query.includeClosed === true;
    const key = branchKey(resolvedRepo.forge, resolvedRepo.repo, query.headRef, includeClosed);
    let branch = branches.get(key);
    if (!branch) {
      branch = {
        key,
        forge: resolvedRepo.forge,
        repo: resolvedRepo.repo,
        headRef: query.headRef,
        includeClosed,
        entries: [],
        failure: null,
        readAt: null,
        nextDueAt: 0,
        consecutiveErrors: 0,
        subscribers: new Set(),
        lastPushed: null,
      };
      branches.set(key, branch);
    }
    return branch;
  }

  /**
   * Whether a new subscriber's PR needs a read before `initial`: never read, a failure other than
   * a pause, an open PR older than the one-shot TTL, or deployments it wants and lacks.
   */
  function needsInitialRead(entry: Entry, subscriber: Subscriber, at: number): boolean {
    const { result, failure } = entry;
    if (failure) return !(failure instanceof ChangeRequestReadError && failure.reason === "paused");
    if (!result) return true;
    if (subscriber.deployments && !result.deployments) return true;
    if (result.state !== "open") return false;
    return entry.readAt === null || at - entry.readAt >= CHANGE_REQUEST_READ_TTL_MS;
  }

  function initialResults(
    subscriber: Subscriber,
    urls: { followed: Entry[]; unresolved: ChangeRequestRead[] },
    followedBranches: BranchEntry[],
  ): ChangeRequestRead[] {
    const results = new Map<string, ChangeRequestRead>();
    for (const read of urls.unresolved) results.set(read.url, read);
    for (const entry of urls.followed) {
      for (const url of subscriber.urls.get(entry.key) ?? [])
        if (!results.has(url)) results.set(url, readOf(entry, url));
    }
    for (const branch of followedBranches) {
      for (const key of branch.entries) {
        const entry = entries.get(key);
        if (entry && !results.has(entry.url)) results.set(entry.url, readOf(entry, entry.url));
      }
    }
    return [...results.values()];
  }

  function unsubscribe(subscriber: Subscriber): void {
    if (!subscribers.delete(subscriber.id)) return;
    pendingUpdates.delete(subscriber.id);
    const affected = new Set<Entry>();
    for (const key of subscriber.urls.keys()) {
      const entry = entries.get(key);
      if (!entry) continue;
      entry.subscribers.delete(subscriber.id);
      affected.add(entry);
    }
    for (const key of subscriber.branches) {
      const branch = branches.get(key);
      if (!branch) continue;
      branch.subscribers.delete(subscriber.id);
      for (const entryKeyValue of branch.entries) {
        const entry = entries.get(entryKeyValue);
        if (entry) affected.add(entry);
      }
      if (branch.subscribers.size === 0) {
        for (const entryKeyValue of branch.entries)
          entries.get(entryKeyValue)?.branches.delete(key);
        branches.delete(key);
      }
    }
    // The last visible subscriber left: a fast cadence no longer applies. Not while a read is in
    // flight (Infinity): its outcome schedules the next one.
    for (const entry of affected) {
      if (Number.isFinite(entry.nextDueAt) && entry.readAt !== null)
        entry.nextDueAt = nextDue(entry, entry.readAt);
    }
    armTimer();
  }

  const service: PullRequestService = {
    async read(urls, options) {
      const caller = options?.caller;
      const resolved = await resolveAll(urls);
      const results = new Map<string, Outcome>();
      const missing = new Map<string, Entry[]>();
      const at = now();
      for (const item of resolved) {
        if (!item.target) continue;
        const entry = getEntry(item.target.forge, item.target.url);
        if (caller) entry.readers.set(caller, at);
        if (
          entry.result &&
          entry.readAt !== null &&
          at - entry.readAt < CHANGE_REQUEST_READ_TTL_MS
        ) {
          results.set(entry.key, entry.result);
          continue;
        }
        const list = missing.get(entry.forge) ?? [];
        if (!list.includes(entry)) list.push(entry);
        missing.set(entry.forge, list);
      }
      await Promise.all(
        [...missing].map(async ([forge, list]) => {
          const outcomes = await fetchOutcomes(
            forge,
            list.map((entry) => entry.url),
            new Set(),
          );
          const settledAt = now();
          for (const entry of list) {
            const outcome = outcomes.get(entry.url) ?? new Error(`Could not read ${entry.url}.`);
            results.set(entry.key, outcome);
            // Errors aren't cached for one-shot reads, but followed PRs keep their failure state.
            if (!(outcome instanceof Error) || subscribersOf(entry).size > 0)
              settle(entry, outcome, settledAt);
          }
        }),
      );
      armTimer();
      return resolved.map((item) => {
        if (!item.target) return failureRead(item.url, item.error);
        const outcome = results.get(entryKey(item.target.forge, item.target.url));
        if (!outcome || outcome instanceof Error) return failureRead(item.url, outcome);
        return toChangeRequestRead(item.url, outcome);
      });
    },

    listOpen(repo, options) {
      return openLists.list(repo, options);
    },

    async subscribe(caller, target, onUpdate) {
      const subscriber: Subscriber = {
        id: nextSubscriberId++,
        caller,
        priority: target.priority ?? "background",
        deployments: target.include?.includes("deployments") === true,
        urls: new Map(),
        branches: new Set(),
        ready: false,
        onUpdate,
      };
      subscribers.set(subscriber.id, subscriber);
      const urls = await followUrls(subscriber, target.urls ?? []);
      const followedBranches = await followBranches(subscriber, target.branches ?? []);

      const at = now();
      await Promise.all([
        refresh(urls.followed.filter((entry) => needsInitialRead(entry, subscriber, at))),
        ...followedBranches.followed.filter((branch) => branch.readAt === null).map(lookupBranch),
      ]);
      for (const entry of urls.followed)
        entry.nextDueAt = Math.min(entry.nextDueAt, nextDue(entry, entry.readAt ?? at));
      // These were already pushed to others; this subscriber gets them as `initial`.
      pendingUpdates.delete(subscriber.id);
      armTimer();
      subscriber.ready = true;
      return {
        initial: {
          results: initialResults(subscriber, urls, followedBranches.followed),
          branches: [...followedBranches.unresolved, ...followedBranches.followed.map(branchRead)],
        },
        unsubscribe: () => unsubscribe(subscriber),
      };
    },

    usage() {
      pruneUsage();
      const hour = new Map<string, { points: number; reads: number }>();
      for (const event of recent) {
        const total = hour.get(event.caller) ?? { points: 0, reads: 0 };
        total.points += event.points;
        total.reads += event.reads;
        hour.set(event.caller, total);
      }
      const subscriptions = new Map<string, number>();
      for (const subscriber of subscribers.values())
        subscriptions.set(subscriber.caller, (subscriptions.get(subscriber.caller) ?? 0) + 1);
      const callers = new Set([...totals.keys(), ...subscriptions.keys()]);
      const round = (value: number) => Math.round(value * 100) / 100;
      return {
        since: startedAt,
        followed: [...entries.values()].filter((entry) => subscribersOf(entry).size > 0).length,
        callers: [...callers]
          .map((caller) => ({
            caller,
            points: round(totals.get(caller)?.points ?? 0),
            reads: round(totals.get(caller)?.reads ?? 0),
            pointsLastHour: round(hour.get(caller)?.points ?? 0),
            readsLastHour: round(hour.get(caller)?.reads ?? 0),
            subscriptions: subscriptions.get(caller) ?? 0,
          }))
          .sort((a, b) => b.pointsLastHour - a.pointsLastHour || b.points - a.points),
      };
    },

    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (usageTimer) clearInterval(usageTimer);
      for (const stop of observedForges.values()) stop();
      observedForges.clear();
      subscribers.clear();
      entries.clear();
      branches.clear();
      openLists.clear();
    },
  };

  return service;
}

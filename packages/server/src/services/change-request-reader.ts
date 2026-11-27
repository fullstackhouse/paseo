import type { ChangeRequestRead } from "@getpaseo/protocol/messages";
import {
  ChangeRequestReadError,
  type ChangeRequestReadResult,
  type ChangeRequestStatus,
} from "./change-request-source.js";
import type { ChangeRequestRouter } from "./change-request-router.js";

/** How long a read result is served again before the forge is asked again. */
export const CHANGE_REQUEST_READ_TTL_MS = 30_000;

export interface ChangeRequestReader {
  /**
   * One result per URL, in order. A URL the router can't place, or a forge read error, is
   * `ok: false` with a `reason`; `paused` carries `retryAt`.
   */
  read(urls: string[]): Promise<ChangeRequestRead[]>;
}

export interface CreateChangeRequestReaderOptions {
  router: ChangeRequestRouter;
  now?: () => number;
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
  };
}

function failure(url: string, error: unknown): ChangeRequestRead {
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

type ReadOutcome = ChangeRequestReadResult | Error;

/**
 * Reads change requests once for plugin servers. Successful results are cached per canonical
 * address for `CHANGE_REQUEST_READ_TTL_MS`, so plugins that refresh on their own clocks share
 * one forge read; errors are not cached. A read already in flight for an address is shared:
 * GitHub reads queue per host behind the workspace polls, and without this every plugin client
 * refreshing meanwhile queued its own copy of the same batch, so reads waited minutes and spent
 * the rate limit twice.
 */
export function createChangeRequestReader({
  router,
  now = Date.now,
}: CreateChangeRequestReaderOptions): ChangeRequestReader {
  const cache = new Map<string, { at: number; result: ChangeRequestReadResult }>();
  const inflight = new Map<string, Promise<ReadOutcome>>();

  async function readForge(forge: string, urls: string[]): Promise<Map<string, ReadOutcome>> {
    const source = router.source(forge);
    if (!source?.read) {
      const error = new ChangeRequestReadError(
        `Reading change requests is not supported for ${forge} yet.`,
        { reason: "unsupported" },
      );
      return new Map(urls.map((url) => [url, error]));
    }
    let results: Map<string, ReadOutcome>;
    try {
      results = await source.read(urls);
    } catch (error) {
      const failed = error instanceof Error ? error : new Error(String(error));
      return new Map(urls.map((url) => [url, failed]));
    }
    const at = now();
    const outcomes = new Map<string, ReadOutcome>();
    for (const url of urls) {
      const result = results.get(url) ?? new Error(`Could not read ${url}.`);
      outcomes.set(url, result);
      if (!(result instanceof Error)) cache.set(`${forge}:${url}`, { at, result });
    }
    return outcomes;
  }

  return {
    async read(urls) {
      for (const [key, entry] of cache) {
        if (now() - entry.at >= CHANGE_REQUEST_READ_TTL_MS) cache.delete(key);
      }
      const resolved = await Promise.all(
        urls.map(async (url) => {
          try {
            return { url, target: await router.resolve(url) };
          } catch (error) {
            return { url, error: unsupported(error) };
          }
        }),
      );
      const fresh = new Map<string, ReadOutcome>();
      const pending = new Map<string, Promise<ReadOutcome>>();
      const missing = new Map<string, Set<string>>();
      for (const entry of resolved) {
        if (!entry.target) continue;
        const key = `${entry.target.forge}:${entry.target.url}`;
        const hit = cache.get(key);
        if (hit && now() - hit.at < CHANGE_REQUEST_READ_TTL_MS) {
          fresh.set(key, hit.result);
          continue;
        }
        const shared = inflight.get(key);
        if (shared) {
          pending.set(key, shared);
          continue;
        }
        const set = missing.get(entry.target.forge) ?? new Set<string>();
        set.add(entry.target.url);
        missing.set(entry.target.forge, set);
      }
      for (const [forge, set] of missing) {
        const canonical = [...set];
        const batch = readForge(forge, canonical);
        for (const url of canonical) {
          const key = `${forge}:${url}`;
          const one = batch.then(
            (outcomes) => outcomes.get(url) ?? new Error(`Could not read ${url}.`),
          );
          inflight.set(key, one);
          pending.set(key, one);
          void one.finally(() => {
            if (inflight.get(key) === one) inflight.delete(key);
          });
        }
      }
      await Promise.all(
        [...pending].map(async ([key, outcome]) => {
          fresh.set(key, await outcome);
        }),
      );
      return resolved.map((entry) => {
        if (!entry.target) return failure(entry.url, entry.error);
        const result = fresh.get(`${entry.target.forge}:${entry.target.url}`);
        if (!result || result instanceof Error) return failure(entry.url, result);
        return toChangeRequestRead(entry.url, result);
      });
    },
  };
}

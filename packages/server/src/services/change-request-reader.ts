import type { ChangeRequestRead } from "@getpaseo/protocol/messages";
import type { ChangeRequestReadResult, ChangeRequestStatus } from "./change-request-source.js";
import type { ChangeRequestRouter } from "./change-request-router.js";

/** How long a read result is served again before the forge is asked again. */
export const CHANGE_REQUEST_READ_TTL_MS = 30_000;

export interface ChangeRequestReader {
  /** One result per URL, in order. A URL the router can't place, or a forge read error, is `ok: false`. */
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
  return {
    url,
    ok: false,
    error: error instanceof Error ? error.message : "Could not read the change request.",
  };
}

/**
 * Reads change requests once for plugin servers. Successful results are cached per canonical
 * address for `CHANGE_REQUEST_READ_TTL_MS`, so plugins that refresh on their own clocks share
 * one forge read; errors are not cached.
 */
export function createChangeRequestReader({
  router,
  now = Date.now,
}: CreateChangeRequestReaderOptions): ChangeRequestReader {
  const cache = new Map<string, { at: number; result: ChangeRequestReadResult }>();

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
            return { url, error };
          }
        }),
      );
      const fresh = new Map<string, ChangeRequestReadResult | Error>();
      const missing = new Map<string, Set<string>>();
      for (const entry of resolved) {
        if (!entry.target) continue;
        const key = `${entry.target.forge}:${entry.target.url}`;
        const hit = cache.get(key);
        if (hit && now() - hit.at < CHANGE_REQUEST_READ_TTL_MS) {
          fresh.set(key, hit.result);
          continue;
        }
        const set = missing.get(entry.target.forge) ?? new Set<string>();
        set.add(entry.target.url);
        missing.set(entry.target.forge, set);
      }
      await Promise.all(
        [...missing].map(async ([forge, set]) => {
          const canonical = [...set];
          const source = router.source(forge);
          if (!source?.read) {
            const error = new Error(`Reading change requests is not supported for ${forge} yet.`);
            for (const url of canonical) fresh.set(`${forge}:${url}`, error);
            return;
          }
          let results: Map<string, ChangeRequestReadResult | Error>;
          try {
            results = await source.read(canonical);
          } catch (error) {
            const failed = error instanceof Error ? error : new Error(String(error));
            for (const url of canonical) fresh.set(`${forge}:${url}`, failed);
            return;
          }
          const at = now();
          for (const url of canonical) {
            const key = `${forge}:${url}`;
            const result = results.get(url) ?? new Error(`Could not read ${url}.`);
            fresh.set(key, result);
            if (!(result instanceof Error)) cache.set(key, { at, result });
          }
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

import type { ChangeRequestListItem } from "@getpaseo/protocol/messages";
import { ChangeRequestReadError, type ChangeRequestListEntry } from "./change-request-source.js";
import type { ChangeRequestRouter } from "./change-request-router.js";

/** How long a repository's list is served again before the forge is asked again. */
export const OPEN_PULL_REQUEST_LIST_TTL_MS = 30_000;
export const OPEN_PULL_REQUEST_LIST_DEFAULT_LIMIT = 50;
export const OPEN_PULL_REQUEST_LIST_MAX_LIMIT = 100;
/** Listers count toward a list's cost this long, for budget accounting. */
const LISTER_DEMAND_MS = 60_000;

export type OpenPullRequestList =
  | { repo: string; ok: true; items: ChangeRequestListItem[] }
  | {
      repo: string;
      ok: false;
      items: [];
      error: string;
      reason: ChangeRequestReadError["reason"];
      retryAt?: number;
    };

export interface OpenPullRequestLists {
  list(repo: string, options?: { caller?: string; limit?: number }): Promise<OpenPullRequestList>;
  /** Callers that listed the repository recently, to credit a list query's cost to. */
  demand(forge: string, repo: string): string[];
  clear(): void;
}

interface ListEntry {
  /** The limit the cached items were read with. */
  limit: number;
  items: ChangeRequestListEntry[];
  readAt: number;
}

interface InFlightList {
  limit: number;
  promise: Promise<ChangeRequestListEntry[]>;
}

/**
 * One-shot lists of a repository's open pull requests, cached per repository and shared while in
 * flight. A list with fewer items than its limit is the whole list and serves any limit.
 */
export function createOpenPullRequestLists({
  router,
  now,
}: {
  router: ChangeRequestRouter;
  now: () => number;
}): OpenPullRequestLists {
  const cache = new Map<string, ListEntry>();
  const inflight = new Map<string, InFlightList>();
  const listers = new Map<string, Map<string, number>>();

  function covers(cached: ListEntry, limit: number): boolean {
    return cached.limit >= limit || cached.items.length < cached.limit;
  }

  function isFresh(cached: ListEntry): boolean {
    return now() - cached.readAt < OPEN_PULL_REQUEST_LIST_TTL_MS;
  }

  async function fetch(
    forge: string,
    repo: string,
    limit: number,
  ): Promise<ChangeRequestListEntry[]> {
    const key = `${forge}:${repo}`;
    const pending = inflight.get(key);
    if (pending && pending.limit >= limit) return pending.promise;
    const source = router.source(forge);
    if (!source?.listOpen) {
      throw new ChangeRequestReadError(
        `Listing a repository's pull requests is not supported for ${forge} yet.`,
        { reason: "unsupported" },
      );
    }
    const promise = source.listOpen({ repo, limit });
    const entry: InFlightList = { limit, promise };
    inflight.set(key, entry);
    try {
      const items = await promise;
      // A larger list that settled meanwhile stays: this one can't serve its callers.
      const current = cache.get(key);
      if (!current || !isFresh(current) || current.limit <= limit)
        cache.set(key, { limit, items, readAt: now() });
      return items;
    } finally {
      if (inflight.get(key) === entry) inflight.delete(key);
    }
  }

  return {
    async list(input, options) {
      const limit = Math.max(
        1,
        Math.min(
          Math.floor(options?.limit ?? OPEN_PULL_REQUEST_LIST_DEFAULT_LIMIT),
          OPEN_PULL_REQUEST_LIST_MAX_LIMIT,
        ),
      );
      let target: { forge: string; repo: string };
      try {
        if (!router.resolveRepository) throw new Error("Repository lookups are unavailable.");
        target = await router.resolveRepository(input);
      } catch (error) {
        return failure(
          input,
          new ChangeRequestReadError(
            error instanceof Error ? error.message : "Unsupported repository URL.",
            { reason: "unsupported", cause: error },
          ),
        );
      }
      const key = `${target.forge}:${target.repo}`;
      if (options?.caller) {
        const callers = listers.get(key) ?? new Map<string, number>();
        callers.set(options.caller, now());
        listers.set(key, callers);
      }
      const cached = cache.get(key);
      let items: ChangeRequestListEntry[];
      if (cached && isFresh(cached) && covers(cached, limit)) {
        items = cached.items;
      } else {
        try {
          items = await fetch(target.forge, target.repo, limit);
        } catch (error) {
          return failure(input, error);
        }
      }
      return { repo: input, ok: true, items: items.slice(0, limit).map(toListItem) };
    },

    demand(forge, repo) {
      const callers = listers.get(`${forge}:${repo}`);
      if (!callers) return [];
      const at = now();
      for (const [caller, listedAt] of callers) {
        if (at - listedAt >= LISTER_DEMAND_MS) callers.delete(caller);
      }
      return [...callers.keys()];
    },

    clear() {
      cache.clear();
      inflight.clear();
      listers.clear();
    },
  };
}

function toListItem(entry: ChangeRequestListEntry): ChangeRequestListItem {
  return {
    url: entry.url,
    number: entry.number,
    title: entry.title,
    isDraft: entry.isDraft,
    headRef: entry.headRef,
    author: entry.author,
    updatedAt: entry.updatedAt,
  };
}

function failure(repo: string, error: unknown): OpenPullRequestList {
  const reason = error instanceof ChangeRequestReadError ? error.reason : "error";
  const retryAt = error instanceof ChangeRequestReadError ? error.retryAt : undefined;
  return {
    repo,
    ok: false,
    items: [],
    error: error instanceof Error ? error.message : "Could not list the pull requests.",
    reason,
    ...(retryAt !== undefined ? { retryAt } : {}),
  };
}
